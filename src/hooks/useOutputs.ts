import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { t } from '@/i18n';
import * as api from '@/api/client';
import type { FileItem, AssetSource, SortMode } from '@/api/client';

function getVisibleParentPath(path: string | null): string | null {
  if (!path) return null;
  const visibleParts: string[] = [];
  for (const part of path.split('/')) {
    if (part.startsWith('.')) break;
    visibleParts.push(part);
  }
  return visibleParts.length > 0 ? visibleParts.join('/') : null;
}

function hasHiddenPathSegment(file: FileItem, source: AssetSource): boolean {
  if (file.name.startsWith('.')) return true;
  const sourcePrefix = `${source}/`;
  const relativePath = file.id.startsWith(sourcePrefix)
    ? file.id.slice(sourcePrefix.length)
    : file.id;
  return relativePath.split('/').some((part) => part.startsWith('.'));
}

function sourcePrefix(source: AssetSource): string {
  return `${source}/`;
}

function splitFileId(id: string, fallbackSource: AssetSource): { source: AssetSource; path: string } {
  for (const source of ['output', 'input', 'temp'] as const) {
    const prefix = sourcePrefix(source);
    if (id.startsWith(prefix)) {
      return { source, path: id.slice(prefix.length) };
    }
  }
  return { source: fallbackSource, path: id };
}

function favoriteIdsForSource(source: AssetSource, paths: string[]): string[] {
  const prefix = sourcePrefix(source);
  return paths.map((path) => `${prefix}${path}`);
}

function replaceSourceFavorites(
  favorites: string[],
  source: AssetSource,
  nextSourceFavorites: string[],
): string[] {
  const prefix = sourcePrefix(source);
  const next = new Set(favorites.filter((id) => !id.startsWith(prefix)));
  nextSourceFavorites.forEach((id) => next.add(id));
  return Array.from(next);
}

function reconcileReturnedFileState(
  existing: string[],
  files: FileItem[],
  flaggedIds: string[],
): string[] {
  const returnedFileIds = new Set(
    files.filter((file) => file.type !== 'folder').map((file) => file.id),
  );
  const next = new Set(existing.filter((id) => !returnedFileIds.has(id)));
  flaggedIds.forEach((id) => next.add(id));
  return Array.from(next);
}

function touchFileModifiedDates(
  files: FileItem[],
  ids: string[],
  modifiedDate: number,
): FileItem[] {
  if (ids.length === 0) return files;

  // A child's state change also changes the contents of every folder above it,
  // so keep those folder cards in the same modified-date ordering immediately.
  const touchedIds = new Set<string>();
  ids.forEach((id) => {
    let current = id;
    while (current) {
      touchedIds.add(current);
      const separator = current.lastIndexOf('/');
      if (separator < 0) break;
      current = current.slice(0, separator);
    }
  });

  let changed = false;
  const next = files.map((file) => {
    if (!touchedIds.has(file.id)) return file;
    changed = true;
    return { ...file, date: modifiedDate, modifiedDate };
  });
  return changed ? next : files;
}

const fileStateMutationTails = new Map<string, Promise<void>>();
const fileStateHydrationInFlight = new Map<AssetSource, Promise<boolean>>();
const fileStateMutationVersions = new Map<AssetSource, number>();

function queueFileStateMutation(
  source: AssetSource,
  path: string,
  state: 'favorite' | 'reject' | 'hidden',
  value: boolean,
): Promise<void> {
  const key = `${source}/${path}`;
  fileStateMutationVersions.set(source, (fileStateMutationVersions.get(source) ?? 0) + 1);
  const previous = fileStateMutationTails.get(key);
  const request = previous
    ? previous.catch(() => undefined).then(() => api.setFileState(source, path, state, value))
    : api.setFileState(source, path, state, value);
  fileStateMutationTails.set(key, request);
  const cleanup = () => {
    if (fileStateMutationTails.get(key) === request) {
      fileStateMutationTails.delete(key);
    }
  };
  request.then(cleanup, cleanup);
  return request;
}

// The listing waits on this drain before it renders, and setFileState is a
// plain fetch with no timeout — on a link that drops mid-request (mobile,
// Tailscale) the promise never settles. Without a bound, one hung write leaves
// the Outputs panel on a spinner with no files and no error, unrecoverable
// short of reloading the app. Waiting is only an ordering nicety, so give up
// after a beat and render: the write is still in flight and its own retry path
// is unaffected.
const FILE_STATE_FLUSH_TIMEOUT_MS = 4000;

export async function flushFileStateMutations(source?: AssetSource): Promise<void> {
  const prefix = source ? sourcePrefix(source) : null;
  const deadline = Date.now() + FILE_STATE_FLUSH_TIMEOUT_MS;
  while (true) {
    const pending = Array.from(fileStateMutationTails.entries())
      .filter(([key]) => !prefix || key.startsWith(prefix))
      .map(([, request]) => request);
    if (pending.length === 0) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), remaining);
    });
    const outcome = await Promise.race([
      Promise.allSettled(pending).then(() => 'settled' as const),
      expired,
    ]);
    clearTimeout(timer);
    if (outcome === 'timeout') return;
  }
}

/** `only` narrows the listing to that status; `exclude` hides it instead. */
export type StatusFilterMode = 'off' | 'only' | 'exclude';

export type StatusFilterKey = 'favoritesMode' | 'rejectsMode';

export interface FilterState {
  search: string;
  favoritesMode: StatusFilterMode;
  rejectsMode: StatusFilterMode;
  type: 'all' | 'image' | 'video';
}

export function mergeOutputsFilter(
  current: FilterState,
  next: Partial<FilterState>,
): FilterState {
  return { ...current, ...next };
}

const OTHER_STATUS_KEY: Record<StatusFilterKey, StatusFilterKey> = {
  favoritesMode: 'rejectsMode',
  rejectsMode: 'favoritesMode',
};

/**
 * Advance one status filter a step, honoring how the two interact.
 *
 * Each button cycles off → only → exclude → off. The pair constrains that:
 * favorite and reject are mutually exclusive states on a file, so `only` +
 * `only` is always an empty listing, and `only` + `exclude` is redundant
 * (only-favorites already excludes rejects). So turning one on from `off`
 * clears the other, EXCEPT when the other is excluding — there, the clicked
 * filter joins it at `exclude`, which is the one genuinely useful pairing:
 * hide favorites and rejects at once and browse what's left.
 */
export function cycleStatusFilter(
  current: FilterState,
  key: StatusFilterKey,
): FilterState {
  const otherKey = OTHER_STATUS_KEY[key];
  const other = current[otherKey];
  const next = { ...current };

  if (current[key] === 'only') {
    next[key] = 'exclude';
  } else if (current[key] === 'exclude') {
    next[key] = 'off';
  } else if (other === 'exclude') {
    next[key] = 'exclude';
  } else {
    next[key] = 'only';
    next[otherKey] = 'off';
  }
  return next;
}

// A browsing "tab" within the outputs panel, rendered as its own breadcrumb
// row. Each tab independently tracks its source + folder; the active tab's
// values mirror the live `source`/`currentFolder` fields.
export interface OutputsTab {
  id: string;
  source: AssetSource;
  folder: string | null;
}

export const MAX_OUTPUTS_TABS = 3;

let outputsTabSeq = 0;
const newOutputsTabId = () => `otab-${outputsTabSeq++}`;

// Memoizes getDisplayedFiles by reference-equality of its store-field inputs, so
// the full filter+sort over (up to 1000) files isn't recomputed on every render
// that merely reads the displayed list. The store sets these fields immutably,
// so === on the references is a correct cache key.
let displayedFilesMemo: { key: readonly unknown[]; value: FileItem[] } | null = null;

export interface SortState {
  mode: SortMode;
}

interface OutputsState {
  // Current view state
  source: AssetSource;
  currentFolder: string | null;  // null = root, else path string like 'foo/bar'
  folders: string[];  // Available subfolders for current source
  files: FileItem[];
  hiddenFolderPaths: string[];  // hidden folder paths seen while browsing (for breadcrumb italics)
  folderBySource: Record<AssetSource, string | null>;  // last folder per source, so switching restores location
  tabs: OutputsTab[];  // breadcrumb-row tabs; the active one mirrors source/currentFolder
  activeTabId: string;

  // UI state
  isLoading: boolean;
  error: string | null;
  viewMode: 'grid' | 'list';
  showHidden: boolean;
  filter: FilterState;
  sort: SortState;
  favorites: string[];
  // Sources whose legacy client-side favorites have been migrated to the server
  // (3.0.3 favorites-sync). Guards fetchFiles from re-uploading legacy ids.
  migratedFavoriteSources: AssetSource[];
  // Images explicitly marked "rejected". Mutually exclusive with favorites: an
  // id is never in both lists at once (the mutation actions enforce this).
  rejected: string[];
  searchOpen: boolean;
  searchDraft: string;

  // Prompt-search overlay state. When active, getDisplayedFiles projects the
  // server-resolved match list (filename/folder OR embedded prompt JSON) into
  // the current folder view. Submitted via runPromptSearch from Enter in the
  // search bar; cleared when the user edits or clears the query or switches
  // source.
  promptSearchActive: boolean;
  promptSearchResults: FileItem[];
  promptSearchQuery: string;
  promptSearchLoading: boolean;
  // Set when a prompt search request fails, so a failed search is
  // distinguishable from one with no matches.
  promptSearchError: string | null;

  // Selection
  selectionMode: boolean;
  selectedIds: string[];
  selectionActionOpen: boolean;
  filterModalOpen: boolean;
  newFolderModalOpen: boolean;
  outputsViewerOpen: boolean;

  // Actions
  setSource: (source: AssetSource) => void;
  setCurrentFolder: (folder: string | null) => void;
  navigateToPath: (path: string | null) => void;
  navigateUp: () => void;
  fetchFolders: () => Promise<void>;
  hydrateFileState: (source?: AssetSource) => Promise<boolean>;
  fetchFiles: () => Promise<void>;
  setFilter: (filter: Partial<FilterState>) => void;
  cycleStatusFilter: (key: StatusFilterKey) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchDraft: (query: string) => void;
  setSort: (sort: SortState) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  toggleShowHidden: () => void;
  toggleFavorite: (id: string) => void;
  // Mark an id favorited (idempotent — never unfavorites) and clear any
  // rejected state. Backs the `f` key and the heart button: favoriting is
  // "sticky" so it can't be accidentally undone; unfavoriting goes through the
  // reject/`x` affordance instead.
  favoriteItem: (id: string) => void;
  unfavoriteItem: (id: string) => void;
  // Toggle rejected. Marking rejected clears any favorited state.
  toggleRejected: (id: string) => void;
  // Clear every rejected mark at once. Deliberately NOT what the bulk "Delete
  // rejected" action uses: that clears only the ids whose delete actually
  // succeeded, so a file that failed to delete keeps its mark rather than
  // silently becoming invisible. Consumed by the 3.1.1 flows.
  clearRejected: () => void;
  setItemHidden: (id: string, hidden: boolean) => Promise<void>;
  setItemsHidden: (ids: string[], hidden: boolean) => Promise<void>;
  markItemHiddenLocally: (id: string) => void;
  addTab: () => void;
  closeTab: (tabId: string) => void;
  switchToTab: (tabId: string, folder?: string | null) => void;
  toggleSelectionMode: () => void;
  toggleSelection: (id: string) => void;
  selectAll: () => void;
  selectIds: (ids: string[], mode?: 'add' | 'replace') => void;
  deselectIds: (ids: string[]) => void;
  clearSelection: () => void;
  exitSelectionMode: () => void;
  setSelectionActionOpen: (open: boolean) => void;
  setFilterModalOpen: (open: boolean) => void;
  setNewFolderModalOpen: (open: boolean) => void;
  setOutputsViewerOpen: (open: boolean) => void;
  addFavorites: (ids: string[]) => void;
  removeFavorites: (ids: string[]) => void;
  refresh: () => void;
  runPromptSearch: (query: string) => Promise<void>;
  clearPromptSearch: () => void;
  getDisplayedFiles: () => FileItem[];
}

export const useOutputsStore = create<OutputsState>()(
  persist(
    (set, get) => ({
      source: 'output',
      currentFolder: null,
      folders: [],
      files: [],
      hiddenFolderPaths: [],
      folderBySource: { output: null, input: null, temp: null },
      tabs: [{ id: 'otab-initial', source: 'output', folder: null }],
      activeTabId: 'otab-initial',
      isLoading: false,
      error: null,
      viewMode: 'grid',
      showHidden: false,
      filter: {
        search: '',
        favoritesMode: 'off',
        rejectsMode: 'off',
        type: 'all'
      },
      sort: {
        mode: 'modified'
      },
      favorites: [],
      migratedFavoriteSources: [],
      rejected: [],
      searchOpen: false,
      searchDraft: '',
      promptSearchActive: false,
      promptSearchResults: [],
      promptSearchQuery: '',
      promptSearchLoading: false,
      promptSearchError: null,
      selectionMode: false,
      selectedIds: [],
      selectionActionOpen: false,
      filterModalOpen: false,
      newFolderModalOpen: false,
      outputsViewerOpen: false,

      setSource: (source) => {
        const { source: prevSource, currentFolder, folderBySource, tabs, activeTabId } = get();
        if (source === prevSource) return;
        // Stash where we were in the source we're leaving, and restore where we
        // last were in the source we're entering.
        const nextFolderBySource = { ...folderBySource, [prevSource]: currentFolder };
        const restored = nextFolderBySource[source] ?? null;
        set({
          source,
          currentFolder: restored,
          folderBySource: nextFolderBySource,
          // Only the active tab's breadcrumb trail changes source; other tabs
          // keep their own source/folder.
          tabs: tabs.map((t) => (t.id === activeTabId ? { ...t, source, folder: restored } : t)),
          files: [],
          folders: [],
          hiddenFolderPaths: [],
          selectionMode: false,
          selectedIds: [],
          promptSearchActive: false,
          promptSearchResults: [],
          promptSearchQuery: '',
          searchOpen: false,
          searchDraft: '',
        });
        get().fetchFolders();
        get().fetchFiles();
      },

      addTab: () => {
        const state = get();
        if (state.tabs.length >= MAX_OUTPUTS_TABS) return;
        // Snapshot the active tab from live state, then append a duplicate that
        // becomes the new active tab (same source + folder, highlighted below).
        const synced = state.tabs.map((t) =>
          t.id === state.activeTabId ? { ...t, source: state.source, folder: state.currentFolder } : t
        );
        const id = newOutputsTabId();
        set({
          tabs: [...synced, { id, source: state.source, folder: state.currentFolder }],
          activeTabId: id,
        });
        // The new tab duplicates the current view, so files/selection stay valid.
      },

      closeTab: (tabId) => {
        const state = get();
        // Only inactive tabs are closable (the active tab shows "+", not "−").
        if (tabId === state.activeTabId) return;
        if (state.tabs.length <= 1) return;
        set({ tabs: state.tabs.filter((t) => t.id !== tabId) });
      },

      switchToTab: (tabId, folder) => {
        const state = get();
        if (tabId === state.activeTabId && folder === undefined) return;
        // Sync the outgoing active tab from live state first.
        const synced = state.tabs.map((t) =>
          t.id === state.activeTabId ? { ...t, source: state.source, folder: state.currentFolder } : t
        );
        const target = synced.find((t) => t.id === tabId);
        if (!target) return;
        const nextFolder = folder !== undefined ? folder : target.folder;
        // Carry an in-progress selection across tabs that share the active
        // source, so the user can build one selection while hopping tab to tab.
        // Bulk actions (esp. Move) operate within a single source, so crossing
        // into a different source resets the selection.
        const keepSelection = target.source === state.source;
        // Don't blank out files/folders here — leave the old tab's contents on
        // screen until the new tab's data loads, so switching doesn't flash an
        // empty panel. fetchFiles/fetchFolders replace them when ready.
        set({
          activeTabId: tabId,
          source: target.source,
          currentFolder: nextFolder,
          tabs: synced.map((t) => (t.id === tabId ? { ...t, folder: nextFolder } : t)),
          // Preserve known hidden-folder paths across same-source tab switches so
          // hidden breadcrumb crumbs keep their dim styling through the color
          // transition (a reset would briefly mis-color them). Cross-source
          // switches reset to avoid path collisions between sources.
          hiddenFolderPaths: keepSelection ? state.hiddenFolderPaths : [],
          selectionMode: keepSelection ? state.selectionMode : false,
          selectedIds: keepSelection ? state.selectedIds : [],
          promptSearchActive: false,
          promptSearchResults: [],
          promptSearchQuery: '',
          searchOpen: false,
          searchDraft: '',
        });
        get().fetchFolders();
        get().fetchFiles();
      },

      setCurrentFolder: (folder) => {
        const { currentFolder, filter, promptSearchActive } = get();
        const newPath = currentFolder ? `${currentFolder}/${folder}` : folder;
        set({
          currentFolder: newPath,
          files: [],
          selectionMode: false,
          selectedIds: [],
          // Preserve the prompt-search overlay across navigation (the user is
          // exploring filtered results). Without prompt search, drop the
          // live filename filter so the user sees the new folder's full
          // contents instead of an immediate empty state.
          ...(promptSearchActive ? {} : { filter: { ...filter, search: '' } }),
        });
        get().fetchFiles();
      },

      navigateToPath: (path) => {
        const { filter, promptSearchActive } = get();
        set({
          currentFolder: path,
          files: [],
          selectionMode: false,
          selectedIds: [],
          ...(promptSearchActive ? {} : { filter: { ...filter, search: '' } }),
        });
        get().fetchFiles();
      },

      navigateUp: () => {
        const { currentFolder, filter, promptSearchActive } = get();
        if (!currentFolder) return;
        const parts = currentFolder.split('/');
        parts.pop();
        const newPath = parts.length > 0 ? parts.join('/') : null;
        set({
          currentFolder: newPath,
          files: [],
          selectionMode: false,
          selectedIds: [],
          ...(promptSearchActive ? {} : { filter: { ...filter, search: '' } }),
        });
        get().fetchFiles();
      },

      fetchFolders: async () => {
        try {
          const { showHidden } = get();
          const result = await api.getUserImageFolders(showHidden);
          const { source } = get();
          set({ folders: source === 'output' ? result.output : result.input });
        } catch (err) {
          console.error('Failed to fetch folders:', err);
          set({ error: (err as Error).message });
        }
      },

      hydrateFileState: async (requestedSource = get().source) => {
        // Queue cards need favorite/reject state even when the Outputs panel has
        // never been opened. Keep this independent from the much heavier folder
        // listing and share concurrent Queue/Outputs hydration requests.
        const existing = fileStateHydrationInFlight.get(requestedSource);
        if (existing) return existing;

        const request = (async (): Promise<boolean> => {
          const state = get();
          const migratedFavoriteSources = state.migratedFavoriteSources ?? [];
          const legacyIds = state.favorites.filter(
            (id) => id.startsWith(sourcePrefix(requestedSource)),
          );
          let migrationFailed = false;

          if (!migratedFavoriteSources.includes(requestedSource)) {
            for (const id of legacyIds) {
              const { path } = splitFileId(id, requestedSource);
              await queueFileStateMutation(requestedSource, path, 'favorite', true).catch((err) => {
                // 409 means the server found nothing on disk at that path — a
                // favorite whose file was since deleted. That can never be
                // migrated, and treating it as a failure pins the whole source
                // as unmigrated, so the entire favorites list is re-POSTed
                // sequentially before every listing for the rest of time.
                if (err instanceof api.FileStateError && err.status === 409) {
                  console.warn('Skipping favorite migration for a missing file:', path);
                  return;
                }
                console.warn('Failed to migrate file favorite:', err);
                migrationFailed = true;
              });
            }
            // Only mark migrated once every legacy favorite made it to the
            // server — otherwise an offline migration must be retried later.
            if (!migrationFailed) {
              set((s) => ({
                migratedFavoriteSources: s.migratedFavoriteSources.includes(requestedSource)
                  ? s.migratedFavoriteSources
                  : [...s.migratedFavoriteSources, requestedSource],
              }));
            }
          }

          try {
            // Let optimistic writes settle before taking the authoritative
            // snapshot. If the user taps favorite/reject while the GET is in
            // flight, reload after that write settles rather than rolling the
            // optimistic UI back to a stale snapshot.
            let serverState: Awaited<ReturnType<typeof api.loadFileState>> | null = null;
            for (let attempt = 0; attempt < 3; attempt += 1) {
              await flushFileStateMutations(requestedSource);
              const mutationVersion = fileStateMutationVersions.get(requestedSource) ?? 0;
              const candidate = await api.loadFileState(requestedSource);
              await flushFileStateMutations(requestedSource);
              if ((fileStateMutationVersions.get(requestedSource) ?? 0) === mutationVersion) {
                serverState = candidate;
                break;
              }
            }
            if (!serverState) {
              // Continuous interaction kept every snapshot stale. Preserve the
              // optimistic state and let the panel's normal retry obtain a quiet
              // snapshot instead of applying known-old data.
              return false;
            }
            const favoriteIds = favoriteIdsForSource(requestedSource, serverState.favorite);
            // Preserve legacy favorites whose migration failed. Dropping them
            // here would also remove the data needed to retry that migration.
            if (migrationFailed) favoriteIds.push(...legacyIds);
            set((s) => ({
              favorites: replaceSourceFavorites(s.favorites, requestedSource, favoriteIds),
              rejected: replaceSourceFavorites(
                s.rejected,
                requestedSource,
                favoriteIdsForSource(requestedSource, serverState.reject),
              ),
            }));
            return true;
          } catch (err) {
            console.warn('Failed to load file state:', err);
            // Preserve the latest optimistic/local state. Queue startup can
            // continue and its retry loop will call this action again.
            return false;
          }
        })();

        fileStateHydrationInFlight.set(requestedSource, request);
        try {
          return await request;
        } finally {
          if (fileStateHydrationInFlight.get(requestedSource) === request) {
            fileStateHydrationInFlight.delete(requestedSource);
          }
        }
      },

      fetchFiles: async () => {
        const { source, currentFolder, showHidden } = get();
        set({ isLoading: true, error: null });

        try {
          // Hydrate the same lightweight state index Queue uses before fetching
          // the directory contents. Reject has no client→server migration;
          // the server is its source of truth.
          await get().hydrateFileState(source);
          const prefix = sourcePrefix(source);
          // The mobile backend returns the full folder listing (no server-side
          // limit/offset/sort — those positional args are ignored by
          // getUserImages); the grid sorts/filters client-side and renders
          // incrementally, so there is no file-count cap here.
          const files = await api.getUserImages(
            source,
            undefined, // count (ignored)
            undefined, // offset (ignored)
            undefined, // sort (ignored)
            false,     // includeSubfolders
            currentFolder,
            showHidden
          );
          const hydratedState = get();
          const backendFavoriteIds = new Set(
            hydratedState.favorites.filter((id) => id.startsWith(prefix)),
          );
          const backendRejectedIds = new Set(
            hydratedState.rejected.filter((id) => id.startsWith(prefix)),
          );
          for (const file of files) {
            if (file.favorite) backendFavoriteIds.add(file.id);
            if (file.rejected) backendRejectedIds.add(file.id);
          }
          // Remember hidden folders we encounter so breadcrumb ancestors can be
          // italicized even once we've navigated down into them.
          const seenHiddenFolders = files
            .filter((f) => f.type === 'folder' && f.hidden)
            .map((f) => (f.id.startsWith(prefix) ? f.id.slice(prefix.length) : f.id));
          set((s) => ({
            files,
            isLoading: false,
            favorites: replaceSourceFavorites(s.favorites, source, Array.from(backendFavoriteIds)),
            rejected: replaceSourceFavorites(s.rejected, source, Array.from(backendRejectedIds)),
            hiddenFolderPaths: seenHiddenFolders.length
              ? Array.from(new Set([...s.hiddenFolderPaths, ...seenHiddenFolders]))
              : s.hiddenFolderPaths,
          }));
        } catch (err) {
          set({ error: (err as Error).message, isLoading: false });
        }
      },

      setFilter: (next) => {
        set((s) => {
          const filter = mergeOutputsFilter(s.filter, next);
          // Any edit to the search text invalidates an active prompt-search
          // overlay — the results no longer match the visible query and
          // resurrecting them on Enter is the user's call.
          const searchChanged = next.search !== undefined && next.search !== s.promptSearchQuery;
          if (s.promptSearchActive && searchChanged) {
            return {
              filter,
              promptSearchActive: false,
              promptSearchResults: [],
              promptSearchQuery: '',
            };
          }
          return { filter };
        });
      },

      cycleStatusFilter: (key) => {
        set((s) => ({ filter: cycleStatusFilter(s.filter, key) }));
      },

      setSearchOpen: (open) => {
        set((s) => ({
          searchOpen: open,
          searchDraft: open ? (s.filter.search || s.promptSearchQuery) : s.searchDraft,
        }));
      },

      setSearchDraft: (query) => {
        set({ searchDraft: query });
      },

      runPromptSearch: async (query) => {
        const trimmed = query.trim();
        if (!trimmed) {
          get().clearPromptSearch();
          return;
        }
        const { source, currentFolder, showHidden } = get();
        set({ promptSearchLoading: true, promptSearchError: null });
        try {
          await flushFileStateMutations(source);
          const results = await api.searchUserImagesByPrompt(
            source,
            trimmed,
            currentFolder,
            showHidden,
          );
          const backendFavoriteIds = results
            .filter((file) => file.favorite)
            .map((file) => file.id);
          const backendRejectedIds = results
            .filter((file) => file.rejected)
            .map((file) => file.id);
          set((s) => ({
            filter: { ...s.filter, search: trimmed },
            searchDraft: trimmed,
            promptSearchActive: true,
            promptSearchResults: results,
            promptSearchQuery: trimmed,
            promptSearchLoading: false,
            favorites: reconcileReturnedFileState(s.favorites, results, backendFavoriteIds),
            rejected: reconcileReturnedFileState(s.rejected, results, backendRejectedIds),
          }));
        } catch (err) {
          console.error('Prompt search failed:', err);
          // Distinguish "the search failed" from "no matches".
          set({
            promptSearchLoading: false,
            promptSearchError: (err as Error).message || t('Prompt search failed'),
          });
        }
      },

      clearPromptSearch: () => {
        set((s) => ({
          filter: { ...s.filter, search: '' },
          searchDraft: '',
          promptSearchActive: false,
          promptSearchResults: [],
          promptSearchQuery: '',
          promptSearchLoading: false,
          promptSearchError: null,
        }));
      },

      setSort: (sort) => {
        // Sorting is purely client-side (the backend ignores the sort arg and
        // the displayed-files memo re-sorts on this key), so just update state —
        // no need to re-download the whole folder listing and flash the spinner.
        set({ sort });
      },

      setViewMode: (mode) => {
        set({ viewMode: mode });
      },

      toggleShowHidden: () => {
        const { showHidden, currentFolder, promptSearchActive, promptSearchQuery } = get();
        const nextShowHidden = !showHidden;
        const nextFolder = nextShowHidden ? currentFolder : getVisibleParentPath(currentFolder);
        set((s) => ({
          showHidden: nextShowHidden,
          currentFolder: nextFolder,
          files: [],
          selectionMode: false,
          selectedIds: [],
          filter: nextFolder === currentFolder || promptSearchActive
            ? s.filter
            : { ...s.filter, search: '' },
        }));
        get().fetchFolders();
        get().fetchFiles();
        if (promptSearchActive && promptSearchQuery.trim()) {
          void get().runPromptSearch(promptSearchQuery);
        }
      },

      toggleFavorite: (id) => {
        const exists = get().favorites.includes(id);
        const modifiedDate = Date.now();
        set((s) => ({
          favorites: exists
            ? s.favorites.filter(p => p !== id)
            : [...s.favorites, id],
          // Favoriting clears rejected — the two states are mutually exclusive.
          rejected: exists ? s.rejected : s.rejected.filter(p => p !== id),
          files: touchFileModifiedDates(s.files, [id], modifiedDate),
          promptSearchResults: touchFileModifiedDates(
            s.promptSearchResults,
            [id],
            modifiedDate,
          ),
        }));
        const { source, path } = splitFileId(id, get().source);
        void queueFileStateMutation(source, path, 'favorite', !exists).catch((err) => {
          console.warn('Failed to update file favorite:', err);
        });
      },

      favoriteItem: (id) => {
        const modifiedDate = Date.now();
        set((s) => ({
          favorites: s.favorites.includes(id) ? s.favorites : [...s.favorites, id],
          rejected: s.rejected.filter(p => p !== id),
          files: touchFileModifiedDates(s.files, [id], modifiedDate),
          promptSearchResults: touchFileModifiedDates(
            s.promptSearchResults,
            [id],
            modifiedDate,
          ),
        }));
        const { source, path } = splitFileId(id, get().source);
        void queueFileStateMutation(source, path, 'favorite', true).catch((err) => {
          console.warn('Failed to update file favorite:', err);
        });
      },

      unfavoriteItem: (id) => {
        const modifiedDate = Date.now();
        set((s) => ({
          favorites: s.favorites.filter(p => p !== id),
          files: touchFileModifiedDates(s.files, [id], modifiedDate),
          promptSearchResults: touchFileModifiedDates(
            s.promptSearchResults,
            [id],
            modifiedDate,
          ),
        }));
        const { source, path } = splitFileId(id, get().source);
        void queueFileStateMutation(source, path, 'favorite', false).catch((err) => {
          console.warn('Failed to update file favorite:', err);
        });
      },

      toggleRejected: (id) => {
        const exists = get().rejected.includes(id);
        const modifiedDate = Date.now();
        set((s) => ({
          rejected: exists
            ? s.rejected.filter(p => p !== id)
            : [...s.rejected, id],
          // Rejecting clears favorited — mutually exclusive.
          favorites: exists ? s.favorites : s.favorites.filter(p => p !== id),
          files: touchFileModifiedDates(s.files, [id], modifiedDate),
          promptSearchResults: touchFileModifiedDates(
            s.promptSearchResults,
            [id],
            modifiedDate,
          ),
        }));
        const { source, path } = splitFileId(id, get().source);
        void queueFileStateMutation(source, path, 'reject', !exists).catch((err) => {
          console.warn('Failed to update file reject state:', err);
        });
      },

      clearRejected: () => {
        const ids = get().rejected;
        const modifiedDate = Date.now();
        set((s) => ({
          rejected: [],
          files: touchFileModifiedDates(s.files, ids, modifiedDate),
          promptSearchResults: touchFileModifiedDates(
            s.promptSearchResults,
            ids,
            modifiedDate,
          ),
        }));
        const fallbackSource = get().source;
        ids.forEach((id) => {
          const { source, path } = splitFileId(id, fallbackSource);
          void queueFileStateMutation(source, path, 'reject', false).catch((err) => {
            console.warn('Failed to clear file reject state:', err);
          });
        });
      },

      setItemHidden: (id, hidden) => get().setItemsHidden([id], hidden),

      markItemHiddenLocally: (id) => {
        const mark = (file: FileItem) => file.id === id
          ? { ...file, hidden: true, hiddenSelf: true }
          : file;
        set((state) => ({
          files: state.showHidden
            ? state.files.map(mark)
            : state.files.filter((file) => file.id !== id),
          promptSearchResults: state.showHidden
            ? state.promptSearchResults.map(mark)
            : state.promptSearchResults.filter((file) => file.id !== id),
        }));
      },

      setItemsHidden: async (ids, hidden) => {
        if (ids.length === 0) return;
        const { source } = get();
        const prefix = `${source}/`;
        const results = await Promise.all(ids.map((id) => {
          const path = id.startsWith(prefix) ? id.slice(prefix.length) : id;
          return queueFileStateMutation(source, path, 'hidden', hidden).catch((err) => {
            console.error('Failed to update hidden state:', err);
            return err as Error;
          });
        }));
        // The refresh below re-reads the server's view, so a refused write
        // simply reappears unhidden with no explanation. Say what happened:
        // set_state refuses a path with nothing on disk, which is what a file
        // deleted in another tab looks like.
        const failure = results.find((result): result is Error => result instanceof Error);
        if (failure) {
          set({ error: `Could not ${hidden ? 'hide' : 'unhide'} every item: ${failure.message}` });
        }
        get().refresh();
      },

      toggleSelectionMode: () => {
        set((s) => ({
          selectionMode: !s.selectionMode,
          selectedIds: [],
          selectionActionOpen: false
        }));
      },

      toggleSelection: (id) => {
        set((s) => {
          const selected = s.selectedIds.includes(id)
            ? s.selectedIds.filter(p => p !== id)
            : [...s.selectedIds, id];
          return { selectedIds: selected };
        });
      },

      selectAll: () => {
        const displayed = get().getDisplayedFiles();
        set({ selectedIds: displayed.map(f => f.id) });
      },

      selectIds: (ids, mode = 'add') => {
        set((s) => {
          if (mode === 'replace') return { selectedIds: [...ids] };
          const next = new Set(s.selectedIds);
          ids.forEach((id) => next.add(id));
          return { selectedIds: Array.from(next) };
        });
      },

      deselectIds: (ids) => {
        set((s) => {
          if (ids.length === 0) return {};
          const remove = new Set(ids);
          return { selectedIds: s.selectedIds.filter((id) => !remove.has(id)) };
        });
      },

      clearSelection: () => {
        set({ selectedIds: [], selectionActionOpen: false });
      },

      exitSelectionMode: () => {
        set({
          selectionMode: false,
          selectedIds: [],
          selectionActionOpen: false,
        });
      },

      setSelectionActionOpen: (open) => {
        set({ selectionActionOpen: open });
      },

      setFilterModalOpen: (open) => {
        set({ filterModalOpen: open });
      },

      setNewFolderModalOpen: (open) => {
        set({ newFolderModalOpen: open });
      },

      setOutputsViewerOpen: (open) => {
        set({ outputsViewerOpen: open });
      },

      addFavorites: (ids) => {
        const modifiedDate = Date.now();
        set((s) => {
          const next = new Set(s.favorites);
          ids.forEach((id) => next.add(id));
          const idSet = new Set(ids);
          return {
            favorites: Array.from(next),
            rejected: s.rejected.filter((id) => !idSet.has(id)),
            files: touchFileModifiedDates(s.files, ids, modifiedDate),
            promptSearchResults: touchFileModifiedDates(
              s.promptSearchResults,
              ids,
              modifiedDate,
            ),
          };
        });
        // Fire-and-forget: the POST no longer returns an authoritative list to
        // reconcile against (the server enforces favorite/reject mutual
        // exclusivity itself), so a stale optimistic update self-corrects on
        // the next fetchFiles hydration.
        const fallbackSource = get().source;
        ids.forEach((id) => {
          const { source, path } = splitFileId(id, fallbackSource);
          void queueFileStateMutation(source, path, 'favorite', true).catch((err) => {
            console.warn('Failed to add file favorite:', err);
          });
        });
      },

      removeFavorites: (ids) => {
        const modifiedDate = Date.now();
        set((s) => ({
          favorites: s.favorites.filter((id) => !ids.includes(id)),
          files: touchFileModifiedDates(s.files, ids, modifiedDate),
          promptSearchResults: touchFileModifiedDates(
            s.promptSearchResults,
            ids,
            modifiedDate,
          ),
        }));
        const fallbackSource = get().source;
        ids.forEach((id) => {
          const { source, path } = splitFileId(id, fallbackSource);
          void queueFileStateMutation(source, path, 'favorite', false).catch((err) => {
            console.warn('Failed to remove file favorite:', err);
          });
        });
      },

      refresh: () => {
        get().fetchFolders();
        get().fetchFiles();
      },

      getDisplayedFiles: () => {
        const {
          files,
          filter,
          favorites,
          rejected,
          showHidden,
          sort,
          source: assetSource,
          currentFolder,
          promptSearchActive,
          promptSearchResults,
        } = get();

        const memoKey = [
          files, filter, favorites, rejected, showHidden, sort, assetSource,
          currentFolder, promptSearchActive, promptSearchResults,
        ] as const;
        if (
          displayedFilesMemo &&
          displayedFilesMemo.key.length === memoKey.length &&
          displayedFilesMemo.key.every((v, i) => v === memoKey[i])
        ) {
          return displayedFilesMemo.value;
        }

        // Prompt-search overlay: rebuild a navigable tree-style view from the
        // recursive match list. Show only (a) matching files that live
        // directly in the current folder, and (b) synthetic folder entries
        // for immediate subfolders whose descendants contain matches.
        let result: FileItem[];
        if (promptSearchActive) {
          const folderPrefix = currentFolder ? `${currentFolder}/` : '';
          const folderEntries = new Map<string, {
            createdDate: number;
            modifiedDate: number;
            count: number;
          }>();
          const directFiles: FileItem[] = [];

          for (const file of promptSearchResults) {
            if (file.type === 'folder') continue;
            // Each match's id is `${source}/${relativePath}`; the relative
            // path is everything after the source prefix.
            const relPath = file.id.startsWith(`${assetSource}/`)
              ? file.id.slice(assetSource.length + 1)
              : file.id;
            if (!relPath.startsWith(folderPrefix)) continue;
            const sub = relPath.slice(folderPrefix.length);
            if (!sub) continue;
            const slashIdx = sub.indexOf('/');
            if (slashIdx === -1) {
              directFiles.push(file);
            } else {
              const childFolderName = sub.slice(0, slashIdx);
              const existing = folderEntries.get(childFolderName);
              const createdDate = file.createdDate ?? file.date ?? 0;
              const modifiedDate = file.modifiedDate ?? file.date ?? 0;
              if (existing) {
                existing.count += 1;
                if (createdDate > existing.createdDate) existing.createdDate = createdDate;
                if (modifiedDate > existing.modifiedDate) existing.modifiedDate = modifiedDate;
              } else {
                folderEntries.set(childFolderName, { createdDate, modifiedDate, count: 1 });
              }
            }
          }

          const syntheticFolders: FileItem[] = Array.from(folderEntries.entries()).map(
            ([childFolderName, info]) => ({
              id: `${assetSource}/${folderPrefix}${childFolderName}`,
              name: childFolderName,
              type: 'folder' as const,
              date: info.modifiedDate,
              createdDate: info.createdDate,
              modifiedDate: info.modifiedDate,
              matchCount: info.count,
            }),
          );

          result = [...syntheticFolders, ...directFiles];
        } else {
          result = [...files];
        }

        // Hidden files filter
        if (!showHidden) {
          result = result.filter(f => !hasHiddenPathSegment(f, assetSource));
        }

        // Search filter (only when prompt search isn't overriding the view)
        if (!promptSearchActive && filter.search) {
          const search = filter.search.toLowerCase();
          result = result.filter(f => f.name.toLowerCase().includes(search));
        }

        // Status-subset filters (favorites / rejects). Files must carry the
        // state themselves, but a folder also survives when a member lives
        // anywhere beneath it — the grid only ever lists one folder at a time,
        // so dropping those folders makes every nested member unreachable. The
        // `favorites`/`rejected` arrays hold the whole set for this source
        // (fetchFiles loads them from the server, not just the current
        // listing), so descendants are a path walk over ids. Folders kept only
        // for their contents carry the count, so the card can say what's inside
        // rather than showing a total item count the filter doesn't apply to.
        //
        // `keepMatchingFolders` differs per state: a folder can be favorited
        // itself, but reject is file-only, so a rejects-filtered folder only
        // survives on its nested count.
        //
        // `exclude` is the mirror: drop whatever carries the state, of either
        // type — a folder that is itself favorited is kept by `only` for being
        // a member, so excluding has to drop it for the same reason.
        //
        // A folder is NOT dropped merely for containing excluded descendants.
        // The listing has no reliable count of what survives beneath a folder
        // (server counts and the member ids disagree about hidden items), and
        // hiding a folder the user could still usefully navigate into would
        // take unrelated files down with it.
        const applyStatusFilter = (
          files: FileItem[],
          memberIds: string[],
          countKey: 'favoriteCount' | 'rejectCount',
          keepMatchingFolders: boolean,
          mode: StatusFilterMode,
        ) => {
          if (mode === 'off') return files;
          if (mode === 'exclude') {
            const excludedIds = new Set(memberIds);
            return files.filter((file) => {
              if (file.type === 'folder' && !keepMatchingFolders) return true;
              return !excludedIds.has(file.id);
            });
          }

          const nestedCounts = new Map<string, number>();
          const prefix = sourcePrefix(assetSource);
          const folderPrefix = currentFolder ? `${currentFolder}/` : '';
          for (const memberId of memberIds) {
            if (!memberId.startsWith(prefix)) continue;
            const relativePath = memberId.slice(prefix.length);
            if (!relativePath.startsWith(folderPrefix)) continue;
            const sub = relativePath.slice(folderPrefix.length);
            const slashIndex = sub.indexOf('/');
            // No slash ⇒ a file sitting directly in this folder, not nested.
            if (slashIndex === -1) continue;
            // Don't count what the current view can't reach: a member behind a
            // dot-folder stays invisible while hidden items are off, so counting
            // it would surface a folder that looks empty once entered.
            if (!showHidden && sub.split('/').some((part) => part.startsWith('.'))) continue;
            const childId = `${prefix}${folderPrefix}${sub.slice(0, slashIndex)}`;
            nestedCounts.set(childId, (nestedCounts.get(childId) ?? 0) + 1);
          }

          const memberIdSet = new Set(memberIds);
          return files.reduce<FileItem[]>((kept, file) => {
            if (file.type !== 'folder') {
              if (memberIdSet.has(file.id)) kept.push(file);
              return kept;
            }
            const nested = nestedCounts.get(file.id) ?? 0;
            if (nested > 0) kept.push({ ...file, [countKey]: nested });
            else if (keepMatchingFolders && memberIdSet.has(file.id)) kept.push(file);
            return kept;
          }, []);
        };

        result = applyStatusFilter(result, favorites, 'favoriteCount', true, filter.favoritesMode);
        result = applyStatusFilter(result, rejected, 'rejectCount', false, filter.rejectsMode);

        // Type filter
        if (filter.type !== 'all') {
          result = result.filter(f => f.type === 'folder' || f.type === filter.type);
        }

        // Sort after filtering to keep search/favorites predictable
        const direction = sort.mode.endsWith('-reverse') ? -1 : 1;
        if (sort.mode.startsWith('name')) {
          result.sort((a, b) => a.name.localeCompare(b.name) * direction);
        } else if (sort.mode.startsWith('size')) {
          result.sort((a, b) => ((a.size ?? 0) - (b.size ?? 0)) * direction);
        } else if (sort.mode.startsWith('created')) {
          result.sort((a, b) => (
            ((a.createdDate ?? a.date ?? 0) - (b.createdDate ?? b.date ?? 0)) * -1 * direction
          ));
        } else {
          result.sort((a, b) => (
            ((a.modifiedDate ?? a.date ?? 0) - (b.modifiedDate ?? b.date ?? 0)) * -1 * direction
          ));
        }

        displayedFilesMemo = { key: memoKey, value: result };
        return result;
      }
    }),
    {
      name: 'outputs-storage',
      version: 5,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      migrate: (persistedState: any, version: number) => {
        if (version === 0) {
          // Migration from old sort { field, order } to { mode }
          if (persistedState.sort && !persistedState.sort.mode) {
            const { field, order } = persistedState.sort;
            if (field === 'name') {
              persistedState.sort = { mode: order === 'asc' ? 'name' : 'name-reverse' };
            } else {
              persistedState.sort = { mode: order === 'desc' ? 'modified' : 'modified-reverse' };
            }
          }
          // Ensure filter has 'type'
          if (persistedState.filter && !persistedState.filter.type) {
            persistedState.filter.type = 'all';
          }
        }
        if (persistedState.filter) {
          const filter = persistedState.filter;
          filter.search = '';
          // v5 turned the two boolean status toggles into off/only/exclude
          // modes. An old `true` only ever meant "only".
          const STATUS_MODES = ['off', 'only', 'exclude'];
          if (!STATUS_MODES.includes(filter.favoritesMode)) {
            filter.favoritesMode = filter.favoritesOnly === true ? 'only' : 'off';
          }
          if (!STATUS_MODES.includes(filter.rejectsMode)) {
            filter.rejectsMode = filter.rejectsOnly === true ? 'only' : 'off';
          }
          delete filter.favoritesOnly;
          delete filter.rejectsOnly;
          // The pair never both narrows; a stale combination would show nothing.
          if (filter.favoritesMode === 'only' && filter.rejectsMode === 'only') {
            filter.rejectsMode = 'off';
          }
        }
        // Reject state moved to the server in v3. Never hydrate the old
        // client-only list: doing so could briefly expose destructive "delete
        // rejected" actions for files the server does not consider rejected.
        if (version < 3) {
          delete persistedState.rejected;
        }
        return persistedState;
      },
      partialize: (state) => ({
        source: state.source,
        // Persist the browse location so a refresh lands the user back where they
        // were instead of at the root of the output folder. currentFolder and the
        // active tab's folder/source are kept in lockstep by every mutation, so a
        // single snapshot restores consistently. folderBySource keeps per-source
        // folders so switching source after a refresh also restores its location.
        currentFolder: state.currentFolder,
        folderBySource: state.folderBySource,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        viewMode: state.viewMode,
        showHidden: state.showHidden,
        sort: state.sort,
        // Never persist the search text.
        filter: { ...state.filter, search: '' },
        favorites: state.favorites,
        migratedFavoriteSources: state.migratedFavoriteSources,
        // `rejected` is server-backed now (see fetchFiles) — no localStorage
        // persistence, so it never goes stale relative to the server.
      })
    }
  )
);

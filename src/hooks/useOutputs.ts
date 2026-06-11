import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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

export interface FilterState {
  search: string;
  favoritesOnly: boolean;
  type: 'all' | 'image' | 'video';
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
  fetchFiles: () => Promise<void>;
  setFilter: (filter: Partial<FilterState>) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchDraft: (query: string) => void;
  setSort: (sort: SortState) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  toggleShowHidden: () => void;
  toggleFavorite: (id: string) => void;
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
        favoritesOnly: false,
        type: 'all'
      },
      sort: {
        mode: 'modified'
      },
      favorites: [],
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

      fetchFiles: async () => {
        const { source, currentFolder, showHidden } = get();
        set({ isLoading: true, error: null });

        try {
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
          // Remember hidden folders we encounter so breadcrumb ancestors can be
          // italicized even once we've navigated down into them.
          const prefix = `${source}/`;
          const seenHiddenFolders = files
            .filter((f) => f.type === 'folder' && f.hidden)
            .map((f) => (f.id.startsWith(prefix) ? f.id.slice(prefix.length) : f.id));
          set((s) => ({
            files,
            isLoading: false,
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
          const filter = { ...s.filter, ...next };
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
          const results = await api.searchUserImagesByPrompt(
            source,
            trimmed,
            currentFolder,
            showHidden,
          );
          set({
            filter: { ...get().filter, search: trimmed },
            searchDraft: trimmed,
            promptSearchActive: true,
            promptSearchResults: results,
            promptSearchQuery: trimmed,
            promptSearchLoading: false,
          });
        } catch (err) {
          console.error('Prompt search failed:', err);
          // Distinguish "the search failed" from "no matches".
          set({
            promptSearchLoading: false,
            promptSearchError: (err as Error).message || 'Prompt search failed',
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
        set((s) => {
          const exists = s.favorites.includes(id);
          return {
            favorites: exists
              ? s.favorites.filter(p => p !== id)
              : [...s.favorites, id]
          };
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
        await Promise.all(ids.map((id) => {
          const path = id.startsWith(prefix) ? id.slice(prefix.length) : id;
          return api.setFileHidden(path, hidden, source).catch((err) => {
            console.error('Failed to update hidden state:', err);
          });
        }));
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
        set((s) => {
          const next = new Set(s.favorites);
          ids.forEach((id) => next.add(id));
          return { favorites: Array.from(next) };
        });
      },

      removeFavorites: (ids) => {
        set((s) => ({
          favorites: s.favorites.filter((id) => !ids.includes(id))
        }));
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
          showHidden,
          sort,
          source: assetSource,
          currentFolder,
          promptSearchActive,
          promptSearchResults,
        } = get();

        const memoKey = [
          files, filter, favorites, showHidden, sort, assetSource,
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
          const folderEntries = new Map<string, { date: number; count: number }>();
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
              const fileDate = file.date ?? 0;
              if (existing) {
                existing.count += 1;
                if (fileDate > existing.date) existing.date = fileDate;
              } else {
                folderEntries.set(childFolderName, { date: fileDate, count: 1 });
              }
            }
          }

          const syntheticFolders: FileItem[] = Array.from(folderEntries.entries()).map(
            ([childFolderName, info]) => ({
              id: `${assetSource}/${folderPrefix}${childFolderName}`,
              name: childFolderName,
              type: 'folder' as const,
              date: info.date,
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

        // Favorites filter (including folders)
        if (filter.favoritesOnly) {
          result = result.filter(f => favorites.includes(f.id));
        }

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
        } else {
          result.sort((a, b) => ((a.date ?? 0) - (b.date ?? 0)) * -1 * direction);
        }

        displayedFilesMemo = { key: memoKey, value: result };
        return result;
      }
    }),
    {
      name: 'outputs-storage',
      version: 2,
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
          persistedState.filter.search = '';
        }
        return persistedState;
      },
      partialize: (state) => ({
        source: state.source,
        viewMode: state.viewMode,
        showHidden: state.showHidden,
        sort: state.sort,
        filter: { ...state.filter, search: '' },
        favorites: state.favorites
      })
    }
  )
);

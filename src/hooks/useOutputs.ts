import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as api from '@/api/client';
import type { FileItem, AssetSource, SortMode } from '@/api/client';

export interface FilterState {
  search: string;
  favoritesOnly: boolean;
  type: 'all' | 'image' | 'video';
}

export interface SortState {
  mode: SortMode;
}

interface OutputsState {
  // Current view state
  source: AssetSource;
  currentFolder: string | null;  // null = root, else path string like 'foo/bar'
  folders: string[];  // Available subfolders for current source
  files: FileItem[];

  // UI state
  isLoading: boolean;
  error: string | null;
  viewMode: 'grid' | 'list';
  showHidden: boolean;
  filter: FilterState;
  sort: SortState;
  favorites: string[];

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
  setSort: (sort: SortState) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  toggleShowHidden: () => void;
  toggleFavorite: (id: string) => void;
  toggleSelectionMode: () => void;
  toggleSelection: (id: string) => void;
  selectAll: () => void;
  selectIds: (ids: string[], mode?: 'add' | 'replace') => void;
  clearSelection: () => void;
  setSelectionActionOpen: (open: boolean) => void;
  setFilterModalOpen: (open: boolean) => void;
  setNewFolderModalOpen: (open: boolean) => void;
  setOutputsViewerOpen: (open: boolean) => void;
  addFavorites: (ids: string[]) => void;
  removeFavorites: (ids: string[]) => void;
  refresh: () => void;
  getDisplayedFiles: () => FileItem[];
}

export const useOutputsStore = create<OutputsState>()(
  persist(
    (set, get) => ({
      source: 'output',
      currentFolder: null,
      folders: [],
      files: [],
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
      selectionMode: false,
      selectedIds: [],
      selectionActionOpen: false,
      filterModalOpen: false,
      newFolderModalOpen: false,
      outputsViewerOpen: false,

      setSource: (source) => {
        set({ source, currentFolder: null, files: [], folders: [], selectionMode: false, selectedIds: [] });
        get().fetchFolders();
        get().fetchFiles();
      },

      setCurrentFolder: (folder) => {
        const { currentFolder } = get();
        const newPath = currentFolder ? `${currentFolder}/${folder}` : folder;
        set({ currentFolder: newPath, files: [], selectionMode: false, selectedIds: [] });
        get().fetchFiles();
      },

      navigateToPath: (path) => {
        set({ currentFolder: path, files: [], selectionMode: false, selectedIds: [] });
        get().fetchFiles();
      },

      navigateUp: () => {
        const { currentFolder } = get();
        if (!currentFolder) return;
        const parts = currentFolder.split('/');
        parts.pop();
        const newPath = parts.length > 0 ? parts.join('/') : null;
        set({ currentFolder: newPath, files: [], selectionMode: false, selectedIds: [] });
        get().fetchFiles();
      },

      fetchFolders: async () => {
        try {
          const result = await api.getUserImageFolders();
          const { source } = get();
          set({ folders: source === 'output' ? result.output : result.input });
        } catch (err) {
          console.error('Failed to fetch folders:', err);
        }
      },

      fetchFiles: async () => {
        const { source, currentFolder, sort } = get();
        set({ isLoading: true, error: null });

        try {
          const files = await api.getUserImages(
            source,
            1000,  // count
            0,     // offset
            sort.mode,
            false, // includeSubfolders
            currentFolder
          );
          set({ files, isLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, isLoading: false });
        }
      },

      setFilter: (next) => {
        set((s) => ({ filter: { ...s.filter, ...next } }));
      },

      setSort: (sort) => {
        set({ sort });
        get().fetchFiles();  // Re-fetch with new sort
      },

      setViewMode: (mode) => {
        set({ viewMode: mode });
      },

      toggleShowHidden: () => {
        set((s) => ({ showHidden: !s.showHidden }));
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
        const { files, filter, favorites, showHidden, sort } = get();

        // Files now includes folders from the mobile API, so we just use files directly
        // Folders are returned first by the API when not in recursive mode
        let result: FileItem[] = [...files];

        // Hidden files filter
        if (!showHidden) {
          result = result.filter(f => !f.name.startsWith('.'));
        }

        // Search filter
        if (filter.search) {
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
          result.sort((a, b) => ((a.date ?? 0) - (b.date ?? 0)) * direction);
        }

        return result;
      }
    }),
    {
      name: 'outputs-storage',
      version: 1,
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
        return persistedState;
      },
      partialize: (state) => ({
        source: state.source,
        viewMode: state.viewMode,
        showHidden: state.showHidden,
        sort: state.sort,
        filter: state.filter,
        favorites: state.favorites
      })
    }
  )
);

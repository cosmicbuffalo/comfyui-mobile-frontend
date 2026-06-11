import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { isPathAtOrUnder, remapRenamedPath } from '@/utils/pathPrefix';

/**
 * Device-local favorites for saved workflows and folders, keyed by the path
 * relative to the workflows dir (e.g. "foo.json" or "sub/foo.json" for files,
 * "sub" for folders). Mirrors the output-favorites persistence pattern.
 */
interface WorkflowFavoritesState {
  favorites: string[];
  toggleFavorite: (path: string) => void;
  /** Remap a path (and, for folders, all descendants) after a rename/move. */
  renameFavorite: (fromPath: string, toPath: string) => void;
  /** Drop a path and any descendants (used when a file/folder is deleted). */
  removeFavoritesUnder: (path: string) => void;
}

export const useWorkflowFavoritesStore = create<WorkflowFavoritesState>()(
  persist(
    (set) => ({
      favorites: [],

      toggleFavorite: (path) => {
        if (!path) return;
        set((s) => ({
          favorites: s.favorites.includes(path)
            ? s.favorites.filter((p) => p !== path)
            : [...s.favorites, path],
        }));
      },

      renameFavorite: (fromPath, toPath) => {
        if (!fromPath || !toPath || fromPath === toPath) return;
        set((s) => ({
          favorites: s.favorites.map((p) => remapRenamedPath(p, fromPath, toPath)),
        }));
      },

      removeFavoritesUnder: (path) => {
        if (!path) return;
        set((s) => ({
          favorites: s.favorites.filter((p) => !isPathAtOrUnder(p, path)),
        }));
      },
    }),
    {
      name: 'workflow-favorites-storage',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

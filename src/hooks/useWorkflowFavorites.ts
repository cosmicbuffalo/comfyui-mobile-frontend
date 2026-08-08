import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  loadWorkflowFavoritesFromServer,
  saveWorkflowFavoritesToServer,
} from '@/api/client';
import { isPathAtOrUnder, remapRenamedPath } from '@/utils/pathPrefix';

/**
 * Server-synced favorites for saved workflows and folders, keyed by the path
 * relative to the workflows dir (e.g. "foo.json" or "sub/foo.json" for files,
 * "sub" for folders). Mirrors the persistence pattern of useWorkflowHidden so
 * bookmarks roam between the React frontend and the iOS app via the same
 * user-data file.
 */
interface WorkflowFavoritesState {
  favorites: string[];
  serverSynced: boolean;
  serverDirty: boolean;
  toggleFavorite: (path: string) => void;
  /** Remap a path (and, for folders, all descendants) after a rename/move. */
  renameFavorite: (fromPath: string, toPath: string) => void;
  /** Drop a path and any descendants (used when a file/folder is deleted). */
  removeFavoritesUnder: (path: string) => void;
  syncFromServer: () => Promise<void>;
  syncToServer: () => Promise<void>;
}

let serverSyncPromise: Promise<void> | null = null;

export const useWorkflowFavoritesStore = create<WorkflowFavoritesState>()(
  persist(
    (set, get) => ({
      favorites: [],
      serverSynced: false,
      serverDirty: false,

      toggleFavorite: (path) => {
        if (!path) return;
        set((s) => ({
          favorites: s.favorites.includes(path)
            ? s.favorites.filter((p) => p !== path)
            : [...s.favorites, path],
          serverDirty: true,
        }));
        void get().syncToServer();
      },

      renameFavorite: (fromPath, toPath) => {
        if (!fromPath || !toPath || fromPath === toPath) return;
        set((s) => ({
          favorites: s.favorites.map((p) => remapRenamedPath(p, fromPath, toPath)),
          serverDirty: true,
        }));
        void get().syncToServer();
      },

      removeFavoritesUnder: (path) => {
        if (!path) return;
        set((s) => ({
          favorites: s.favorites.filter((p) => !isPathAtOrUnder(p, path)),
          serverDirty: true,
        }));
        void get().syncToServer();
      },

      syncFromServer: async () => {
        if (get().serverDirty) {
          set({ serverSynced: true });
          await get().syncToServer();
          return;
        }

        const remote = await loadWorkflowFavoritesFromServer();
        if (get().serverDirty) {
          set({ serverSynced: true });
          await get().syncToServer();
          return;
        }
        if (remote === undefined) return;
        if (remote === null) {
          // Server has no file yet. If we have local entries (from the old
          // localStorage-only days, or just from this device having
          // favorites before the user reached the sync code path), push them
          // up so the server picks up our existing state.
          if (get().favorites.length > 0) {
            set({ serverDirty: true, serverSynced: true });
            await get().syncToServer();
          } else {
            set({ serverSynced: true });
          }
          return;
        }

        set({ favorites: remote, serverSynced: true, serverDirty: false });
      },

      syncToServer: async () => {
        if (!get().serverSynced) return;
        if (serverSyncPromise) return serverSyncPromise;

        serverSyncPromise = (async () => {
          while (get().serverSynced && get().serverDirty) {
            const favorites = get().favorites;
            try {
              await saveWorkflowFavoritesToServer(favorites);
            } catch {
              // Keep the dirty flag so the next panel open/startup retries.
              return;
            }
            if (get().favorites === favorites) set({ serverDirty: false });
          }
        })().finally(() => {
          serverSyncPromise = null;
        });
        return serverSyncPromise;
      },
    }),
    {
      name: 'workflow-favorites-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        favorites: state.favorites,
        serverDirty: state.serverDirty,
      }),
    },
  ),
);

function syncAfterHydration() {
  void useWorkflowFavoritesStore.getState().syncFromServer();
}

// Match useWorkflowHidden: skip startup network side-effects in test mode
// where the API barrel is often mocked narrowly.
if (import.meta.env.MODE !== 'test') {
  if (useWorkflowFavoritesStore.persist.hasHydrated()) {
    syncAfterHydration();
  } else {
    const unsubscribe = useWorkflowFavoritesStore.persist.onFinishHydration(() => {
      unsubscribe();
      syncAfterHydration();
    });
  }
}

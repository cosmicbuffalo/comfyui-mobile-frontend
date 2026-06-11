import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  loadWorkflowHiddenFromServer,
  saveWorkflowHiddenToServer,
} from '@/api/client';
import { isPathAtOrUnder, remapRenamedPath } from '@/utils/pathPrefix';
import { setCurrentHiddenWorkflowPaths } from '@/utils/workflowHidden';

/**
 * Server-synced "hidden" marks for saved workflows and folders, keyed by the
 * path relative to the workflows dir (e.g. "foo.json" or "sub/foo.json" for
 * files, "sub" for folders). This is a declutter toggle, not access control.
 */
interface WorkflowHiddenState {
  hidden: string[];
  serverSynced: boolean;
  serverDirty: boolean;
  toggleHidden: (path: string) => void;
  /** Remap a path (and, for folders, all descendants) after a rename/move. */
  renameHidden: (fromPath: string, toPath: string) => void;
  /** Drop a path and any descendants (used when a file/folder is deleted). */
  removeHiddenUnder: (path: string) => void;
  syncFromServer: () => Promise<void>;
  syncToServer: () => Promise<void>;
}

let serverSyncPromise: Promise<void> | null = null;

export const useWorkflowHiddenStore = create<WorkflowHiddenState>()(
  persist(
    (set, get) => ({
      hidden: [],
      serverSynced: false,
      serverDirty: false,

      toggleHidden: (path) => {
        if (!path) return;
        set((s) => ({
          hidden: s.hidden.includes(path)
            ? s.hidden.filter((p) => p !== path)
            : [...s.hidden, path],
          serverDirty: true,
        }));
        void get().syncToServer();
      },

      renameHidden: (fromPath, toPath) => {
        if (!fromPath || !toPath || fromPath === toPath) return;
        set((s) => ({
          hidden: s.hidden.map((p) => remapRenamedPath(p, fromPath, toPath)),
          serverDirty: true,
        }));
        void get().syncToServer();
      },

      removeHiddenUnder: (path) => {
        if (!path) return;
        set((s) => ({
          hidden: s.hidden.filter((p) => !isPathAtOrUnder(p, path)),
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

        const remote = await loadWorkflowHiddenFromServer();
        if (get().serverDirty) {
          set({ serverSynced: true });
          await get().syncToServer();
          return;
        }
        if (remote === undefined) return;
        if (remote === null) {
          if (get().hidden.length > 0) {
            set({ serverDirty: true, serverSynced: true });
            await get().syncToServer();
          } else {
            set({ serverSynced: true });
          }
          return;
        }

        set({ hidden: remote, serverSynced: true, serverDirty: false });
      },

      syncToServer: async () => {
        if (!get().serverSynced) return;
        if (serverSyncPromise) return serverSyncPromise;

        serverSyncPromise = (async () => {
          while (get().serverSynced && get().serverDirty) {
            const hidden = get().hidden;
            try {
              await saveWorkflowHiddenToServer(hidden);
            } catch {
              // Keep the dirty flag so the next panel open/startup retries.
              return;
            }
            if (get().hidden === hidden) set({ serverDirty: false });
          }
        })().finally(() => {
          serverSyncPromise = null;
        });
        return serverSyncPromise;
      },
    }),
    {
      name: 'workflow-hidden-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        hidden: state.hidden,
        serverDirty: state.serverDirty,
      }),
    },
  ),
);

setCurrentHiddenWorkflowPaths(useWorkflowHiddenStore.getState().hidden);
useWorkflowHiddenStore.subscribe((state) => {
  setCurrentHiddenWorkflowPaths(state.hidden);
});

function syncAfterHydration() {
  void useWorkflowHiddenStore.getState().syncFromServer();
}

// Unit tests call synchronization explicitly and often replace the API barrel
// with narrow mocks, so avoid startup network side effects in that environment.
if (import.meta.env.MODE !== 'test') {
  if (useWorkflowHiddenStore.persist.hasHydrated()) {
    syncAfterHydration();
  } else {
    const unsubscribe = useWorkflowHiddenStore.persist.onFinishHydration(() => {
      unsubscribe();
      syncAfterHydration();
    });
  }
}

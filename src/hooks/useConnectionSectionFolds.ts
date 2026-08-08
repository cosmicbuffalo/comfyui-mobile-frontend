import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// Connections sections default to OPEN, so we track the keys the user has
// explicitly collapsed (mirrors the parameter fold store). Persisted to
// localStorage like other per-node UI state.
interface ConnectionSectionFoldsState {
  collapsedItemKeys: string[];
  toggleCollapsed: (itemKey: string) => void;
  /** Idempotently unfold a node's connections section (no-op if already open). */
  expand: (itemKey: string) => void;
}

export const useConnectionSectionFoldsStore = create<ConnectionSectionFoldsState>()(
  persist(
    (set) => ({
      collapsedItemKeys: [],
      toggleCollapsed: (itemKey) => {
        if (!itemKey) return;
        set((state) => ({
          collapsedItemKeys: state.collapsedItemKeys.includes(itemKey)
            ? state.collapsedItemKeys.filter((key) => key !== itemKey)
            : [...state.collapsedItemKeys, itemKey],
        }));
      },
      expand: (itemKey) => {
        if (!itemKey) return;
        set((state) =>
          state.collapsedItemKeys.includes(itemKey)
            ? { collapsedItemKeys: state.collapsedItemKeys.filter((key) => key !== itemKey) }
            : state,
        );
      },
    }),
    {
      name: 'connection-section-folds-storage',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

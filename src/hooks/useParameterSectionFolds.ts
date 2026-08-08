import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// Parameters sections default to OPEN, so we track the keys the user has
// explicitly collapsed (the inverse of the connections fold store, which is
// default-closed). Persisted to localStorage like other per-node UI state.
interface ParameterSectionFoldsState {
  collapsedItemKeys: string[];
  toggleCollapsed: (itemKey: string) => void;
  /** Ensure a node's parameters section is open (used for newly created nodes). */
  expand: (itemKey: string) => void;
}

export const useParameterSectionFoldsStore = create<ParameterSectionFoldsState>()(
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
      name: 'parameter-section-folds-storage',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

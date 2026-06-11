import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface ConnectionSectionFoldsState {
  expandedItemKeys: string[];
  toggleExpanded: (itemKey: string) => void;
  /** Idempotently unfold a node's connections section (no-op if already open). */
  expand: (itemKey: string) => void;
}

export const useConnectionSectionFoldsStore = create<ConnectionSectionFoldsState>()(
  persist(
    (set) => ({
      expandedItemKeys: [],
      toggleExpanded: (itemKey) => {
        if (!itemKey) return;
        set((state) => ({
          expandedItemKeys: state.expandedItemKeys.includes(itemKey)
            ? state.expandedItemKeys.filter((key) => key !== itemKey)
            : [...state.expandedItemKeys, itemKey],
        }));
      },
      expand: (itemKey) => {
        if (!itemKey) return;
        set((state) =>
          state.expandedItemKeys.includes(itemKey)
            ? state
            : { expandedItemKeys: [...state.expandedItemKeys, itemKey] },
        );
      },
    }),
    {
      name: 'connection-section-folds-storage',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

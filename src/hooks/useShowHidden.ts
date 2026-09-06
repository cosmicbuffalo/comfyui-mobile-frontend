import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface ShowHiddenState {
  showHidden: boolean;
  setShowHidden: (showHidden: boolean) => void;
  toggleShowHidden: () => void;
}

const SHOW_HIDDEN_STORAGE_KEY = 'show-hidden-storage';

function hasPersistedPreference(): boolean {
  try {
    return localStorage.getItem(SHOW_HIDDEN_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function readLegacyOutputsPreference(): boolean {
  try {
    const raw = localStorage.getItem('outputs-storage');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { state?: { showHidden?: unknown } };
    return parsed.state?.showHidden === true;
  } catch {
    return false;
  }
}

/** One persisted visibility preference shared by every hidden-capable browser. */
const hadPersistedPreference = hasPersistedPreference();
const initialShowHidden = readLegacyOutputsPreference();
export const useShowHiddenStore = create<ShowHiddenState>()(
  persist(
    (set) => ({
      // Preserve the old Outputs-only preference on the first upgraded load.
      showHidden: initialShowHidden,
      setShowHidden: (showHidden) => set({ showHidden }),
      toggleShowHidden: () => set((state) => ({ showHidden: !state.showHidden })),
    }),
    {
      name: SHOW_HIDDEN_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ showHidden: state.showHidden }),
    },
  ),
);

// Creating a persist store does not write its initial state when no record
// exists. Commit the migrated Outputs-only value now so deleting that legacy
// field cannot lose the preference on the following refresh.
if (!hadPersistedPreference) {
  useShowHiddenStore.getState().setShowHidden(initialShowHidden);
}

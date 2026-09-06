import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';

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

/**
 * localStorage that drops a refused write instead of throwing it. `setItem`
 * raises when the origin is over quota — and unconditionally on an iOS Safari
 * whose private-browsing quota is zero — while this store commits its migrated
 * value at module scope (below). Unguarded, that write would take the whole app
 * down over a decluttering toggle; persistence is the expendable half, so the
 * preference just stays in memory for the session. Same guard the workflow
 * store's backend already uses (`utils/idbStorage`).
 */
function quotaSafeLocalStorage(): StateStorage {
  // Read the property here so a browser that blocks storage outright still
  // throws out of this factory, which is where createJSONStorage catches it and
  // disables persistence for us.
  const storage = localStorage;
  return {
    getItem: (name) => storage.getItem(name),
    setItem: (name, value) => {
      try {
        storage.setItem(name, value);
      } catch {
        // No room to persist; the in-memory preference still holds.
      }
    },
    removeItem: (name) => storage.removeItem(name),
  };
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
      storage: createJSONStorage(quotaSafeLocalStorage),
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

import { create } from 'zustand';

interface RowMenuState {
  /** Key of the row whose menu is open, or null when none is. */
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
  toggleKey: (key: string) => void;
}

/**
 * Which row menu is open, held outside the rows themselves.
 *
 * A row's menu used to keep its own `open` state, which meant the menu died
 * whenever React remounted the row — and reordering a slot does exactly that,
 * since a widget row is keyed partly by its value index. The tap that opened
 * the menu was discarded by the remount that followed it, so the first tap
 * after a move appeared to do nothing and the second one worked.
 *
 * Keying by row identity rather than position also makes "only one menu open at
 * a time" fall out for free.
 */
export const useRowMenuStore = create<RowMenuState>((set, get) => ({
  openKey: null,
  setOpenKey: (key) => set({ openKey: key }),
  toggleKey: (key) => set({ openKey: get().openKey === key ? null : key }),
}));

/**
 * Forget any open menu. Called when the ground moves under it — a scope change,
 * a workflow load, a tab switch — because a key names a row within a scope, and
 * the same key can name a different row after the move.
 */
export function closeAnyRowMenu(): void {
  if (useRowMenuStore.getState().openKey !== null) {
    useRowMenuStore.setState({ openKey: null });
  }
}

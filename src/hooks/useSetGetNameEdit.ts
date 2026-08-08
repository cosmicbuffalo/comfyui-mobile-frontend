import { create } from 'zustand';

// Tracks which Set/Get node's relay name is being edited inline. Set from the
// node context menu ("Edit set name"); read by the node's outgoing connection
// button, which swaps its label for an input while this matches its item key.
interface SetGetNameEditState {
  editingItemKey: string | null;
  startEdit: (itemKey: string) => void;
  stopEdit: () => void;
}

export const useSetGetNameEditStore = create<SetGetNameEditState>((set) => ({
  editingItemKey: null,
  startEdit: (itemKey) => set({ editingItemKey: itemKey }),
  stopEdit: () => set({ editingItemKey: null }),
}));

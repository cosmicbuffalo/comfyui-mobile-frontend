import { create } from 'zustand';

// Multi-select mode for the workflow panel — mirrors the outputs panel's select
// mode but over workflow items (nodes, groups, subgraph placeholders). Selection
// is an explicit set of item keys (HierarchicalKey strings). Groups are atomic:
// selecting one never implicitly changes the selection state of its contents.
// Selection is scoped to the current view and is cleared
// when the scope changes (entering/exiting a subgraph) — see WorkflowPanel.
interface WorkflowSelectionState {
  selectionMode: boolean;
  // Insertion-ordered set of selected item keys. An array (not a Set) so Zustand
  // change detection and React renders stay simple; sizes here are small.
  selectedKeys: string[];
  // True while the bulk-operations menu (copy / create group / delete) is open.
  actionMenuOpen: boolean;

  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  toggleSelectionMode: () => void;
  setActionMenuOpen: (open: boolean) => void;

  isSelected: (key: string) => boolean;
  // Add the given keys to the selection (deduped). Used by the explicit group
  // children / descendants controls.
  selectKeys: (keys: string[]) => void;
  // Remove the given keys from the selection.
  deselectKeys: (keys: string[]) => void;
  // Toggle exactly one item. Container contents are selected explicitly through
  // the group-level children / descendants actions in WorkflowPanel.
  toggleKey: (key: string) => void;
  clearSelection: () => void;
}

export const useWorkflowSelectionStore = create<WorkflowSelectionState>((set, get) => ({
  selectionMode: false,
  selectedKeys: [],
  actionMenuOpen: false,

  enterSelectionMode: () => set({ selectionMode: true }),
  exitSelectionMode: () =>
    set({ selectionMode: false, selectedKeys: [], actionMenuOpen: false }),
  toggleSelectionMode: () => {
    if (get().selectionMode) {
      set({ selectionMode: false, selectedKeys: [], actionMenuOpen: false });
    } else {
      set({ selectionMode: true });
    }
  },
  setActionMenuOpen: (open) => set({ actionMenuOpen: open }),

  isSelected: (key) => get().selectedKeys.includes(key),

  selectKeys: (keys) =>
    set((state) => {
      if (keys.length === 0) return state;
      const next = new Set(state.selectedKeys);
      for (const key of keys) next.add(key);
      if (next.size === state.selectedKeys.length) return state;
      return { selectedKeys: Array.from(next) };
    }),

  deselectKeys: (keys) =>
    set((state) => {
      if (keys.length === 0) return state;
      const remove = new Set(keys);
      const filtered = state.selectedKeys.filter((k) => !remove.has(k));
      if (filtered.length === state.selectedKeys.length) return state;
      return { selectedKeys: filtered };
    }),

  toggleKey: (key) =>
    set((state) => {
      if (state.selectedKeys.includes(key)) {
        return { selectedKeys: state.selectedKeys.filter((k) => k !== key) };
      }
      return { selectedKeys: [...state.selectedKeys, key] };
    }),

  clearSelection: () => set({ selectedKeys: [], actionMenuOpen: false }),
}));

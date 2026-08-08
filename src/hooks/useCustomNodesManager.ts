import { create } from 'zustand';
import type { CustomNodeFilterValue } from '@/utils/customNodesManager';

interface CustomNodesManagerState {
  // A pending request to open the Custom Nodes Manager, optionally pre-filtered
  // (e.g. to "Missing" from the missing-nodes dialog) and pre-searched (e.g. a
  // specific missing node type from its on-canvas popover). AppMenu (which owns
  // the modal) consumes it. `''` filter means the default "All" view.
  request: { filter: CustomNodeFilterValue; search?: string } | null;
  open: (filter?: CustomNodeFilterValue, search?: string) => void;
  consume: () => void;
}

export const useCustomNodesManager = create<CustomNodesManagerState>((set) => ({
  request: null,
  open: (filter, search) => set({ request: { filter: filter ?? '', search } }),
  consume: () => set({ request: null }),
}));

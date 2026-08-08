import { create } from 'zustand';
import type {
  WorkflowGroup,
  WorkflowNode,
  WorkflowSubgraphDefinition,
} from '@/api/types';

// A copied internal connection, normalized to a scope-agnostic shape (paste
// rebuilds it as a root tuple or subgraph object depending on the target scope).
export interface ClipboardLink {
  originId: number;
  originSlot: number;
  targetId: number;
  targetSlot: number;
  type: string;
}

// A self-contained snapshot of copied items, holding the source ids. Paste
// re-ids everything and remaps these internal links; connections to nodes that
// weren't copied (the selection boundary) are not included, so they paste
// disconnected.
export interface WorkflowClipboardPayload {
  nodes: WorkflowNode[];
  links: ClipboardLink[];
  subgraphs: WorkflowSubgraphDefinition[];
  // Set when a whole group was copied (its members are in `nodes`).
  group: WorkflowGroup | null;
  // Human-readable summary for the paste menu items, e.g. "3 nodes".
  summary: string;
}

interface WorkflowClipboardState {
  payload: WorkflowClipboardPayload | null;
  setPayload: (payload: WorkflowClipboardPayload | null) => void;
  clear: () => void;
}

// In-memory only (not persisted): the copy buffer lives for the app session and
// is shared across all workflow tabs, so you can copy in one tab and paste in
// another.
export const useWorkflowClipboardStore = create<WorkflowClipboardState>((set) => ({
  payload: null,
  setPayload: (payload) => set({ payload }),
  clear: () => set({ payload: null }),
}));

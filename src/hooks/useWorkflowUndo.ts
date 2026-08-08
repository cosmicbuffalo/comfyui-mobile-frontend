import { create } from 'zustand';
import type { Workflow, WorkflowNode } from '@/api/types';
import type { MobileLayout } from '@/utils/mobileLayout';
import type { HierarchicalKey } from '@/utils/workflowHierarchy';
import { useWorkflowStore, type ScopeFrame } from '@/hooks/useWorkflow';
import { diffWorkflowChange } from '@/utils/workflowUndoDiff';
import {
  inUndoTransaction,
  isUndoTransactionRecorded,
  markUndoTransactionRecorded,
} from '@/utils/undoTransaction';

// Snapshot-based undo/redo. Each step is a clone of the prior canonical state —
// restored atomically, so we never reason about per-action inverses. Captured
// through a single store subscription (can't miss an edit), seed-only changes
// excluded, rapid widget edits coalesced, separate history per workflow tab.

const MAX_STEPS = 10;
const COALESCE_MS = 600;

interface UndoSnapshot {
  workflow: Workflow;
  mobileLayout: MobileLayout;
  itemKeyByPointer: Record<string, HierarchicalKey>;
  pointerByHierarchicalKey: Record<HierarchicalKey, string>;
  // Node ids that changed in the edit this snapshot brackets — for scroll-to.
  changedNodeIds: number[];
}

interface TabHistory {
  undo: UndoSnapshot[];
  redo: UndoSnapshot[];
}

interface WorkflowUndoState {
  histories: Record<string, TabHistory>;
  undo: () => void;
  redo: () => void;
}

// Restoring a snapshot must not record itself; rapid same-node widget edits
// coalesce into one step. Both tracked outside the store (transient).
let applyingUndoRedo = false;
let lastRecord: { sessionId: string | null; time: number; structural: boolean; nodeId: number | null } = {
  sessionId: null,
  time: 0,
  structural: true,
  nodeId: null,
};

function nodesById(workflow: Workflow): Map<number, WorkflowNode> {
  const map = new Map<number, WorkflowNode>();
  for (const node of workflow.nodes ?? []) map.set(node.id, node);
  for (const sg of workflow.definitions?.subgraphs ?? []) {
    for (const node of sg.nodes ?? []) map.set(node.id, node);
  }
  return map;
}

interface CanonicalState {
  workflow: Workflow;
  mobileLayout: MobileLayout;
  itemKeyByPointer: Record<string, HierarchicalKey>;
  pointerByHierarchicalKey: Record<HierarchicalKey, string>;
}

function cloneCanonical(state: CanonicalState, changedNodeIds: number[]): UndoSnapshot {
  return {
    workflow: structuredClone(state.workflow),
    mobileLayout: structuredClone(state.mobileLayout),
    itemKeyByPointer: structuredClone(state.itemKeyByPointer),
    pointerByHierarchicalKey: structuredClone(state.pointerByHierarchicalKey),
    changedNodeIds,
  };
}

// Pull the canonical fields out of the live store state (or null when no workflow).
function canonicalFromState(state: ReturnType<typeof useWorkflowStore.getState>): CanonicalState | null {
  if (!state.workflow) return null;
  return {
    workflow: state.workflow,
    mobileLayout: state.mobileLayout,
    itemKeyByPointer: state.itemKeyByPointer,
    pointerByHierarchicalKey: state.pointerByHierarchicalKey,
  };
}

// After restoring, reveal + scroll to the first changed node that exists in the
// restored workflow (a removed node is back; a node that was added is gone — fall
// through to the next candidate or skip).
function scrollToChange(workflow: Workflow, changedNodeIds: number[]): void {
  if (changedNodeIds.length === 0) return;
  const byId = nodesById(workflow);
  for (const id of changedNodeIds) {
    const key = byId.get(id)?.itemKey;
    if (key) {
      setTimeout(() => {
        const store = useWorkflowStore.getState();
        store.revealNodeWithParents(key);
        store.scrollToNode(key);
      }, 0);
      return;
    }
  }
}


// A snapshot restores the graph but NOT the browsing scope, which the store owns
// separately (enterSubgraph/exitSubgraph). Undoing past the creation of the
// subgraph the user is currently inside would otherwise leave scopeStack
// pointing at a definition the restored workflow no longer has: the panel
// renders an empty node list under a breadcrumb for a subgraph that isn't there,
// which reads as "my whole workflow vanished". Truncate to the deepest frame
// that still resolves, so the user surfaces to the nearest real scope instead.
function scopeStackForWorkflow(
  scopeStack: ScopeFrame[],
  workflow: Workflow | null,
): ScopeFrame[] {
  const definitions = workflow?.definitions?.subgraphs ?? [];
  const kept: ScopeFrame[] = [];
  for (const frame of scopeStack) {
    if (frame.type !== 'subgraph') {
      kept.push(frame);
      continue;
    }
    if (!definitions.some((definition) => definition.id === frame.id)) break;
    kept.push(frame);
  }
  return kept.length > 0 ? kept : [{ type: 'root' }];
}

export const useWorkflowUndoStore = create<WorkflowUndoState>((set, get) => ({
  histories: {},

  undo: () => {
    const wf = useWorkflowStore.getState();
    const sessionId = wf.activeSessionId;
    if (!sessionId) return;
    const history = get().histories[sessionId];
    if (!history || history.undo.length === 0) return;
    const current = canonicalFromState(wf);
    if (!current) return;
    const target = history.undo[history.undo.length - 1];
    // The current state rolls onto the redo stack so it can be rolled forward.
    const currentForRedo = cloneCanonical(current, target.changedNodeIds);

    applyingUndoRedo = true;
    const restoredWorkflow = structuredClone(target.workflow);
    useWorkflowStore.setState({
      workflow: restoredWorkflow,
      mobileLayout: structuredClone(target.mobileLayout),
      itemKeyByPointer: structuredClone(target.itemKeyByPointer),
      pointerByHierarchicalKey: structuredClone(target.pointerByHierarchicalKey),
      scopeStack: scopeStackForWorkflow(wf.scopeStack, restoredWorkflow),
    });
    applyingUndoRedo = false;

    set((state) => {
      const h = state.histories[sessionId] ?? { undo: [], redo: [] };
      const redo = [...h.redo, currentForRedo];
      if (redo.length > MAX_STEPS) redo.shift();
      return {
        histories: { ...state.histories, [sessionId]: { undo: h.undo.slice(0, -1), redo } },
      };
    });
    lastRecord = { sessionId: null, time: 0, structural: true, nodeId: null };
    scrollToChange(target.workflow, target.changedNodeIds);
  },

  redo: () => {
    const wf = useWorkflowStore.getState();
    const sessionId = wf.activeSessionId;
    if (!sessionId) return;
    const history = get().histories[sessionId];
    if (!history || history.redo.length === 0) return;
    const current = canonicalFromState(wf);
    if (!current) return;
    const target = history.redo[history.redo.length - 1];
    const currentForUndo = cloneCanonical(current, target.changedNodeIds);

    applyingUndoRedo = true;
    const restoredWorkflow = structuredClone(target.workflow);
    useWorkflowStore.setState({
      workflow: restoredWorkflow,
      mobileLayout: structuredClone(target.mobileLayout),
      itemKeyByPointer: structuredClone(target.itemKeyByPointer),
      pointerByHierarchicalKey: structuredClone(target.pointerByHierarchicalKey),
      scopeStack: scopeStackForWorkflow(wf.scopeStack, restoredWorkflow),
    });
    applyingUndoRedo = false;

    set((state) => {
      const h = state.histories[sessionId] ?? { undo: [], redo: [] };
      const undo = [...h.undo, currentForUndo];
      if (undo.length > MAX_STEPS) undo.shift();
      return {
        histories: { ...state.histories, [sessionId]: { undo, redo: h.redo.slice(0, -1) } },
      };
    });
    lastRecord = { sessionId: null, time: 0, structural: true, nodeId: null };
    scrollToChange(target.workflow, target.changedNodeIds);
  },
}));

// Prune history for tabs that no longer exist (closed) to avoid leaks.
function pruneClosedSessions(activeSessionId: string | null, parkedSessions: Record<string, unknown>): void {
  const live = new Set<string>(Object.keys(parkedSessions));
  if (activeSessionId) live.add(activeSessionId);
  const { histories } = useWorkflowUndoStore.getState();
  let changed = false;
  const next: Record<string, TabHistory> = {};
  for (const [id, history] of Object.entries(histories)) {
    if (live.has(id)) next[id] = history;
    else changed = true;
  }
  if (changed) useWorkflowUndoStore.setState({ histories: next });
}

// The single capture point. Fires on every store change but early-outs unless the
// canonical `workflow` actually changed (so it's free during execution).
useWorkflowStore.subscribe((state, prev) => {
  if (state.parkedSessions !== prev.parkedSessions) {
    pruneClosedSessions(state.activeSessionId, state.parkedSessions);
  }
  if (applyingUndoRedo) return;
  if (state.workflow === prev.workflow) return;
  const sessionId = state.activeSessionId;
  if (!sessionId || !state.workflow || !prev.workflow) return;
  // A tab switch swaps in another tab's workflow — not an edit.
  if (sessionId !== prev.activeSessionId) return;
  // A fresh load/reload/revert into this tab resets its history.
  if (state.workflowLoadedAt !== prev.workflowLoadedAt) {
    useWorkflowUndoStore.setState((s) => {
      if (!s.histories[sessionId]) return s;
      const next = { ...s.histories };
      delete next[sessionId];
      return { histories: next };
    });
    lastRecord = { sessionId: null, time: 0, structural: true, nodeId: null };
    return;
  }

  const diff = diffWorkflowChange(prev.workflow, state.workflow, state.nodeTypes);
  if (!diff.meaningful) return; // seed-only or no real change

  // A composite action (e.g. pop-out: materialize slot + add node + set value
  // + connect) runs inside an undo transaction: the first meaningful change
  // pushes the bracketing snapshot below; the rest only extend its changed-ids
  // so a single Undo rolls the whole action back.
  if (inUndoTransaction() && isUndoTransactionRecorded()) {
    const sessionIdForMerge = sessionId;
    useWorkflowUndoStore.setState((s) => {
      const history = s.histories[sessionIdForMerge];
      if (!history || history.undo.length === 0) return s;
      const last = history.undo[history.undo.length - 1];
      const merged = Array.from(new Set([...last.changedNodeIds, ...diff.changedNodeIds]));
      const undo = [...history.undo.slice(0, -1), { ...last, changedNodeIds: merged }];
      return { histories: { ...s.histories, [sessionIdForMerge]: { ...history, undo } } };
    });
    lastRecord = { sessionId, time: Date.now(), structural: true, nodeId: null };
    return;
  }
  if (inUndoTransaction()) markUndoTransactionRecorded();

  const now = Date.now();
  const singleNode = diff.changedNodeIds.length === 1 ? diff.changedNodeIds[0] : null;
  const coalesce =
    !diff.structural &&
    singleNode != null &&
    lastRecord.sessionId === sessionId &&
    lastRecord.nodeId === singleNode &&
    !lastRecord.structural &&
    now - lastRecord.time < COALESCE_MS;
  lastRecord = { sessionId, time: now, structural: diff.structural, nodeId: singleNode };
  if (coalesce) return; // extend the current step (its snapshot already brackets the burst start)

  const prevCanonical = canonicalFromState(prev);
  if (!prevCanonical) return;
  const snapshot = cloneCanonical(prevCanonical, diff.changedNodeIds);
  useWorkflowUndoStore.setState((s) => {
    const history = s.histories[sessionId] ?? { undo: [], redo: [] };
    const undo = [...history.undo, snapshot];
    if (undo.length > MAX_STEPS) undo.shift();
    // Any new edit invalidates the redo branch.
    return { histories: { ...s.histories, [sessionId]: { undo, redo: [] } } };
  });
});

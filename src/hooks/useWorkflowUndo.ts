import { create } from 'zustand';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import type { MobileLayout } from '@/utils/mobileLayout';
import type { HierarchicalKey } from '@/utils/workflowHierarchy';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { diffWorkflowChange, type WorkflowChangeTarget } from '@/utils/workflowUndoDiff';
import { reconcileScopeStack } from '@/utils/subgraphInstanceNavigation';
import type { WorkflowJumpTarget } from '@/utils/workflowJumpTargets';
import {
  resolveGroupDisplayName,
  resolveNodeDisplayName,
  resolveWidgetRow,
} from '@/utils/workflowItemNames';
import { widgetRowDomId } from '@/utils/workflowJumpTargets';
import { PROXY_INDEX_OFFSET } from '@/utils/widgetDefinitions';
import { t } from '@/i18n';
import {
  clearUndoHistoryStorage,
  flushUndoHistory,
  loadUndoHistory,
  writeUndoHistory,
  type PersistedUndoIndex,
} from '@/utils/undoHistoryStorage';
import {
  getUndoTransactionActionLabel,
  inUndoTransaction,
  isUndoTransactionRecorded,
  markUndoTransactionRecorded,
} from '@/utils/undoTransaction';

// Snapshot-based undo/redo. Each step is a clone of the prior canonical state —
// restored atomically, so we never reason about per-action inverses. Captured
// through a single store subscription (can't miss an edit), seed-only changes
// excluded, rapid widget edits coalesced, separate history per workflow tab,
// and persisted (see utils/undoHistoryStorage) so a refresh keeps it.

const MAX_STEPS = 10;
const COALESCE_MS = 600;

interface UndoSnapshot {
  /** Stable identity for the persisted body of this snapshot. */
  id: string;
  workflow: Workflow;
  mobileLayout: MobileLayout;
  itemKeyByPointer: Record<string, HierarchicalKey>;
  pointerByHierarchicalKey: Record<HierarchicalKey, string>;
  // Node ids that changed in the edit this snapshot brackets — used to decide
  // whether a burst of edits all belongs to one node, and so coalesces.
  changedNodeIds: number[];
  // What the edit touched, for the scroll-and-flash after a restore.
  changedTargets: WorkflowChangeTarget[];
  actionLabel?: string;
}

/** The subtitle line of the toast: which item the step moved, and how many more. */
export interface UndoFeedbackTarget {
  name: string;
  id: number;
  /** The widget row the step changed, when it changed exactly one. */
  widgetLabel?: string;
  /** Items the step also changed, beyond the one named. */
  extraCount: number;
}

interface TabHistory {
  undo: UndoSnapshot[];
  redo: UndoSnapshot[];
}

interface WorkflowUndoState {
  histories: Record<string, TabHistory>;
  feedback: {
    id: number;
    direction: 'undo' | 'redo';
    actionLabel: string;
    /** What the step changed, named the way its card names itself. */
    target: UndoFeedbackTarget | null;
  } | null;
  undo: () => void;
  redo: () => void;
  clearFeedback: (id: number) => void;
}

// Restoring a snapshot must not record itself; rapid same-node widget edits
// coalesce into one step. Both tracked outside the store (transient).
let applyingUndoRedo = false;
let feedbackId = 0;
let snapshotSeq = 0;
let lastRecord: { sessionId: string | null; time: number; structural: boolean; nodeId: number | null } = {
  sessionId: null,
  time: 0,
  structural: true,
  nodeId: null,
};

// Ids must be unique across page loads without waiting for hydration: an edit
// made while hydrateFromStorage is still reading IndexedDB used to mint "s1" —
// the very id a stored history starts with — and the colliding body was then
// shared by two tabs, so Undo in one restored the other's workflow. A per-boot
// nonce makes a fresh id unable to collide with anything already on disk.
const snapshotBootNonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4)
  .toString(36)
  .padStart(4, '0')}`;

function nextSnapshotId(): string {
  snapshotSeq += 1;
  return `s${snapshotBootNonce}-${snapshotSeq}`;
}

interface CanonicalState {
  workflow: Workflow;
  mobileLayout: MobileLayout;
  itemKeyByPointer: Record<string, HierarchicalKey>;
  pointerByHierarchicalKey: Record<HierarchicalKey, string>;
}

function cloneCanonical(
  state: CanonicalState,
  changedNodeIds: number[],
  changedTargets: WorkflowChangeTarget[],
  actionLabel?: string,
): UndoSnapshot {
  return {
    id: nextSnapshotId(),
    workflow: structuredClone(state.workflow),
    mobileLayout: structuredClone(state.mobileLayout),
    itemKeyByPointer: structuredClone(state.itemKeyByPointer),
    pointerByHierarchicalKey: structuredClone(state.pointerByHierarchicalKey),
    changedNodeIds,
    changedTargets,
    actionLabel,
  };
}

function countGroups(workflow: Workflow): number {
  return (workflow.groups ?? []).length
    + (workflow.definitions?.subgraphs ?? []).reduce(
      (count, subgraph) => count + (subgraph.groups ?? []).length,
      0,
    );
}

function countNodes(workflow: Workflow): number {
  return (workflow.nodes ?? []).length
    + (workflow.definitions?.subgraphs ?? []).reduce(
      (count, subgraph) => count + (subgraph.nodes ?? []).length,
      0,
    );
}

// The fallback name for a step no action claimed (see utils/undoActionLabels
// for the ones that do): read off what the workflow gained or lost.
function describeWorkflowChange(
  prev: Workflow,
  next: Workflow,
  structural: boolean,
): string {
  const prevSubgraphs = prev.definitions?.subgraphs?.length ?? 0;
  const nextSubgraphs = next.definitions?.subgraphs?.length ?? 0;
  if (nextSubgraphs > prevSubgraphs) return 'Create subgraph';
  if (nextSubgraphs < prevSubgraphs) return 'Delete subgraph';

  const prevNodes = countNodes(prev);
  const nextNodes = countNodes(next);
  if (nextNodes > prevNodes) return 'Add node';
  if (nextNodes < prevNodes) return 'Delete node';

  const prevGroups = countGroups(prev);
  const nextGroups = countGroups(next);
  if (nextGroups > prevGroups) return 'Create group';
  if (nextGroups < prevGroups) return 'Delete group';
  return structural ? 'Edit workflow' : 'Edit node';
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

// ─── Revealing what changed ──────────────────────────────────────────────────

function nodesInScope(workflow: Workflow, subgraphId: string | null): WorkflowNode[] {
  if (subgraphId === null) return workflow.nodes ?? [];
  const definition = workflow.definitions?.subgraphs?.find((sg) => sg.id === subgraphId);
  return definition?.nodes ?? [];
}

function isSubgraphType(workflow: Workflow, type: string | undefined): boolean {
  if (!type) return false;
  return (workflow.definitions?.subgraphs ?? []).some((sg) => sg.id === type);
}

/** A resolved change: where to go, and what to call it. */
interface ResolvedChange {
  /** Absent when the item is not in this state to be scrolled to. */
  jump: WorkflowJumpTarget | null;
  name: string;
  id: number;
  widgetLabel?: string;
}

function groupsInScope(workflow: Workflow, subgraphId: string | null) {
  if (subgraphId === null) return workflow.groups ?? [];
  return workflow.definitions?.subgraphs?.find((sg) => sg.id === subgraphId)?.groups ?? [];
}

/**
 * Turn a recorded change into somewhere the panel can go and something to call
 * it, resolved against a given copy of the workflow.
 *
 * Returns null when the target does not exist in that copy, which is the
 * ordinary case rather than an error: redoing a delete removes the node the
 * step was recorded against, so the restored state cannot name it and the
 * pre-restore one is asked instead (see `resolveChange`).
 */
function resolveChangeIn(
  workflow: Workflow,
  itemKeyByPointer: Record<string, HierarchicalKey>,
  nodeTypes: NodeTypes | null,
  target: WorkflowChangeTarget,
): ResolvedChange | null {
  if (target.kind === 'node') {
    const node = nodesInScope(workflow, target.subgraphId).find((n) => n.id === target.nodeId);
    if (!node) return null;
    const name = resolveNodeDisplayName(workflow, nodeTypes, node);
    if (!node.itemKey) return { jump: null, name, id: node.id };
    if (isSubgraphType(workflow, node.type)) {
      return { jump: { kind: 'subgraph', itemKey: node.itemKey }, name, id: node.id };
    }
    // One widget changed and the card draws a row for it: go to the row. The
    // jump falls back to the card on its own if the row turns out not to be
    // drawn, but a widget with no definition here is not a row at all (it may
    // be promoted to a subgraph boundary, or one of the specialised controls),
    // so that stays a node-level change rather than claiming a name for it.
    const widgetRow = target.widgetIndex === undefined
      ? null
      : resolveWidgetRow(nodeTypes, node, target.widgetIndex);
    // `widgets_values` is positional: a boundary-slot reorder moves values
    // between indices, so a position recorded before one names a different
    // widget after it. The recorded name is what says whether this is still
    // the same row.
    const positionStillHolds =
      widgetRow !== null
      && (target.widgetName === undefined || target.widgetName === widgetRow.name);
    if (positionStillHolds && target.widgetIndex !== undefined) {
      return {
        jump: {
          kind: 'widget',
          itemKey: node.itemKey,
          nodeId: node.id,
          domId: widgetRowDomId(node.id, target.widgetIndex),
        },
        name,
        id: node.id,
        widgetLabel: widgetRow.label,
      };
    }
    return { jump: { kind: 'node', itemKey: node.itemKey }, name, id: node.id };
  }

  if (target.kind === 'group') {
    const group = groupsInScope(workflow, target.subgraphId).find((g) => g.id === target.groupId);
    if (!group) return null;
    const name = resolveGroupDisplayName(group);
    const suffix = `group:${target.groupId}`;
    for (const [pointer, itemKey] of Object.entries(itemKeyByPointer)) {
      if (!pointer.endsWith(suffix)) continue;
      const pointerScope = pointer.match(/subgraph:([^/]+)/)?.[1] ?? null;
      if (pointerScope !== target.subgraphId) continue;
      return { jump: { kind: 'group', itemKey, groupKey: pointer }, name, id: group.id };
    }
    return { jump: null, name, id: group.id };
  }

  // A definition's own shape changed (a boundary slot, a name, a label), so the
  // instance on screen is what there is to name and show. Inside that subgraph
  // it is already on screen — its connections section — and jumping would mean
  // leaving the scope the user is standing in, so only the name is given.
  const currentFrame = useWorkflowStore.getState().scopeStack.at(-1);
  const inside = currentFrame?.type === 'subgraph' && currentFrame.id === target.subgraphId;
  for (const scopeId of [null, ...(workflow.definitions?.subgraphs ?? []).map((sg) => sg.id)]) {
    const placeholder = nodesInScope(workflow, scopeId).find((n) => n.type === target.subgraphId);
    if (!placeholder) continue;
    const name = resolveNodeDisplayName(workflow, nodeTypes, placeholder);
    return {
      jump: inside || !placeholder.itemKey
        ? null
        : { kind: 'subgraph', itemKey: placeholder.itemKey },
      name,
      id: placeholder.id,
    };
  }
  return null;
}

/**
 * The placeholder row in the CURRENT scope that exposes an inner widget edit,
 * when one does.
 *
 * A proxy widget keeps its value on the inner node, so editing "Sampling: cfg"
 * on the Backend card at root records a change against inner node 914 in the
 * Backend scope — and nothing at root. The scope-ordering in `resolveChange`
 * then reads "changed nothing here" and travels, teleporting the user into a
 * subgraph they never opened. The edit IS visible where they stand: the
 * placeholder's proxy row is that widget. Jump there instead.
 *
 * Boundary-promoted widgets don't need this: their value lives on the
 * placeholder, so the placeholder itself is in changedTargets already.
 */
function resolveProxyExposureInScope(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  currentScopeId: string | null,
  target: WorkflowChangeTarget,
): ResolvedChange | null {
  if (target.kind !== 'node' || target.widgetName === undefined) return null;
  const targetScope = target.subgraphId ?? null;
  if (targetScope === null || targetScope === currentScopeId) return null;
  for (const placeholder of nodesInScope(workflow, currentScopeId)) {
    if (placeholder.type !== targetScope || !placeholder.itemKey) continue;
    const proxyWidgets = (placeholder.properties as Record<string, unknown> | undefined)
      ?.proxyWidgets;
    if (!Array.isArray(proxyWidgets)) continue;
    const proxyIndex = (proxyWidgets as unknown[]).findIndex(
      (entry) =>
        Array.isArray(entry)
        && String(entry[0]) === String(target.nodeId)
        && entry[1] === target.widgetName,
    );
    if (proxyIndex < 0) continue;
    const inner = nodesInScope(workflow, targetScope).find((n) => n.id === target.nodeId);
    if (!inner) continue;
    const widgetRow = target.widgetIndex === undefined
      ? null
      : resolveWidgetRow(nodeTypes, inner, target.widgetIndex);
    return {
      // Proxy rows render at PROXY_INDEX_OFFSET + their proxyWidgets position
      // on the placeholder card (see resolveSubgraphProxyWidgetDefs).
      jump: {
        kind: 'widget',
        itemKey: placeholder.itemKey,
        nodeId: placeholder.id,
        domId: widgetRowDomId(placeholder.id, PROXY_INDEX_OFFSET + proxyIndex),
      },
      name: resolveNodeDisplayName(workflow, nodeTypes, inner),
      id: inner.id,
      widgetLabel: widgetRow?.label ?? target.widgetName,
    };
  }
  return null;
}

/**
 * The one item an undo/redo speaks for: the first of its recorded changes that
 * can still be found, named for the toast and — when it is in the restored
 * state — pointed at for the scroll.
 *
 * `fallbackWorkflow` is the state being left behind. A redone delete has
 * nothing to find in the restored state, and naming what was just removed is
 * more use than naming nothing.
 */
function resolveChange(
  snapshot: UndoSnapshot,
  fallbackWorkflow: Workflow | null,
  nodeTypes: NodeTypes | null,
): { jump: WorkflowJumpTarget | null; target: UndoFeedbackTarget } | null {
  const all = snapshot.changedTargets ?? [];
  // What the step was about, if anything was added or removed: an edit that
  // deletes two nodes also rewrites their neighbours' links, and naming a
  // neighbour would describe the step as something it was not. Snapshots stored
  // by a build before `change` existed have none, and fall back to all of them.
  const subject = all.filter((target) => target.change && target.change !== 'edited');
  const pool = subject.length > 0 ? subject : all;
  const extraCount = Math.max(0, pool.length - 1);

  // Whatever the step changed where the user is standing comes first.
  //
  // A boundary edit inside a subgraph changes the inner node AND every
  // placeholder instance of the type, and the placeholders live in the parent
  // scope. Root nodes are walked first, so without this the reveal picked a
  // placeholder and travelled out of the subgraph the edit was made in —
  // undoing a promotion dropped you at root, and redo did it again. Travelling
  // is still right when the step changed nothing in this scope: then what was
  // undone really is elsewhere, and going to it is the point.
  const currentFrame = useWorkflowStore.getState().scopeStack.at(-1);
  const currentScopeId = currentFrame?.type === 'subgraph' ? currentFrame.id : null;
  // Visible here also covers an inner widget a placeholder in this scope
  // exposes as a proxy row — the edit was likely made through that row, and
  // its undo must not walk the user into the subgraph.
  const exposureFor = (target: WorkflowChangeTarget) =>
    resolveProxyExposureInScope(snapshot.workflow, nodeTypes, currentScopeId, target);
  const isHere = (target: WorkflowChangeTarget) =>
    (target.subgraphId ?? null) === currentScopeId || exposureFor(target) !== null;
  const ordered = [...pool.filter(isHere), ...pool.filter((target) => !isHere(target))];

  // The named item and the revealed item must be the same one, so a target that
  // can be shown wins over one that can only be named (an item this step
  // removed, which is not in the restored state to scroll to).
  let named: { jump: null; target: UndoFeedbackTarget } | null = null;
  for (const target of ordered) {
    const exposure = (target.subgraphId ?? null) === currentScopeId
      ? null
      : exposureFor(target);
    if (exposure?.jump) {
      return {
        jump: exposure.jump,
        target: {
          name: exposure.name,
          id: exposure.id,
          widgetLabel: exposure.widgetLabel,
          extraCount,
        },
      };
    }
    const resolved = resolveChangeIn(
      snapshot.workflow,
      snapshot.itemKeyByPointer,
      nodeTypes,
      target,
    );
    if (resolved?.jump) {
      return {
        jump: resolved.jump,
        target: {
          name: resolved.name,
          id: resolved.id,
          widgetLabel: resolved.widgetLabel,
          extraCount,
        },
      };
    }
    if (named) continue;
    // Present but not reachable (its scope's connections section is already on
    // screen), or gone from the restored state — in which case the state being
    // left behind can still say what it was called.
    const fallback = resolved
      ?? (fallbackWorkflow
        ? resolveChangeIn(fallbackWorkflow, snapshot.itemKeyByPointer, nodeTypes, target)
        : null);
    if (fallback) {
      named = {
        jump: null,
        target: {
          name: fallback.name,
          id: fallback.id,
          widgetLabel: fallback.widgetLabel,
          extraCount,
        },
      };
    }
  }
  return named;
}

/**
 * Scroll to what the undone/redone step touched and flash it, the same way
 * every other jump in the panel arrives. Runs after the restore, on the
 * snapshot that is now on screen.
 */
function revealChange(jump: WorkflowJumpTarget | null, direction: 'undo' | 'redo'): void {
  if (!jump) return;
  // After the restore has rendered: the cards for a node this step brought back
  // do not exist yet on the tick that restores it.
  setTimeout(() => {
    useWorkflowStore.getState().jumpToWorkflowItem(jump, {
      label: direction === 'undo' ? t('Undo') : t('Redo'),
    });
  }, 0);
}

export const useWorkflowUndoStore = create<WorkflowUndoState>((set, get) => ({
  histories: {},
  feedback: null,

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
    const actionLabel = target.actionLabel ?? 'Edit workflow';
    const currentForRedo = cloneCanonical(
      current,
      target.changedNodeIds,
      target.changedTargets,
      actionLabel,
    );

    applyingUndoRedo = true;
    const restoredWorkflow = structuredClone(target.workflow);
    useWorkflowStore.setState({
      workflow: restoredWorkflow,
      mobileLayout: structuredClone(target.mobileLayout),
      itemKeyByPointer: structuredClone(target.itemKeyByPointer),
      pointerByHierarchicalKey: structuredClone(target.pointerByHierarchicalKey),
      scopeStack: reconcileScopeStack(wf.scopeStack, restoredWorkflow),
    });
    applyingUndoRedo = false;

    // Named against the restored state (what is on screen now), falling back to
    // the state left behind for an item this step removed.
    const change = resolveChange(target, current.workflow, wf.nodeTypes);

    set((state) => {
      const h = state.histories[sessionId] ?? { undo: [], redo: [] };
      const redo = [...h.redo, currentForRedo];
      if (redo.length > MAX_STEPS) redo.shift();
      return {
        histories: { ...state.histories, [sessionId]: { undo: h.undo.slice(0, -1), redo } },
        feedback: {
          id: ++feedbackId,
          direction: 'undo',
          actionLabel,
          target: change?.target ?? null,
        },
      };
    });
    lastRecord = { sessionId: null, time: 0, structural: true, nodeId: null };
    revealChange(change?.jump ?? null, 'undo');
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
    const actionLabel = target.actionLabel ?? 'Edit workflow';
    const currentForUndo = cloneCanonical(
      current,
      target.changedNodeIds,
      target.changedTargets,
      actionLabel,
    );

    applyingUndoRedo = true;
    const restoredWorkflow = structuredClone(target.workflow);
    useWorkflowStore.setState({
      workflow: restoredWorkflow,
      mobileLayout: structuredClone(target.mobileLayout),
      itemKeyByPointer: structuredClone(target.itemKeyByPointer),
      pointerByHierarchicalKey: structuredClone(target.pointerByHierarchicalKey),
      scopeStack: reconcileScopeStack(wf.scopeStack, restoredWorkflow),
    });
    applyingUndoRedo = false;

    const change = resolveChange(target, current.workflow, wf.nodeTypes);

    set((state) => {
      const h = state.histories[sessionId] ?? { undo: [], redo: [] };
      const undo = [...h.undo, currentForUndo];
      if (undo.length > MAX_STEPS) undo.shift();
      return {
        histories: { ...state.histories, [sessionId]: { undo, redo: h.redo.slice(0, -1) } },
        feedback: {
          id: ++feedbackId,
          direction: 'redo',
          actionLabel,
          target: change?.target ?? null,
        },
      };
    });
    lastRecord = { sessionId: null, time: 0, structural: true, nodeId: null };
    revealChange(change?.jump ?? null, 'redo');
  },

  clearFeedback: (id) => {
    set((state) => state.feedback?.id === id ? { feedback: null } : state);
  },
}));

// ─── Persistence ─────────────────────────────────────────────────────────────

// Snapshot bodies already on disk. A body is written once and never rewritten,
// so an edit costs one body write however long the history is.
const persistedIds = new Set<string>();

/**
 * The `workflowLoadedAt` of the workflow a tab is holding — the stamp a
 * persisted history is matched against on the way back in. A tab that loaded a
 * different workflow since the history was written keeps none of it.
 */
function sessionLoadedAt(sessionId: string): number {
  const state = useWorkflowStore.getState();
  if (state.activeSessionId === sessionId) return state.workflowLoadedAt;
  return state.parkedSessions[sessionId]?.workflowLoadedAt ?? 0;
}

function persistHistories(extraRemovedIds: string[] = []): void {
  const { histories } = useWorkflowUndoStore.getState();
  const index: PersistedUndoIndex = { version: 1, sessions: {} };
  const newBodies = new Map<string, unknown>();
  const live = new Set<string>();

  for (const [sessionId, history] of Object.entries(histories)) {
    if (history.undo.length === 0 && history.redo.length === 0) continue;
    index.sessions[sessionId] = {
      loadedAt: sessionLoadedAt(sessionId),
      undo: history.undo.map((snapshot) => snapshot.id),
      redo: history.redo.map((snapshot) => snapshot.id),
    };
    for (const snapshot of [...history.undo, ...history.redo]) {
      live.add(snapshot.id);
      if (!persistedIds.has(snapshot.id)) newBodies.set(snapshot.id, snapshot);
    }
  }

  const removedIds: string[] = [];
  for (const id of persistedIds) {
    if (!live.has(id)) removedIds.push(id);
  }
  for (const id of extraRemovedIds) {
    if (!removedIds.includes(id)) removedIds.push(id);
  }
  if (newBodies.size === 0 && removedIds.length === 0 && Object.keys(index.sessions).length === 0) {
    return;
  }
  for (const id of removedIds) persistedIds.delete(id);
  for (const id of newBodies.keys()) persistedIds.add(id);
  writeUndoHistory({ index, newBodies, removedIds });
}

// Suspended while a test drops the in-memory history to stand in for a page
// reload: that is not the history being emptied, so it must not erase what is
// stored.
let persistSuspended = false;

useWorkflowUndoStore.subscribe((state, prev) => {
  if (persistSuspended) return;
  if (state.histories !== prev.histories) persistHistories();
});

function isSnapshotBody(body: unknown): body is UndoSnapshot {
  if (!body || typeof body !== 'object') return false;
  const candidate = body as Partial<UndoSnapshot>;
  return Boolean(candidate.workflow && candidate.mobileLayout && candidate.id);
}

/**
 * Put the persisted history back, once the workflow store has rehydrated (the
 * tabs and their load stamps have to be known before a history can be matched
 * to one). Sessions that have already recorded an edit in this page's lifetime
 * are left alone — a live history is never overwritten by a stored one.
 */
async function hydrateFromStorage(): Promise<void> {
  const stored = await loadUndoHistory();
  if (!stored) return;

  const state = useWorkflowStore.getState();
  const liveSessions = new Set<string>(Object.keys(state.parkedSessions));
  if (state.activeSessionId) liveSessions.add(state.activeSessionId);

  const restored: Record<string, TabHistory> = {};
  for (const [sessionId, entry] of Object.entries(stored.index.sessions)) {
    if (!liveSessions.has(sessionId)) continue;
    if (entry.loadedAt !== sessionLoadedAt(sessionId)) continue;
    const undo: UndoSnapshot[] = [];
    const redo: UndoSnapshot[] = [];
    let complete = true;
    for (const [ids, stack] of [[entry.undo, undo], [entry.redo, redo]] as const) {
      for (const id of ids) {
        const body = stored.bodies.get(id);
        if (!isSnapshotBody(body)) {
          complete = false;
          break;
        }
        stack.push(body);
      }
      if (!complete) break;
    }
    // A half-read history would restore states in the wrong order; drop it.
    if (!complete) continue;
    restored[sessionId] = { undo, redo };
  }

  useWorkflowUndoStore.setState((current) => {
    const histories = { ...current.histories };
    for (const [sessionId, history] of Object.entries(restored)) {
      const existing = histories[sessionId];
      if (existing && (existing.undo.length > 0 || existing.redo.length > 0)) continue;
      histories[sessionId] = history;
      for (const snapshot of [...history.undo, ...history.redo]) persistedIds.add(snapshot.id);
    }
    return { histories };
  });

  // Bodies belonging to tabs that are gone (or to a workflow the tab no longer
  // holds) are collected here rather than left to accumulate.
  const keep = new Set<string>();
  for (const history of Object.values(useWorkflowUndoStore.getState().histories)) {
    for (const snapshot of [...history.undo, ...history.redo]) keep.add(snapshot.id);
  }
  const orphaned = [...stored.bodies.keys()].filter((id) => !keep.has(id));
  if (orphaned.length > 0) {
    for (const id of orphaned) persistedIds.delete(id);
    // Delete stale bodies in the same write that records the histories we
    // retained. Queueing a second write with an empty index would win the
    // debounce merge and make those valid histories disappear next reload.
    persistHistories(orphaned);
  }
}

/**
 * Test seam: what a page refresh does — the in-memory history goes away, and
 * whatever was stored is read back in its place.
 */
export async function reloadUndoHistoriesForTest(): Promise<void> {
  flushUndoHistory();
  persistSuspended = true;
  persistedIds.clear();
  snapshotSeq = 0;
  useWorkflowUndoStore.setState({ histories: {}, feedback: null });
  persistSuspended = false;
  await hydrateFromStorage();
}

/**
 * Test seam: hydrate WITHOUT dropping the in-memory history first — the race a
 * page load can lose, where an edit lands before the stored history has been
 * read back.
 */
export async function hydrateUndoHistoriesForTest(): Promise<void> {
  flushUndoHistory();
  await hydrateFromStorage();
}

/** Test seam: forget everything, in memory and on disk. */
export async function resetUndoHistoryForTest(): Promise<void> {
  persistSuspended = true;
  persistedIds.clear();
  snapshotSeq = 0;
  useWorkflowUndoStore.setState({ histories: {}, feedback: null });
  persistSuspended = false;
  await clearUndoHistoryStorage();
}

if (typeof window !== 'undefined') {
  if (useWorkflowStore.persist.hasHydrated()) {
    void hydrateFromStorage();
  } else {
    const unsubscribe = useWorkflowStore.persist.onFinishHydration(() => {
      unsubscribe();
      void hydrateFromStorage();
    });
  }
}

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
      const undo = [...history.undo.slice(0, -1), {
        ...last,
        changedNodeIds: merged,
        changedTargets: mergeTargets(
          last.changedTargets,
          nameWidgetTargets(diff.changedTargets, last.workflow, state.nodeTypes),
        ),
      }];
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
  const actionLabel =
    getUndoTransactionActionLabel()
    ?? describeWorkflowChange(prev.workflow, state.workflow, diff.structural);
  const snapshot = cloneCanonical(
    prevCanonical,
    diff.changedNodeIds,
    // Named against the state the snapshot holds — the one a restore puts back,
    // and so the one the reveal will resolve the index in.
    nameWidgetTargets(diff.changedTargets, prevCanonical.workflow, state.nodeTypes),
    actionLabel,
  );
  useWorkflowUndoStore.setState((s) => {
    const history = s.histories[sessionId] ?? { undo: [], redo: [] };
    const undo = [...history.undo, snapshot];
    if (undo.length > MAX_STEPS) undo.shift();
    // Any new edit invalidates the redo branch.
    return { histories: { ...s.histories, [sessionId]: { undo, redo: [] } } };
  });
});

/**
 * Stamp each widget target with the widget that occupies its index right now.
 *
 * Done when a step is recorded rather than inside the diff: the diff runs on
 * every workflow change, and this only matters for the handful of changes that
 * become undo steps.
 */
function nameWidgetTargets(
  targets: WorkflowChangeTarget[],
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
): WorkflowChangeTarget[] {
  return targets.map((target) => {
    if (target.kind !== 'node' || target.widgetIndex === undefined) return target;
    const node = nodesInScope(workflow, target.subgraphId).find((n) => n.id === target.nodeId);
    if (!node) return target;
    const row = resolveWidgetRow(nodeTypes, node, target.widgetIndex);
    return row ? { ...target, widgetName: row.name } : target;
  });
}

function targetKey(target: WorkflowChangeTarget): string {
  if (target.kind === 'node') return `n:${target.subgraphId ?? 'root'}:${target.nodeId}`;
  if (target.kind === 'group') return `g:${target.subgraphId ?? 'root'}:${target.groupId}`;
  return `d:${target.subgraphId}`;
}

function mergeTargets(
  existing: WorkflowChangeTarget[],
  incoming: WorkflowChangeTarget[],
): WorkflowChangeTarget[] {
  const seen = new Set(existing.map(targetKey));
  const merged = [...existing];
  for (const target of incoming) {
    const key = targetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(target);
  }
  return merged;
}

import type { MobileLayout } from "@/utils/mobileLayout";
import { createEmptyMobileLayout } from "@/utils/mobileLayout";
import type { Workflow } from "@/api/types";
import {
  annotateWorkflowWithHierarchicalKeys,
  canonicalizeWorkflowHierarchicalKeys,
  layoutMatchesWorkflowNodes,
  normalizeManuallyHiddenNodeKeys,
  normalizeMobileLayoutGroupKeys,
  normalizePointerBookmarkList,
  normalizePointerBooleanRecord,
  normalizePointerCollapsedRecord,
  reconcilePointerRegistry,
} from "@/utils/workflowHierarchy";
import { SESSION_STATE_FIELDS } from "./state";
import { buildLayoutForWorkflow } from "./layoutOps";
import type {
  SavedWorkflowState,
  SessionStateField,
  WorkflowSessionMeta,
  WorkflowSessionSnapshot,
  WorkflowState,
} from "./state";

/**
 * Workflow session registry: session caps, cleared-content defaults, and
 * rehydration reconciliation. Extracted from the useWorkflow store body so
 * the session logic is unit-testable without instantiating the zustand
 * store (mirrors `./metadataNormalization`).
 */

// ---------------------------------------------------------------------------
// Multi-workflow sessions ("tabs")
// ---------------------------------------------------------------------------
// At most one session is "active" at a time: its state lives in the flat store
// fields (workflow, mobileLayout, scopeStack, execution scalars, etc.). Other
// open sessions are "parked" — their per-session state is snapshotted into
// parkedSessions[id]. Switching tabs folds the active flat fields into the
// outgoing session's snapshot and hydrates the incoming session's snapshot back
// into the flat fields, so the vast majority of store actions keep operating on
// get().workflow unchanged.
export const MAX_WORKFLOW_SESSIONS = 10;

// Cap on the prompt_id → session routing map. Entries are kept after a prompt
// finishes (so a late straggler message still routes to the right tab) but the
// oldest are evicted past this bound so it can't grow without limit across a
// long/infinite run. 200 is a generous grace window — far more than the few
// in-flight + recently-finished prompts that could still emit messages.
const MAX_PROMPT_TO_SESSION = 200;

// Insertion-ordered cap: drop the oldest keys so `map` keeps at most
// MAX_PROMPT_TO_SESSION entries. prompt_ids are unique, so insertion order is
// queue order and the oldest (longest-finished) entries are evicted first.
// `protectedIds` (currently running/pending prompts) are never evicted — their
// websocket messages must keep routing to the owning tab, so dropping the
// mapping mid-run would misroute outputs to whatever tab is active.
function capPromptToSession(
  map: Record<string, string>,
  protectedIds?: ReadonlySet<string>,
): Record<string, string> {
  const keys = Object.keys(map);
  if (keys.length <= MAX_PROMPT_TO_SESSION) return map;
  let toRemove = keys.length - MAX_PROMPT_TO_SESSION;
  for (const key of keys) {
    if (toRemove <= 0) break;
    if (protectedIds?.has(key)) continue;
    delete map[key];
    toRemove--;
  }
  return map;
}

// ─── Session helpers ──────────────────────────────────────────────────────────────────
//
// clearedWorkflowContent() must be in sync with the session snapshot fields
// above — the two describe the same per-workflow content shape.
function clearedWorkflowContent(): Partial<WorkflowState> {
  return {
    workflowSource: null,
    workflow: null,
    originalWorkflow: null,
    diffBaseWorkflow: null,
    lastEnqueuedWorkflow: null,
    scopeStack: [{ type: "root" as const }],
    currentFilename: null,
    currentWorkflowKey: null,
    collapsedItems: {},
    hiddenItems: {},
    mobileLayout: createEmptyMobileLayout(),
    itemKeyByPointer: {},
    pointerByHierarchicalKey: {},
    runCount: 1,
    infiniteLoop: false,
    infiniteLoopAwaitingRun: false,
    isStopping: false,
    nodeOutputs: {},
    nodeComparerOutputs: {},
    nodeTextOutputs: {},
    latentPreviews: {},
    latentPreviewTiles: {},
    promptOutputs: {},
    followQueue: false,
    connectionHighlightModes: {},
  };
}

// Drop each parked snapshot's `latentPreviews` before persisting: they are
// transient blob: object URLs that are invalid (and would render broken) after
// a page reload. Node outputs (file references) are kept and re-render fine.
function stripLatentPreviewsFromSnapshots(
  parkedSessions: Record<string, WorkflowSessionSnapshot>,
): Record<string, WorkflowSessionSnapshot> {
  const result: Record<string, WorkflowSessionSnapshot> = {};
  for (const [id, snapshot] of Object.entries(parkedSessions)) {
    result[id] = { ...snapshot, latentPreviews: {}, latentPreviewTiles: {} };
  }
  return result;
}

let sessionIdCounter = 0;
function generateSessionId(): string {
  sessionIdCounter += 1;
  return `wf-${Date.now().toString(36)}-${sessionIdCounter.toString(36)}`;
}

// ─── Rehydration reconciliation ───────────────────────────────────────────────────────

// Fields a session-shaped object must expose for rehydration normalization.
// Both the active session (flat store fields) and each parked snapshot match.
export type SessionNormalizable = {
  workflow: Workflow | null;
  originalWorkflow: Workflow | null;
  mobileLayout: MobileLayout;
  itemKeyByPointer: Record<string, string>;
  pointerByHierarchicalKey: Record<string, string>;
  hiddenItems: Record<string, boolean>;
  collapsedItems: Record<string, boolean>;
  currentWorkflowKey: string | null;
};

/** Reconcile a rehydrated store draft so the tab strip, the active session, and
 *  the parked snapshots stay mutually consistent even when the persisted payload
 *  was partial or corrupt — so we never show a workflow with no matching tab,
 *  render a tab that can't be switched to (no snapshot), or leak an orphan
 *  snapshot. Mutates `state` in place. Exported for testing. */
export function reconcileRehydratedSessions(state: WorkflowState): void {
  const parked = state.parkedSessions ?? {};
  // Copy a parked snapshot's per-session fields into the active flat fields. The
  // snapshot's seed UI is left to useSeedStore's own persistence — close enough
  // for this rare recovery path.
  const promoteSnapshot = (snap: WorkflowSessionSnapshot): void => {
    const target = state as unknown as Record<string, unknown>;
    for (const field of SESSION_STATE_FIELDS) {
      target[field] = snap[field as SessionStateField];
    }
  };
  let sessions = (Array.isArray(state.sessions) ? state.sessions : [])
    .filter((s): s is WorkflowSessionMeta => !!s && typeof s.id === 'string')
    // Drop ghost tabs: a non-active session with no parked snapshot can be
    // neither rendered nor switched to.
    .filter((s) => s.id === state.activeSessionId || !!parked[s.id]);

  // Salvage case: the active id has a parked snapshot but the flat fields are
  // empty. The active session's content normally lives in the flat fields and
  // is never duplicated into parkedSessions, so this only arises from a corrupt
  // payload — promote the snapshot into the flat fields rather than letting the
  // parked-filter below drop it and leave the active tab blank.
  if (state.activeSessionId && !state.workflow && parked[state.activeSessionId]) {
    promoteSnapshot(parked[state.activeSessionId]);
  }

  // The active flat-field workflow must have a matching tab. If its id went
  // missing, re-add it; if there's no active id but a workflow is loaded, mint
  // one (same as the legacy single-workflow migration path). Both only apply
  // when a workflow is actually loaded in the flat fields — otherwise a dangling
  // active id should fall through to promote a parked tab, not spawn an empty one.
  if (
    state.activeSessionId &&
    state.workflow &&
    !sessions.some((s) => s.id === state.activeSessionId)
  ) {
    sessions = [{ id: state.activeSessionId }, ...sessions];
  } else if (!state.activeSessionId && state.workflow) {
    const id = generateSessionId();
    state.activeSessionId = id;
    sessions = [{ id }, ...sessions];
  }

  // Active id still dangling (no flat-field workflow to anchor it): adopt the
  // first tab that has a snapshot, or clear to empty. The promoted snapshot's
  // per-session seed UI is left to useSeedStore's own persistence — close enough
  // for this rare recovery path.
  if (
    !state.activeSessionId ||
    !sessions.some((s) => s.id === state.activeSessionId)
  ) {
    const next = sessions.find((s) => parked[s.id]);
    if (next) {
      promoteSnapshot(parked[next.id]);
      state.activeSessionId = next.id;
    } else {
      Object.assign(state, clearedWorkflowContent());
      state.activeSessionId = null;
      sessions = [];
    }
  }

  // Keep only snapshots for an existing, non-active tab.
  const validIds = new Set(sessions.map((s) => s.id));
  const nextParked: Record<string, WorkflowSessionSnapshot> = {};
  for (const [pid, snap] of Object.entries(parked)) {
    if (validIds.has(pid) && pid !== state.activeSessionId) {
      nextParked[pid] = snap;
    }
  }
  state.sessions = sessions;
  state.parkedSessions = nextParked;
  // Loop ownership can only point at a tab that still exists.
  if (
    state.infiniteLoopSessionId &&
    !validIds.has(state.infiniteLoopSessionId)
  ) {
    state.infiniteLoopSessionId = null;
  }
}

// Normalize one session's persisted layout/registry/workflow on rehydrate,
// mutating `s` in place. Returns the (possibly updated) savedWorkflowStates so
// callers can thread the global map across multiple sessions. This is the
// per-session form of the logic that used to live inline in onRehydrateStorage.
function normalizeSessionInPlace(
  s: SessionNormalizable,
  savedWorkflowStates: Record<string, SavedWorkflowState>,
): Record<string, SavedWorkflowState> {
  if (!s.workflow) {
    s.mobileLayout = createEmptyMobileLayout();
    s.itemKeyByPointer = {};
    s.pointerByHierarchicalKey = {};
    return savedWorkflowStates;
  }
  const normalizedWorkflow = canonicalizeWorkflowHierarchicalKeys(
    s.workflow,
    s.itemKeyByPointer ?? {},
  );
  const normalizedLayout = s.mobileLayout
    ? normalizeMobileLayoutGroupKeys(s.mobileLayout)
    : null;
  const hiddenNodesLayout = normalizeManuallyHiddenNodeKeys(
    normalizedWorkflow,
    s.hiddenItems ?? {},
  );
  s.mobileLayout =
    normalizedLayout &&
    layoutMatchesWorkflowNodes(normalizedLayout, normalizedWorkflow)
      ? normalizedLayout
      : buildLayoutForWorkflow(normalizedWorkflow, hiddenNodesLayout);
  const reconciled = reconcilePointerRegistry(
    s.mobileLayout,
    s.itemKeyByPointer ?? {},
    s.pointerByHierarchicalKey ?? {},
  );
  s.workflow = annotateWorkflowWithHierarchicalKeys(
    normalizedWorkflow,
    reconciled.layoutToStable,
  );
  if (s.originalWorkflow) {
    const normalizedOriginalWorkflow = canonicalizeWorkflowHierarchicalKeys(
      s.originalWorkflow,
      s.itemKeyByPointer ?? {},
    );
    s.originalWorkflow = annotateWorkflowWithHierarchicalKeys(
      normalizedOriginalWorkflow,
      reconciled.layoutToStable,
    );
  }
  s.itemKeyByPointer = reconciled.layoutToStable;
  s.pointerByHierarchicalKey = reconciled.stableToLayout;
  s.hiddenItems = normalizePointerBooleanRecord(
    s.hiddenItems,
    reconciled.layoutToStable,
    reconciled.stableToLayout,
  );
  s.collapsedItems = normalizePointerCollapsedRecord(
    s.collapsedItems,
    reconciled.layoutToStable,
    reconciled.stableToLayout,
  );
  const key = s.currentWorkflowKey;
  if (key && savedWorkflowStates && savedWorkflowStates[key]) {
    const savedState = savedWorkflowStates[key];
    return {
      ...savedWorkflowStates,
      [key]: {
        ...savedState,
        collapsedItems: normalizePointerCollapsedRecord(
          savedState.collapsedItems,
          reconciled.layoutToStable,
          reconciled.stableToLayout,
        ),
        hiddenItems: normalizePointerBooleanRecord(
          savedState.hiddenItems,
          reconciled.layoutToStable,
          reconciled.stableToLayout,
        ),
        bookmarkedItems: normalizePointerBookmarkList(
          savedState.bookmarkedItems,
          reconciled.layoutToStable,
          reconciled.stableToLayout,
        ),
      },
    };
  }
  return savedWorkflowStates;
}

export {
  capPromptToSession,
  clearedWorkflowContent,
  generateSessionId,
  normalizeSessionInPlace,
  stripLatentPreviewsFromSnapshots,
};
// Session types now canonically live in ./state; keep the module's previous
// surface for importers of `./useWorkflow/sessions`.
export { SESSION_STATE_FIELDS } from "./state";
export type {
  SavedNodeState,
  SavedWorkflowState,
  SessionStateField,
  WorkflowSessionSnapshot,
} from "./state";
export type { WorkflowSessionMeta } from "./state";

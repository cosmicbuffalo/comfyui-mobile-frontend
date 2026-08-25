import {t} from "@/i18n";
import type {Workflow} from "@/api/types";
import {useImageViewerStore} from "@/hooks/useImageViewer";
import {useWorkflowErrorsStore} from "@/hooks/useWorkflowErrors";
import {useQueueStore} from "@/hooks/useQueue";
import {useNavigationStore} from "@/hooks/useNavigation";
import {usePinnedWidgetStore} from "@/hooks/usePinnedWidget";
import {useRecentWorkflowsStore} from "@/hooks/useRecentWorkflows";
import {useWorkflowHiddenStore} from "@/hooks/useWorkflowHidden";
import {useSeedStore} from "@/hooks/useSeed";
import {hasRecognizedPathAliasShape, restoreWorkflowPathAliases} from "@/utils/inputPathAliases";
import {buildWorkflowCacheKey} from "@/utils/workflowCacheKey";
import {addInputFileOptionToNodeTypes} from "@/utils/nodeTypeOptions";
import {computeTidyWorkflowGeometry} from "@/utils/tidyLayout";
import {isMarketingNote} from "@/utils/marketingNote";
import {collectOasisPreviewIoIds, ensureOasisPreviewIoIds} from "@/utils/nodeFrontendPreviews";
import {maxNodeIdAcrossScopes, maxRootLinkId} from "@/utils/canonicalWorkflowOps";
import {annotateWorkflowWithHierarchicalKeys, canonicalizeWorkflowHierarchicalKeys, collectGroupHierarchicalKeys, findSubgraphHierarchicalKey, hasLayoutGroupKeyMismatch, hasMissingHierarchicalKeys, layoutRecordFromPointerRecord, normalizeManuallyHiddenNodeKeys, normalizeMobileLayoutGroupKeys, normalizePointerBooleanRecord, normalizePointerCollapsedRecord, pointerCollapsedRecordFromLayoutRecord, pointerRecordFromLayoutRecord, reconcilePointerRegistry} from "@/utils/workflowHierarchy";
import {isWorkflowHidden} from "@/utils/workflowHidden";
import {findWorkflowShapeProblem, normalizeWorkflowNodes} from "./metadataNormalization";
import {buildLayoutForWorkflow, findPathToRepositionTarget} from "./layoutOps";
import {deriveSeedModes} from "./seedExpansion";
import {collectWorkflowLoadErrors, normalizeWorkflowComboValues} from "./comboValues";
import {MAX_WORKFLOW_SESSIONS, SESSION_STATE_FIELDS, clearedWorkflowContent, generateSessionId, type SavedNodeState, type WorkflowSessionSnapshot} from "./sessions";
import type {WorkflowGet, WorkflowSet, WorkflowState} from "./state";
import {createApplyNodeErrors} from "./nodeErrors";

let addNodeModalRequestId = 0;

export function createSessionActions(set: WorkflowSet, get: WorkflowGet) {
    const applyNodeErrors = createApplyNodeErrors(set, get);

const setMobileLayout: WorkflowState["setMobileLayout"] = (layout) => {
  set((state) => {
    const normalized = normalizeMobileLayoutGroupKeys(layout);
    const reconciled = reconcilePointerRegistry(
      normalized,
      state.itemKeyByPointer,
      state.pointerByHierarchicalKey,
    );
    const nextWorkflow = state.workflow
      ? annotateWorkflowWithHierarchicalKeys(
          state.workflow,
          reconciled.layoutToStable,
        )
      : state.workflow;
    return {
      workflow: nextWorkflow,
      mobileLayout: normalized,
      itemKeyByPointer: reconciled.layoutToStable,
      pointerByHierarchicalKey: reconciled.stableToLayout,
    };
  });
};

const commitRepositionLayout: WorkflowState["commitRepositionLayout"] = (
  layout,
) => {
  set((state) => {
    const normalized = normalizeMobileLayoutGroupKeys(layout);
    const reconciled = reconcilePointerRegistry(
      normalized,
      state.itemKeyByPointer,
      state.pointerByHierarchicalKey,
    );
    const baseWorkflow = state.workflow
      ? annotateWorkflowWithHierarchicalKeys(
          state.workflow,
          reconciled.layoutToStable,
        )
      : state.workflow;
    if (!baseWorkflow) {
      return {
        workflow: baseWorkflow,
        mobileLayout: normalized,
        itemKeyByPointer: reconciled.layoutToStable,
        pointerByHierarchicalKey: reconciled.stableToLayout,
      };
    }

    // Full tidy-layout recompute: rebuild the entire scope's geometry from
    // the (new) mobile ordering so the desktop canvas mirrors the mobile
    // list left-to-right with no overlaps. Engages on the first reposition
    // and keeps the geometry compliant on every reposition after. Cheap —
    // a single O(n) pass over the layout tree.
    const tidiedWorkflow = computeTidyWorkflowGeometry(
      baseWorkflow,
      normalized,
      state.nodeTypes,
    );
    const nextWorkflow = annotateWorkflowWithHierarchicalKeys(
      tidiedWorkflow,
      reconciled.layoutToStable,
    );
    return {
      workflow: nextWorkflow,
      mobileLayout: normalized,
      itemKeyByPointer: reconciled.layoutToStable,
      pointerByHierarchicalKey: reconciled.stableToLayout,
    };
  });
};

// Capture the active session's flat fields (+ seed-store maps) into a
// serializable snapshot.

const captureActiveSnapshot = (): WorkflowSessionSnapshot => {
  const state = get();
  const snapshot = {} as WorkflowSessionSnapshot;
  for (const field of SESSION_STATE_FIELDS) {
    (snapshot as Record<string, unknown>)[field] = state[field];
  }
  const seed = useSeedStore.getState();
  snapshot.seedModes = { ...seed.seedModes };
  snapshot.seedLastValues = { ...seed.seedLastValues };
  return snapshot;
};


// Fold the active session's flat fields into parkedSessions[activeId].

const parkActiveSession = () => {
  const { activeSessionId, parkedSessions } = get();
  if (!activeSessionId) return;
  set({
    parkedSessions: {
      ...parkedSessions,
      [activeSessionId]: captureActiveSnapshot(),
    },
  });
};

// Build the flat-field slice to hydrate from a snapshot, and push the
// snapshot's seed maps into the (active-mirroring) seed store.

const flatFieldsFromSnapshot = (
  snapshot: WorkflowSessionSnapshot,
): Partial<WorkflowState> => {
  useSeedStore.getState().setSeedModes({ ...(snapshot.seedModes ?? {}) });
  useSeedStore
    .getState()
    .setSeedLastValues({ ...(snapshot.seedLastValues ?? {}) });
  const slice: Record<string, unknown> = {};
  for (const field of SESSION_STATE_FIELDS) {
    slice[field] = snapshot[field];
  }
  return slice as Partial<WorkflowState>;
};

const switchToSession: WorkflowState["switchToSession"] = (id) => {
  const state = get();
  if (id === state.activeSessionId) return;
  const target = state.parkedSessions[id];
  if (!target) return;
  // Persist outgoing session's per-cache-key UI state, then park it.
  if (state.currentFilename) get().saveCurrentWorkflowState();
  const outgoingSnapshot = captureActiveSnapshot();
  const nextParked = { ...state.parkedSessions };
  if (state.activeSessionId) {
    nextParked[state.activeSessionId] = outgoingSnapshot;
  }
  delete nextParked[id];
  useWorkflowErrorsStore.getState().clearNodeErrors();
  set({
    ...flatFieldsFromSnapshot(target),
    parkedSessions: nextParked,
    activeSessionId: id,
    isLoading: state.isLoadingBySession[id] ?? false,
    infiniteLoop: state.infiniteLoopSessionId === id,
    // infiniteLoopAwaitingRun is NOT touched here: it guards the loop
    // owner (possibly a parked tab) against auto-starting a run the user
    // never began, so it must survive tab switches. It clears when the
    // owner's run actually starts, or when the loop is disarmed.
  });
  usePinnedWidgetStore
    .getState()
    .restorePinnedWidgetForWorkflow(
      target.currentWorkflowKey ?? "",
      target.workflow ?? ({ nodes: [] } as unknown as Workflow),
    );
  // If the tab we just entered had a background run error, surface it now
  // (as the global banner) and clear its tab marker.
  const errStore = useWorkflowErrorsStore.getState();
  const incomingError = errStore.sessionErrors[id];
  if (incomingError) {
    errStore.setError(incomingError);
    errStore.clearSessionError(id);
  }
};

const closeSession: WorkflowState["closeSession"] = (id) => {
  const state = get();
  if (!state.sessions.some((s) => s.id === id)) return;
  // Revoke the closing session's latent-preview object URLs. They live in
  // the active flat field or the parked snapshot and are otherwise dropped
  // (snapshot discarded / flat field overwritten) without revoking.
  const isActive = id === state.activeSessionId;
  const closingPreviews = isActive
    ? state.latentPreviews
    : state.parkedSessions[id]?.latentPreviews;
  const closingTiles = isActive
    ? state.latentPreviewTiles
    : state.parkedSessions[id]?.latentPreviewTiles;
  const closingUrls = new Set<string>(Object.values(closingPreviews ?? {}));
  for (const tiles of Object.values(closingTiles ?? {})) {
    for (const url of tiles) if (url) closingUrls.add(url);
  }
  closingUrls.forEach((url) => URL.revokeObjectURL(url));
  const remaining = state.sessions.filter((s) => s.id !== id);
  const nextParked = { ...state.parkedSessions };
  delete nextParked[id];
  // Keep a tombstone mapping for the closed session's still-live prompts
  // (running or pending on the backend). Their terminal websocket events
  // still arrive after close; retaining the mapping lets getSessionContext
  // flag them as orphaned and DROP their output/seed/error routing instead
  // of mis-applying it to whatever tab is active. The entries age out via
  // the promptToSession cap once the prompts leave the queue. Completed
  // prompts of the closed session emit nothing more, so they're dropped.
  const queueState = useQueueStore.getState();
  const livePromptIds = new Set<string>([
    ...queueState.running.map((item) => item.prompt_id),
    ...queueState.pending.map((item) => item.prompt_id),
  ]);
  const nextPromptToSession: Record<string, string> = {};
  const closedSessionPromptIds: string[] = [];
  for (const [promptId, sid] of Object.entries(state.promptToSession)) {
    if (sid !== id) {
      nextPromptToSession[promptId] = sid;
    } else {
      closedSessionPromptIds.push(promptId);
      if (livePromptIds.has(promptId)) nextPromptToSession[promptId] = sid;
    }
  }
  // Drop any still-live queue-store outputs owned by the closed session
  // (completed prompts are pruned as they finish, but an in-flight one may
  // still have a live entry) so livePromptOutputs doesn't leak on close.
  const clearLive = queueState.clearLivePromptOutputs;
  for (const promptId of closedSessionPromptIds) clearLive(promptId);
  // Drop any background-error marker for the closed tab.
  useWorkflowErrorsStore.getState().clearSessionError(id);
  const nextIsLoadingBySession = { ...state.isLoadingBySession };
  delete nextIsLoadingBySession[id];
  const nextLastPromptSignatureBySession = {
    ...state.lastPromptSignatureBySession,
  };
  delete nextLastPromptSignatureBySession[id];
  const nextInfiniteLoopSessionId =
    state.infiniteLoopSessionId === id ? null : state.infiniteLoopSessionId;

  // Closing a parked (non-active) session leaves the active one untouched.
  if (id !== state.activeSessionId) {
    set({
      sessions: remaining,
      parkedSessions: nextParked,
      promptToSession: nextPromptToSession,
      isLoadingBySession: nextIsLoadingBySession,
      lastPromptSignatureBySession: nextLastPromptSignatureBySession,
      infiniteLoopSessionId: nextInfiniteLoopSessionId,
    });
    return;
  }

  // Closing the active session: discard it and activate a neighbour.
  useWorkflowErrorsStore.getState().clearNodeErrors();
  if (remaining.length === 0) {
    set({
      ...clearedWorkflowContent(),
      sessions: [],
      activeSessionId: null,
      parkedSessions: {},
      promptToSession: {},
      isLoadingBySession: {},
      lastPromptSignatureBySession: {},
      infiniteLoopSessionId: null,
      closeForNewWorkflowRequest: null,
      isLoading: false,
      isExecuting: false,
      executingNodeId: null,
      executingNodeHierarchicalKey: null,
      executingNodePath: null,
      executingPromptId: null,
      progress: 0,
      expandedNodeIdMap: {},
      expandedNodePathMap: {},
      executionStartTime: null,
      currentNodeStartTime: null,
    });
    useSeedStore.getState().clearSeedState();
    usePinnedWidgetStore.getState().clearCurrentPin();
    return;
  }
  const closingIndex = state.sessions.findIndex((s) => s.id === id);
  const nextActiveMeta =
    remaining[Math.min(closingIndex, remaining.length - 1)];
  const target = nextParked[nextActiveMeta.id];
  delete nextParked[nextActiveMeta.id];
  set({
    ...(target ? flatFieldsFromSnapshot(target) : {}),
    sessions: remaining,
    activeSessionId: nextActiveMeta.id,
    parkedSessions: nextParked,
    promptToSession: nextPromptToSession,
    isLoadingBySession: nextIsLoadingBySession,
    lastPromptSignatureBySession: nextLastPromptSignatureBySession,
    infiniteLoopSessionId: nextInfiniteLoopSessionId,
    isLoading: nextIsLoadingBySession[nextActiveMeta.id] ?? false,
    infiniteLoop: nextInfiniteLoopSessionId === nextActiveMeta.id,
  });
  if (target) {
    usePinnedWidgetStore
      .getState()
      .restorePinnedWidgetForWorkflow(
        target.currentWorkflowKey ?? "",
        target.workflow ?? ({ nodes: [] } as unknown as Workflow),
      );
  }
};

const resolveCloseForNewWorkflow: WorkflowState["resolveCloseForNewWorkflow"] =
  (closeId) => {
    const pending = get().closeForNewWorkflowRequest;
    set({ closeForNewWorkflowRequest: null });
    get().closeSession(closeId);
    if (pending) {
      get().loadWorkflow(pending.workflow, pending.filename, pending.options);
    }
  };

const cancelCloseForNewWorkflow: WorkflowState["cancelCloseForNewWorkflow"] =
  () => {
    set({ closeForNewWorkflowRequest: null });
  };

const loadWorkflow: WorkflowState["loadWorkflow"] = (
  workflow,
  filename,
  options,
) => {
  // Reject junk-but-JSON-parseable payloads BEFORE any session
  // bookkeeping: throwing later (normalization, key annotation) used to
  // park the active session first and strand the user on a broken
  // blank tab with no explanation.
  const shapeProblem = findWorkflowShapeProblem(workflow);
  if (shapeProblem) {
    useWorkflowErrorsStore
      .getState()
      .setError(
        `Couldn't load${filename ? ` "${filename}"` : " the workflow"}: the file is ${shapeProblem}.`,
      );
    return;
  }
  const aliasNodeTypes = get().nodeTypes;
  if (
    !options?.pathAliasesResolved
    && aliasNodeTypes
    && hasRecognizedPathAliasShape(workflow, aliasNodeTypes)
  ) {
    void restoreWorkflowPathAliases(workflow, aliasNodeTypes)
      .then((resolvedWorkflow) => {
        get().loadWorkflow(resolvedWorkflow, filename, {
          ...options,
          pathAliasesResolved: true,
        });
      })
      .catch((error) => {
        console.error("Failed to resolve workflow path aliases:", error);
        useWorkflowErrorsStore.getState().setError(
          t("Unable to resolve local workflow path aliases. Loading their opaque values instead."),
        );
        get().loadWorkflow(workflow, filename, {
          ...options,
          pathAliasesResolved: true,
        });
      });
    return;
  }

  // Session bookkeeping: decide whether this load opens a new tab or
  // replaces the active one in place (reload/revert callers pass
  // replaceActive).
  let reservedOasisIdsForLoad: string[] = [];
  {
    const st = get();
    const replaceActive = options?.replaceActive ?? false;
    // A freshly opened tab must not reuse an io_id owned by a workflow
    // whose prompt may still be running in another tab. Repair before the
    // new workflow becomes active, otherwise an id-only Oasis result can
    // be consumed by the wrong tab during that overlap window.
    reservedOasisIdsForLoad = [
      ...(!replaceActive && st.workflow ? [st.workflow] : []),
      ...Object.values(st.parkedSessions).map((snapshot) => snapshot.workflow),
    ].flatMap((existingWorkflow) => (
      collectOasisPreviewIoIds(existingWorkflow, st.nodeTypes)
    ));
    // Only open a new tab when there's a real current workflow to park.
    // An active session with no workflow (e.g. a freshly reset store)
    // is reused in place rather than spawning an empty tab.
    if (!replaceActive && st.activeSessionId != null && st.workflow != null) {
      if (st.sessions.length >= MAX_WORKFLOW_SESSIONS) {
        set({
          closeForNewWorkflowRequest: { workflow, filename, options },
        });
        return;
      }
      // Persist + park the outgoing active session, then start a fresh
      // session so the body below builds a clean layout/registry.
      if (st.currentFilename) get().saveCurrentWorkflowState();
      parkActiveSession();
      const newId = generateSessionId();
      set({
        sessions: [...st.sessions, { id: newId }],
        activeSessionId: newId,
        itemKeyByPointer: {},
        pointerByHierarchicalKey: {},
        collapsedItems: {},
        hiddenItems: {},
        connectionHighlightModes: {},
        nodeOutputs: {},
        nodeComparerOutputs: {},
        nodeTextOutputs: {},
        latentPreviews: {},
        latentPreviewTiles: {},
        promptOutputs: {},
        currentFilename: null,
        currentWorkflowKey: null,
        isExecuting: false,
        executingNodeId: null,
        executingNodeHierarchicalKey: null,
        executingNodePath: null,
        executingPromptId: null,
        progress: 0,
        expandedNodeIdMap: {},
        expandedNodePathMap: {},
        executionStartTime: null,
        currentNodeStartTime: null,
      });
    } else if (st.activeSessionId == null) {
      const newId = generateSessionId();
      set({ sessions: [{ id: newId }], activeSessionId: newId });
    } else if (replaceActive && st.infiniteLoopSessionId === st.activeSessionId) {
      // Reloading/reverting the session that was looping cancels its loop.
      set({ infiniteLoopSessionId: null });
    }
  }
  const {
    currentFilename,
    savedWorkflowStates,
    nodeTypes,
    itemKeyByPointer,
    pointerByHierarchicalKey,
  } = get();
  const fresh = options?.fresh ?? false;
  const source = options?.source ?? { type: "other" as const };
  // Always reset workflow error/popover state when switching workflows.
  useWorkflowErrorsStore.getState().clearNodeErrors();

  // Phase 2: Store canonical form directly — no expansion step.
  // Normalize workflow to ensure required fields exist. Strip any embedded
  // credit note so it never enters the in-app workflow (it's re-injected
  // into the embedded copy at execution time, and must stay invisible /
  // unselectable / undeletable in the mobile UI).
  const normalizedNodes = normalizeWorkflowNodes(workflow.nodes).filter(
    (node) => !isMarketingNote(node),
  );

  const normalizedWorkflow: Workflow = {
    ...workflow,
    nodes: normalizedNodes,
    links: workflow.links ?? [],
    groups: workflow.groups ?? [],
    config: workflow.config ?? {},
    last_node_id: Math.max(
      workflow.last_node_id ?? 0,
      // Include subgraph inner node IDs — they share the global ID space.
      // Clamp rather than trust: a stale counter in a tool-generated file
      // would mint duplicate ids.
      maxNodeIdAcrossScopes({ ...workflow, nodes: normalizedNodes, last_node_id: 0 }),
    ),
    last_link_id: Math.max(workflow.last_link_id ?? 0, maxRootLinkId(workflow)),
    version: workflow.version ?? 0.4,
  };
  const canonicalWorkflow = ensureOasisPreviewIoIds(
    canonicalizeWorkflowHierarchicalKeys(
      normalizedWorkflow,
      itemKeyByPointer,
    ),
    nodeTypes,
    undefined,
    reservedOasisIdsForLoad,
  );
  const workflowKey = buildWorkflowCacheKey(
    normalizedWorkflow,
    nodeTypes,
  );
  const pinnedStore = usePinnedWidgetStore.getState();
  const legacyPin = filename
    ? pinnedStore.pinnedWidgets[filename]
    : undefined;
  if (legacyPin && !pinnedStore.pinnedWidgets[workflowKey]) {
    pinnedStore.setPinnedWidget(legacyPin, workflowKey);
  }
  pinnedStore.restorePinnedWidgetForWorkflow(
    workflowKey,
    canonicalWorkflow,
  );

  // Save current workflow state before switching
  if (currentFilename) {
    get().saveCurrentWorkflowState();
  }

  // If loading fresh, clear any saved state for this workflow
  if (fresh && savedWorkflowStates[workflowKey]) {
    const newSavedStates = { ...savedWorkflowStates };
    delete newSavedStates[workflowKey];
    set({ savedWorkflowStates: newSavedStates });
  }

  // Initialize seed modes from workflow (root nodes + inner subgraph nodes)
  const seedModes = deriveSeedModes(canonicalWorkflow, nodeTypes);

  // Check if we have saved state for this workflow (skip if loading fresh)
  let savedState = !fresh ? savedWorkflowStates[workflowKey] : null;
  if (
    !savedState &&
    !fresh &&
    filename &&
    savedWorkflowStates[filename]
  ) {
    savedState = savedWorkflowStates[filename];
    set({
      savedWorkflowStates: {
        ...savedWorkflowStates,
        [workflowKey]: savedWorkflowStates[filename],
      },
    });
  }

  let finalWorkflow = canonicalWorkflow;

  if (savedState) {
    // Loaded workflow prompt/widget values are authoritative; only restore view/UI state from cache.
    const normalizedResult = nodeTypes
      ? normalizeWorkflowComboValues(canonicalWorkflow, nodeTypes)
      : { workflow: canonicalWorkflow, changed: false };
    finalWorkflow = normalizedResult.workflow;
    const normalizedHiddenNodes = normalizeManuallyHiddenNodeKeys(
      finalWorkflow,
      get().hiddenItems,
    );
    const rawCollapsedItems = {
      ...(savedState.collapsedItems ?? {}),
    };
    const rawHiddenItems = {
      ...(savedState.hiddenItems ?? {}),
    };
    const restoredLayout = buildLayoutForWorkflow(
      finalWorkflow,
      normalizedHiddenNodes,
    );
    const reconciled = reconcilePointerRegistry(
      restoredLayout,
      itemKeyByPointer,
      pointerByHierarchicalKey,
    );
    const normalizedHiddenNodesStable = pointerRecordFromLayoutRecord(
      normalizedHiddenNodes,
      reconciled.layoutToStable,
    );
    const normalizedCollapsedItemsStable =
      pointerCollapsedRecordFromLayoutRecord(
        rawCollapsedItems,
        reconciled.layoutToStable,
      );
    const normalizedHiddenItemsStable = pointerRecordFromLayoutRecord(
      rawHiddenItems,
      reconciled.layoutToStable,
    );
    const restoredCollapsedItems = normalizePointerCollapsedRecord(
      {
        ...rawCollapsedItems,
        ...normalizedCollapsedItemsStable,
      },
      reconciled.layoutToStable,
      reconciled.stableToLayout,
    );
    const restoredHiddenItems = normalizePointerBooleanRecord(
      {
        ...rawHiddenItems,
        ...normalizedHiddenItemsStable,
      },
      reconciled.layoutToStable,
      reconciled.stableToLayout,
    );
    const defaultCollapsedItems: Record<string, boolean> = {};
    const restoredWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
      finalWorkflow,
      reconciled.layoutToStable,
    );
    finalWorkflow = restoredWorkflowWithHierarchicalKeys;

    set({
      workflowSource: source,
      workflow: restoredWorkflowWithHierarchicalKeys,
      originalWorkflow: structuredClone(
        restoredWorkflowWithHierarchicalKeys,
      ), // Keep original for dirty check
      diffBaseWorkflow: null,
      lastEnqueuedWorkflow: null,
      scopeStack: [{ type: "root" as const }],
      currentFilename: filename || null,
      currentWorkflowKey: workflowKey,
      collapsedItems: {
        ...defaultCollapsedItems,
        ...restoredCollapsedItems,
      },
      hiddenItems: {
        ...restoredHiddenItems,
        ...normalizedHiddenNodesStable,
      },
      mobileLayout: restoredLayout,
      itemKeyByPointer: reconciled.layoutToStable,
      pointerByHierarchicalKey: reconciled.stableToLayout,
      runCount: 1,
      infiniteLoop: false,
      // Keep the loop owner's armed-but-not-run guard while a loop is
      // still armed (it may belong to a parked tab); reset it only when
      // no loop remains.
      infiniteLoopAwaitingRun: get().infiniteLoopSessionId
        ? get().infiniteLoopAwaitingRun
        : false,
      isStopping: false,
      workflowLoadedAt: Date.now(),
    });
    // Intentional: always derive seed modes from the loaded workflow.
    useSeedStore.getState().setSeedModes(seedModes);
    useSeedStore.getState().setSeedLastValues({});
    if (options?.navigate !== false) {
      useNavigationStore.getState().setCurrentPanel("workflow");
    }
    useImageViewerStore.getState().setViewerState({
      viewerOpen: false,
      viewerImages: [],
      viewerIndex: 0,
      viewerScale: 1,
      viewerTranslate: { x: 0, y: 0 },
    });
  } else {
    const currentState = get();
    const shouldCarryFoldState =
      currentState.currentWorkflowKey === workflowKey;
    const normalizedHiddenNodes = normalizeManuallyHiddenNodeKeys(
      canonicalWorkflow,
      get().hiddenItems,
    );
    const nextLayout = buildLayoutForWorkflow(
      canonicalWorkflow,
      normalizedHiddenNodes,
    );
    const reconciled = reconcilePointerRegistry(
      nextLayout,
      itemKeyByPointer,
      pointerByHierarchicalKey,
    );
    const normalizedHiddenNodesStable = pointerRecordFromLayoutRecord(
      normalizedHiddenNodes,
      reconciled.layoutToStable,
    );
    const defaultCollapsedItems: Record<string, boolean> = {};
    const carriedCollapsedItems = shouldCarryFoldState
      ? normalizePointerCollapsedRecord(
          currentState.collapsedItems,
          reconciled.layoutToStable,
          reconciled.stableToLayout,
        )
      : {};
    useWorkflowErrorsStore.getState().setError(null);
    const normalizedResult = nodeTypes
      ? normalizeWorkflowComboValues(canonicalWorkflow, nodeTypes)
      : { workflow: canonicalWorkflow, changed: false };
    finalWorkflow = normalizedResult.workflow;
    const normalizedWorkflowWithHierarchicalKeys =
      annotateWorkflowWithHierarchicalKeys(
        finalWorkflow,
        reconciled.layoutToStable,
      );
    set({
      workflowSource: source,
      workflow: normalizedWorkflowWithHierarchicalKeys,
      originalWorkflow: structuredClone(
        normalizedWorkflowWithHierarchicalKeys,
      ),
      diffBaseWorkflow: null,
      lastEnqueuedWorkflow: null,
      scopeStack: [{ type: "root" as const }],
      currentFilename: filename || null,
      currentWorkflowKey: workflowKey,
      collapsedItems: {
        ...defaultCollapsedItems,
        ...carriedCollapsedItems,
      },
      mobileLayout: nextLayout,
      itemKeyByPointer: reconciled.layoutToStable,
      pointerByHierarchicalKey: reconciled.stableToLayout,
      hiddenItems: normalizedHiddenNodesStable,
      runCount: 1,
      infiniteLoop: false,
      // Keep the loop owner's armed-but-not-run guard while a loop is
      // still armed (it may belong to a parked tab); reset it only when
      // no loop remains.
      infiniteLoopAwaitingRun: get().infiniteLoopSessionId
        ? get().infiniteLoopAwaitingRun
        : false,
      isStopping: false,
      workflowLoadedAt: Date.now(),
    });
    // Intentional: always derive seed modes from the loaded workflow.
    useSeedStore.getState().setSeedModes(seedModes);
    useSeedStore.getState().setSeedLastValues({});
    if (options?.navigate !== false) {
      useNavigationStore.getState().setCurrentPanel("workflow");
    }
    useImageViewerStore.getState().setViewerState({
      viewerOpen: false,
      viewerImages: [],
      viewerIndex: 0,
      viewerScale: 1,
      viewerTranslate: { x: 0, y: 0 },
    });
  }

  if (nodeTypes) {
    const loadErrors = collectWorkflowLoadErrors(
      finalWorkflow,
      nodeTypes,
    );
    const loadErrorCount = Object.values(loadErrors).reduce(
      (total, nodeErrs) => total + nodeErrs.length,
      0,
    );

    if (loadErrorCount > 0) {
      applyNodeErrors(loadErrors);
      useWorkflowErrorsStore
        .getState()
        .setError(
          loadErrorCount === 1
            ? t("Workflow load error: {count} input references missing options.", { count: loadErrorCount })
            : t("Workflow load error: {count} inputs reference missing options.", { count: loadErrorCount }),
          "workflow-load",
        );
    } else {
      useWorkflowErrorsStore.getState().clearNodeErrors();
    }
  }

  // Track in recent workflows
  if (filename) {
    useRecentWorkflowsStore.getState().addEntry(filename, source);
  }
};

// Close the currently-active workflow tab (activating a neighbour, or
// emptying the store when it was the last tab).

const unloadWorkflow: WorkflowState["unloadWorkflow"] = () => {
  const { activeSessionId } = get();
  if (activeSessionId) {
    get().closeSession(activeSessionId);
  } else {
    useWorkflowErrorsStore.getState().clearNodeErrors();
    set({
      ...clearedWorkflowContent(),
      workflowLoadedAt: Date.now(),
    });
    useSeedStore.getState().clearSeedState();
    usePinnedWidgetStore.getState().clearCurrentPin();
  }
  useNavigationStore.getState().setCurrentPanel("workflow");
  useImageViewerStore.getState().setViewerState({
    viewerOpen: false,
    viewerImages: [],
    viewerIndex: 0,
    viewerScale: 1,
    viewerTranslate: { x: 0, y: 0 },
  });
};

const setSavedWorkflow: WorkflowState["setSavedWorkflow"] = (
  workflow,
  filename,
) => {
  useWorkflowErrorsStore.getState().setError(null);
  // Capture hidden-ness BEFORE we overwrite the source/filename below: if the
  // workflow being saved is hidden, the saved copy (e.g. a Save-As under a new
  // name) must stay hidden too, per "anything created from a hidden workflow
  // stays hidden".
  const wasHidden = isWorkflowHidden(get().workflowSource, get().currentFilename);
  const workflowKey = buildWorkflowCacheKey(workflow, get().nodeTypes);
  const nextLayout = buildLayoutForWorkflow(
    workflow,
    layoutRecordFromPointerRecord(
      get().hiddenItems,
      get().pointerByHierarchicalKey,
    ),
  );
  const reconciled = reconcilePointerRegistry(
    nextLayout,
    get().itemKeyByPointer,
    get().pointerByHierarchicalKey,
  );
  const workflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
    workflow,
    reconciled.layoutToStable,
  );
  set({
    workflow: workflowWithHierarchicalKeys,
    originalWorkflow: structuredClone(workflowWithHierarchicalKeys),
    diffBaseWorkflow: null,
    lastEnqueuedWorkflow: null,
    currentFilename: filename,
    currentWorkflowKey: workflowKey,
    workflowSource: { type: 'user', filename },
    mobileLayout: nextLayout,
    itemKeyByPointer: reconciled.layoutToStable,
    pointerByHierarchicalKey: reconciled.stableToLayout,
  });
  // Persist hidden provenance onto the saved file's path (no-op if it's
  // already hidden, e.g. saved into a hidden folder or a dot path).
  if (wasHidden) {
    const hiddenStore = useWorkflowHiddenStore.getState();
    const alreadyHidden = isWorkflowHidden(
      { type: 'user', filename },
      filename,
      hiddenStore.hidden,
    );
    if (!alreadyHidden) hiddenStore.toggleHidden(filename);
  }
};

const setNodeTypes: WorkflowState["setNodeTypes"] = (types) => {
  set({ nodeTypes: types });
  const {
    workflow,
    currentWorkflowKey,
    currentFilename,
    savedWorkflowStates,
  } = get();
  if (!workflow) return;
  const nextKey = buildWorkflowCacheKey(workflow, types);
  if (currentWorkflowKey === nextKey) return;

  const nextSavedStates = { ...savedWorkflowStates };
  if (
    currentWorkflowKey &&
    nextSavedStates[currentWorkflowKey] &&
    !nextSavedStates[nextKey]
  ) {
    nextSavedStates[nextKey] = nextSavedStates[currentWorkflowKey];
    delete nextSavedStates[currentWorkflowKey];
  } else if (
    !currentWorkflowKey &&
    currentFilename &&
    nextSavedStates[currentFilename] &&
    !nextSavedStates[nextKey]
  ) {
    nextSavedStates[nextKey] = nextSavedStates[currentFilename];
  }

  const pinnedStore = usePinnedWidgetStore.getState();
  const legacyPin = currentFilename
    ? pinnedStore.pinnedWidgets[currentFilename]
    : undefined;
  const existingPin = currentWorkflowKey
    ? pinnedStore.pinnedWidgets[currentWorkflowKey]
    : undefined;
  if (legacyPin && !pinnedStore.pinnedWidgets[nextKey]) {
    pinnedStore.setPinnedWidget(legacyPin, nextKey);
  } else if (existingPin && !pinnedStore.pinnedWidgets[nextKey]) {
    pinnedStore.setPinnedWidget(existingPin, nextKey);
  }

  set({
    currentWorkflowKey: nextKey,
    savedWorkflowStates: nextSavedStates,
  });
  pinnedStore.restorePinnedWidgetForWorkflow(nextKey, workflow);
};

const addInputComboOption: WorkflowState["addInputComboOption"] = (
  value,
) => {
  const { nodeTypes } = get();
  if (!nodeTypes || !value) return;
  const next = addInputFileOptionToNodeTypes(nodeTypes, value);
  // Only the option lists change (not which node types exist), so the
  // workflow cache key is unaffected — a plain nodeTypes swap is enough,
  // no need for setNodeTypes' cache-key/pin bookkeeping.
  if (next !== nodeTypes) set({ nodeTypes: next });
};

const saveCurrentWorkflowState: WorkflowState["saveCurrentWorkflowState"] =
  () => {
    const {
      workflow,
      currentWorkflowKey,
      savedWorkflowStates,
      collapsedItems,
      hiddenItems,
    } = get();
    const seedModes = useSeedStore.getState().seedModes;
    if (!workflow || !currentWorkflowKey) return;
    const savedBookmarkedItems =
      savedWorkflowStates[currentWorkflowKey]?.bookmarkedItems ?? [];

    // Save current workflow's UI state
    const nodeStates: Record<number, SavedNodeState> = {};
    for (const node of workflow.nodes) {
      nodeStates[node.id] = {
        mode: node.mode,
        flags: node.flags
          ? { collapsed: Boolean(node.flags.collapsed) }
          : undefined,
        widgets_values: node.widgets_values,
      };
    }

    set({
      savedWorkflowStates: {
        ...savedWorkflowStates,
        [currentWorkflowKey]: {
          nodes: nodeStates,
          seedModes: { ...seedModes },
          collapsedItems: { ...collapsedItems },
          hiddenItems: { ...hiddenItems },
          bookmarkedItems: [...savedBookmarkedItems],
        },
      },
    });
  };

const setSearchQuery: WorkflowState["setSearchQuery"] = (query) => {
  set({ searchQuery: query });
};

const setSearchOpen: WorkflowState["setSearchOpen"] = (open) => {
  set({ searchOpen: open });
};

const requestAddNodeModal: WorkflowState["requestAddNodeModal"] = (
  options,
) => {
  set({
    addNodeModalRequest: {
      id: ++addNodeModalRequestId,
      groupId: options?.groupId ?? null,
      subgraphId: options?.subgraphId ?? null,
    },
  });
};

const clearAddNodeModalRequest: WorkflowState["clearAddNodeModalRequest"] =
  () => {
    set({ addNodeModalRequest: null });
  };

const clearEditContainerLabelRequest: WorkflowState["clearEditContainerLabelRequest"] =
  () => {
    set({ editContainerLabelRequest: null });
  };

const prepareRepositionScrollTarget: WorkflowState["prepareRepositionScrollTarget"] =
  (target) => {
    set((state) => {
      const path = findPathToRepositionTarget(state.mobileLayout, target);
      if (!path) return {};

      const nextCollapsedItems = { ...state.collapsedItems };
      for (const groupKey of path.groupKeys) {
        delete nextCollapsedItems[groupKey];
      }
      for (const subgraphId of path.subgraphIds) {
        const key = state.workflow
          ? findSubgraphHierarchicalKey(state.workflow, subgraphId)
          : null;
        if (!key) continue;
        delete nextCollapsedItems[key];
      }
      if (target.type === "group") {
        for (const key of collectGroupHierarchicalKeys(
          state.mobileLayout,
          target.id,
          target.subgraphId ?? null,
        )) {
          nextCollapsedItems[key] = true;
        }
      } else if (target.type === "subgraph") {
        const key = state.workflow
          ? findSubgraphHierarchicalKey(state.workflow, target.id)
          : null;
        if (key) nextCollapsedItems[key] = true;
      }

      return {
        collapsedItems: nextCollapsedItems,
      };
    });
  };

const toggleConnectionButtonsVisible: WorkflowState["toggleConnectionButtonsVisible"] =
  () => {
    set((state) => ({
      connectionButtonsVisible: !state.connectionButtonsVisible,
    }));
  };

const updateWorkflowDuration: WorkflowState["updateWorkflowDuration"] = (
  signature,
  durationMs,
) => {
  if (!signature || durationMs <= 0) return;
  set((state) => {
    const prev = state.workflowDurationStats[signature];
    const count = (prev?.count ?? 0) + 1;
    const avgMs = prev
      ? (prev.avgMs * prev.count + durationMs) / count
      : durationMs;
    return {
      workflowDurationStats: {
        ...state.workflowDurationStats,
        [signature]: { avgMs, count },
      },
    };
  });
};

const clearWorkflowCache: WorkflowState["clearWorkflowCache"] = () => {
  const {
    currentWorkflowKey,
    savedWorkflowStates,
    originalWorkflow,
    nodeTypes,
  } = get();
  const nextSavedStates = { ...savedWorkflowStates };
  if (currentWorkflowKey) {
    delete nextSavedStates[currentWorkflowKey];
    usePinnedWidgetStore
      .getState()
      .clearPinnedWidgetForKey(currentWorkflowKey);
  } else {
    usePinnedWidgetStore.getState().clearCurrentPin();
  }

  if (!originalWorkflow) {
    useSeedStore.getState().setSeedModes({});
    useSeedStore.getState().setSeedLastValues({});
    set({
      savedWorkflowStates: nextSavedStates,
    });
    return;
  }

  const seedModes = deriveSeedModes(originalWorkflow, nodeTypes);

  const restoredWorkflow = structuredClone(originalWorkflow);
  useSeedStore.getState().setSeedModes(seedModes);
  useSeedStore.getState().setSeedLastValues({});
  useWorkflowErrorsStore.getState().setError(null);
  set({
    savedWorkflowStates: nextSavedStates,
    ...(() => {
      const nextLayout = buildLayoutForWorkflow(
        restoredWorkflow,
        layoutRecordFromPointerRecord(
          get().hiddenItems,
          get().pointerByHierarchicalKey,
        ),
      );
      const reconciled = reconcilePointerRegistry(nextLayout, {}, {});
      const restoredWorkflowWithHierarchicalKeys =
        annotateWorkflowWithHierarchicalKeys(
          restoredWorkflow,
          reconciled.layoutToStable,
        );
      return {
        workflow: restoredWorkflowWithHierarchicalKeys,
        mobileLayout: nextLayout,
        itemKeyByPointer: reconciled.layoutToStable,
        pointerByHierarchicalKey: reconciled.stableToLayout,
      };
    })(),
    runCount: 1,
    infiniteLoop: false,
    // As in loadWorkflow: only reset the armed-but-not-run guard when no
    // loop remains armed.
    infiniteLoopAwaitingRun: get().infiniteLoopSessionId
      ? get().infiniteLoopAwaitingRun
      : false,
    isStopping: false,
    workflowLoadedAt: Date.now(),
  });
};

const ensureHierarchicalKeysAndRepair: WorkflowState["ensureHierarchicalKeysAndRepair"] =
  () => {
    const {
      workflow,
      originalWorkflow,
      itemKeyByPointer,
      pointerByHierarchicalKey,
      mobileLayout,
      hiddenItems,
      collapsedItems,
    } = get();
    if (!workflow) return false;
    if (!hasMissingHierarchicalKeys(workflow) && !hasLayoutGroupKeyMismatch(workflow, mobileLayout)) return false;

    const workflowWithKeys = canonicalizeWorkflowHierarchicalKeys(
      workflow,
      itemKeyByPointer,
    );
    const nextLayout = buildLayoutForWorkflow(
      workflowWithKeys,
      layoutRecordFromPointerRecord(hiddenItems, pointerByHierarchicalKey),
    );
    const reconciled = reconcilePointerRegistry(
      nextLayout,
      itemKeyByPointer,
      pointerByHierarchicalKey,
    );
    const nextWorkflow = annotateWorkflowWithHierarchicalKeys(
      workflowWithKeys,
      reconciled.layoutToStable,
    );
    const nextOriginalWorkflow = originalWorkflow
      ? annotateWorkflowWithHierarchicalKeys(
          originalWorkflow,
          reconciled.layoutToStable,
        )
      : originalWorkflow;
    const nextHiddenItems = normalizePointerBooleanRecord(
      hiddenItems,
      reconciled.layoutToStable,
      reconciled.stableToLayout,
    );
    const nextCollapsedItems = normalizePointerCollapsedRecord(
      collapsedItems,
      reconciled.layoutToStable,
      reconciled.stableToLayout,
    );

    // If, for any reason, a second pass still reports missing keys or layout mismatch, do not reload-loop.
    if (hasMissingHierarchicalKeys(nextWorkflow)) return false;
    if (hasLayoutGroupKeyMismatch(nextWorkflow, nextLayout)) return false;

    set({
      workflow: nextWorkflow,
      originalWorkflow: nextOriginalWorkflow,
      mobileLayout:
        mobileLayout === nextLayout ? mobileLayout : nextLayout,
      itemKeyByPointer: reconciled.layoutToStable,
      pointerByHierarchicalKey: reconciled.stableToLayout,
      hiddenItems: nextHiddenItems,
      collapsedItems: nextCollapsedItems,
    });
    return true;
  };

// updates PrimitiveNode widget values after a generation completes, based on that node's control_after_generate mode

  return { setMobileLayout, commitRepositionLayout, switchToSession, closeSession, resolveCloseForNewWorkflow, cancelCloseForNewWorkflow, loadWorkflow, unloadWorkflow, setSavedWorkflow, setNodeTypes, addInputComboOption, saveCurrentWorkflowState, setSearchQuery, setSearchOpen, requestAddNodeModal, clearAddNodeModalRequest, clearEditContainerLabelRequest, prepareRepositionScrollTarget, toggleConnectionButtonsVisible, updateWorkflowDuration, clearWorkflowCache, ensureHierarchicalKeysAndRepair };
}

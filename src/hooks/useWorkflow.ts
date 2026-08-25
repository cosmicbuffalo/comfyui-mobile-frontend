import {create} from "zustand";
import {persist} from "zustand/middleware";
import {createThrottledPersistStorage} from "@/utils/idbStorage";
import {
  type SeedMode,
  SPECIAL_SEED_RANDOM,
  SPECIAL_SEED_INCREMENT,
  SPECIAL_SEED_DECREMENT,
  DEFAULT_SPECIAL_SEED_RANGE,
  isSpecialSeedValue,
  getSpecialSeedMode,
  getSpecialSeedValueForMode,
  getWidgetIndexForInput,
  findSeedWidgetIndex,
  getSeedStep,
  getSeedRandomBounds,
  generateSeedFromNode,
  findSeedControlWidgetIndex,
  resolveSpecialSeedToUse,
} from "@/utils/seedUtils";
import {
  getWidgetDefinitions,
  getInputWidgetDefinitions,
  resolveSubgraphPlaceholderWidgetDefs,
  resolveSubgraphPlaceholderInputWidgetDefs,
  resolveSubgraphProxyWidgetDefs,
  resolveSubgraphProxyInputWidgetDefs,
  isPlaceholderPromotedConnection,
  resolveSubgraphBoundaryWidgetDefs,
  resolveSubgraphBoundaryInputWidgetDefs,
} from "@/utils/widgetDefinitions";
import {
  createEmptyMobileLayout,
} from "@/utils/mobileLayout";
import {
  type ScopeFrame,
} from "@/utils/canonicalWorkflowOps";

// ScopeFrame is defined in canonicalWorkflowOps.ts and re-exported here.
export type { ScopeFrame };

// Re-export utilities for external consumers
export type { SeedMode };
export type { MobileLayout } from "@/utils/mobileLayout";
import {
  stripWorkflowClientMetadata,
} from "./useWorkflow/metadataNormalization";
export { stripWorkflowClientMetadata };

// Extracted pure-logic modules (see ./useWorkflow/): layout ops, seed
// expansion, combo normalization, session helpers, workflow signatures.
import { generateSessionId, normalizeSessionInPlace, reconcileRehydratedSessions, stripLatentPreviewsFromSnapshots } from "./useWorkflow/sessions";
import type {SessionNormalizable} from "./useWorkflow/sessions";
import {createNodeControlActions} from "./useWorkflow/nodeControl";
import {createGraphEditActions} from "./useWorkflow/graphEdit";
import {createExecutionActions} from "./useWorkflow/execution";
import {createSessionActions} from "./useWorkflow/sessionActions";
import type {
  WorkflowState,
} from "./useWorkflow/state";
import type {
  WorkflowSessionSnapshot,
} from "./useWorkflow/sessions";

// Re-exports: preserve the public API of `@/hooks/useWorkflow` for the
// modules that imported these symbols before the split.
export type {
  DenoVideoCompareAudio,
  DenoVideoCompareMetadata,
  NodeComparerOutput,
  WorkflowSource,
} from "./useWorkflow/state";
export type { WorkflowState } from "./useWorkflow/state";
export { MAX_WORKFLOW_SESSIONS, reconcileRehydratedSessions } from "./useWorkflow/sessions";
export { applySeedOverridesForExpansion } from "./useWorkflow/seedExpansion";
export { getWorkflowSignature, isWorkflowModified } from "./useWorkflow/signature";
export {
  SPECIAL_SEED_RANDOM,
  SPECIAL_SEED_INCREMENT,
  SPECIAL_SEED_DECREMENT,
  DEFAULT_SPECIAL_SEED_RANGE,
  isSpecialSeedValue,
  getSpecialSeedMode,
  getSpecialSeedValueForMode,
  findSeedWidgetIndex,
  getSeedStep,
  getSeedRandomBounds,
  generateSeedFromNode,
  resolveSpecialSeedToUse,
  getWidgetIndexForInput,
  getWidgetDefinitions,
  getInputWidgetDefinitions,
  resolveSubgraphPlaceholderWidgetDefs,
  resolveSubgraphPlaceholderInputWidgetDefs,
  resolveSubgraphProxyWidgetDefs,
  resolveSubgraphProxyInputWidgetDefs,
  isPlaceholderPromotedConnection,
  resolveSubgraphBoundaryWidgetDefs,
  resolveSubgraphBoundaryInputWidgetDefs,
  findSeedControlWidgetIndex,
};


// Monotonic recency stamp for streaming queue latent previews (see
// setQueueLatentPreview). A plain counter — not Date.now() — so it stays
// deterministic and resume-safe.

export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set, get) => {
      const {
        updateNodeWidget,
        renameSetGetNode,
        updateNodeWidgets,
        updateSubgraphInnerNodeWidget,
        updateNodeProperties,
        updateNodeTitle,
        convertImageOutputNode,
        toggleBypass,
        scrollToNode,
        cycleConnectionHighlight,
        setConnectionHighlightMode,
        setItemHidden,
        revealNodeWithParents,
        showAllHiddenNodes,
        setItemCollapsed,
        bypassAllInContainer,
        deleteContainer,
        updateContainerTitle,
        updateWorkflowItemColor,
      } = createNodeControlActions(set, get);
      const { deleteNode, collapseSetGetNodes, connectNodes, disconnectInput, addNode, duplicateNode, pasteClipboard, copyContainer, pasteIntoContainer, addGroupNearNode, copySelectedItems, deleteSelectedItems, createGroupFromItems, addNodeAndConnect, ensureWidgetInputSlot, popWidgetToPrimitive, enterSubgraph, exitSubgraph, exitToRoot, exitToDepth, navigateToSubgraphTrail } = createGraphEditActions(set, get);
      const { setExecutionState, setNodeOutput, setNodeComparerOutput, setNodeTextOutput, clearNodeOutputs, setLatentPreviewTiles, setLatentPreview, clearAllLatentPreviews, setQueueLatentPreviewTiles, setQueueLatentPreview, clearQueueLatentPreviews, addPromptOutputs, clearPromptOutputs, setRunCount, setInfiniteLoop, setIsStopping, setSavingSessionId, setFollowQueue, applyControlAfterGenerate, queueWorkflow } = createExecutionActions(set, get);
      const { setMobileLayout, commitRepositionLayout, switchToSession, closeSession, resolveCloseForNewWorkflow, cancelCloseForNewWorkflow, loadWorkflow, unloadWorkflow, setSavedWorkflow, setNodeTypes, addInputComboOption, saveCurrentWorkflowState, setSearchQuery, setSearchOpen, requestAddNodeModal, clearAddNodeModalRequest, clearEditContainerLabelRequest, prepareRepositionScrollTarget, toggleConnectionButtonsVisible, updateWorkflowDuration, clearWorkflowCache, ensureHierarchicalKeysAndRepair } = createSessionActions(set, get);

      return {
        workflowSource: null,
        workflow: null,
        originalWorkflow: null,
        diffBaseWorkflow: null,
        lastEnqueuedWorkflow: null,
        scopeStack: [{ type: "root" as const }],
        currentFilename: null,
        currentWorkflowKey: null,
        nodeTypes: null,
        isLoading: false,
        savedWorkflowStates: {},
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
        nodeDurationStats: {},
        workflowDurationStats: {},
        nodeOutputs: {},
        nodeComparerOutputs: {},
        nodeTextOutputs: {},
        latentPreviews: {},
        latentPreviewTiles: {},
        promptOutputs: {},
        runCount: 1,
        infiniteLoop: false,
        infiniteLoopAwaitingRun: false,
        isStopping: false,
        followQueue: false,
        workflowLoadedAt: 0,
        sessions: [],
        activeSessionId: null,
        parkedSessions: {},
        infiniteLoopSessionId: null,
        promptToSession: {},
        latentPreviewByPrompt: {},
        isLoadingBySession: {},
        lastPromptSignatureBySession: {},
        savingSessionId: null,
        closeForNewWorkflowRequest: null,
        connectionHighlightModes: {},
        connectionButtonsVisible: true,
        searchQuery: "",
        searchOpen: false,
        addNodeModalRequest: null,
        editContainerLabelRequest: null,
        collapsedItems: {},
        hiddenItems: {},

        // Layout related
        itemKeyByPointer: {},
        pointerByHierarchicalKey: {},
        mobileLayout: createEmptyMobileLayout(),
        setMobileLayout,
        commitRepositionLayout,

        // Workflow editing related
        addNode,
        addGroupNearNode,
        addNodeAndConnect,
        popWidgetToPrimitive,
        ensureWidgetInputSlot,
        deleteNode,
        collapseSetGetNodes,
        duplicateNode,
        pasteClipboard,
        copyContainer,
        pasteIntoContainer,
        deleteContainer,
        copySelectedItems,
        createGroupFromItems,
        deleteSelectedItems,
        connectNodes,
        disconnectInput,
        setNodeOutput,
        setNodeComparerOutput,
        setNodeTextOutput,
        clearNodeOutputs,
        setLatentPreview,
        setLatentPreviewTiles,
        clearAllLatentPreviews,
        setQueueLatentPreview,
        setQueueLatentPreviewTiles,
        clearQueueLatentPreviews,
        requestAddNodeModal,
        clearAddNodeModalRequest,
        clearEditContainerLabelRequest,
        toggleBypass,
        bypassAllInContainer,
        updateNodeWidget,
        updateNodeWidgets,
        renameSetGetNode,
        updateSubgraphInnerNodeWidget,

        updateNodeProperties,
        convertImageOutputNode,

        // Cosmetic workflow editing
        updateNodeTitle,
        updateContainerTitle,
        updateWorkflowItemColor,

        // Execution related
        setExecutionState,
        addPromptOutputs,
        clearPromptOutputs,
        queueWorkflow,
        applyControlAfterGenerate,

        // bottom bar button related
        setRunCount,
        setInfiniteLoop,
        setIsStopping,
        setSavingSessionId,
        setFollowQueue,

        // Cosmetic navigation
        cycleConnectionHighlight,
        setConnectionHighlightMode,
        toggleConnectionButtonsVisible,
        setSearchQuery,
        setSearchOpen,
        prepareRepositionScrollTarget,
        scrollToNode,

        // Visibility
        setItemHidden,
        revealNodeWithParents,
        showAllHiddenNodes,
        setItemCollapsed,

        // Core workflow state
        setNodeTypes,
        addInputComboOption,
        loadWorkflow,
        unloadWorkflow,
        switchToSession,
        closeSession,
        resolveCloseForNewWorkflow,
        cancelCloseForNewWorkflow,
        setSavedWorkflow,
        clearWorkflowCache,
        ensureHierarchicalKeysAndRepair,
        updateWorkflowDuration,
        saveCurrentWorkflowState,

        // Scope navigation
        enterSubgraph,
        exitSubgraph,
        exitToRoot,
        exitToDepth,
        navigateToSubgraphTrail,
      };
    },
    {
      name: "workflow-storage",
      // IndexedDB-backed: the persisted payload (every open session's workflow,
      // layout, and node outputs) can exceed localStorage's quota.
      storage: createThrottledPersistStorage(),
      partialize: (state) => ({
        // Active session lives in the flat fields; other open sessions are in
        // parkedSessions (which by invariant never contains the active id).
        workflow: state.workflow,
        originalWorkflow: state.originalWorkflow,
        currentFilename: state.currentFilename,
        currentWorkflowKey: state.currentWorkflowKey,
        savedWorkflowStates: state.savedWorkflowStates,
        runCount: state.runCount,
        hiddenItems: state.hiddenItems,
        collapsedItems: state.collapsedItems,
        itemKeyByPointer: state.itemKeyByPointer,
        pointerByHierarchicalKey: state.pointerByHierarchicalKey,
        connectionButtonsVisible: state.connectionButtonsVisible,
        mobileLayout: state.mobileLayout,
        isExecuting: state.isExecuting,
        executingNodeId: state.executingNodeId,
        executingNodeHierarchicalKey: state.executingNodeHierarchicalKey,
        executingNodePath: state.executingNodePath,
        executingPromptId: state.executingPromptId,
        progress: state.progress,
        executionStartTime: state.executionStartTime,
        currentNodeStartTime: state.currentNodeStartTime,
        nodeDurationStats: state.nodeDurationStats,
        workflowDurationStats: state.workflowDurationStats,
        // Node outputs are server file references (not blob URLs), so they
        // re-render after a refresh — persist them so the previous run's images
        // (incl. Image Comparer A/B) stay visible. `latentPreviews` are
        // transient blob: URLs (dead after refresh), so they are NOT persisted.
        nodeOutputs: state.nodeOutputs,
        nodeComparerOutputs: state.nodeComparerOutputs,
        nodeTextOutputs: state.nodeTextOutputs,
        // Session registry
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        parkedSessions: stripLatentPreviewsFromSnapshots(state.parkedSessions),
        infiniteLoopSessionId: state.infiniteLoopSessionId,
        // Persisted with the loop owner: a loop armed via the toggle but never
        // explicitly Run must stay awaiting across a reload, or the idle-resume
        // driver would auto-start a generation the user never began.
        infiniteLoopAwaitingRun: state.infiniteLoopAwaitingRun,
        promptToSession: state.promptToSession,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        try {
          // Migrate a legacy single-workflow payload (no `sessions`) into one
          // session so existing users see no behavior change.
          if (!Array.isArray(state.sessions) || state.sessions.length === 0) {
            if (state.workflow) {
              const id = generateSessionId();
              state.sessions = [{ id }];
              state.activeSessionId = id;
              state.infiniteLoopSessionId = state.infiniteLoop ? id : null;
            } else {
              state.sessions = [];
              state.activeSessionId = null;
              state.infiniteLoopSessionId = null;
            }
            state.parkedSessions = state.parkedSessions ?? {};
            state.promptToSession = state.promptToSession ?? {};
          }
          state.parkedSessions = state.parkedSessions ?? {};
          state.promptToSession = state.promptToSession ?? {};

          // Normalize the active session (flat fields) and every parked session,
          // threading the shared savedWorkflowStates map through each.
          let savedStates = state.savedWorkflowStates ?? {};
          savedStates = normalizeSessionInPlace(
            state as unknown as SessionNormalizable,
            savedStates,
          );
          const nextParked: Record<string, WorkflowSessionSnapshot> = {};
          for (const [pid, snap] of Object.entries(state.parkedSessions)) {
            const copy = { ...snap };
            savedStates = normalizeSessionInPlace(
              copy as unknown as SessionNormalizable,
              savedStates,
            );
            nextParked[pid] = copy;
          }
          state.parkedSessions = nextParked;
          state.savedWorkflowStates = savedStates;
        } catch (err) {
          // Normalizing persisted sessions must NEVER brick startup. If this
          // throws, zustand skips its finish-hydration listeners, App's
          // `storeHydrated` gate never flips, and the app hangs forever on the
          // loading spinner. Degrade to safe defaults so hydration still
          // completes — a slightly-unnormalized session is recoverable; a
          // permanent spinner is not.
          console.error('[workflow] Failed to normalize rehydrated state:', err);
          if (!Array.isArray(state.sessions)) state.sessions = [];
          state.parkedSessions = state.parkedSessions ?? {};
          state.promptToSession = state.promptToSession ?? {};
          state.savedWorkflowStates = state.savedWorkflowStates ?? {};
        }

        // Defensive reconciliation against a corrupt or partially-written
        // payload (e.g. a crash between the two `set`s that update sessions and
        // parkedSessions). Keeps the tab strip, the active session, and the
        // parked snapshots mutually consistent. Wrapped so it can never brick
        // startup.
        try {
          reconcileRehydratedSessions(state);
        } catch (err) {
          console.error('[workflow] Failed to reconcile rehydrated sessions:', err);
        }

        // Transient run flags do not survive a refresh; the websocket reconciles
        // live execution state against the queue on connect.
        state.isLoading = false;
        state.isLoadingBySession = {};
        state.closeForNewWorkflowRequest = null;
        state.infiniteLoop = state.infiniteLoopSessionId === state.activeSessionId;
        // The awaiting-run guard is only meaningful while a loop is armed.
        if (!state.infiniteLoopSessionId) state.infiniteLoopAwaitingRun = false;
        // Errors are managed by useWorkflowErrors.
      },
    },
  ),
);


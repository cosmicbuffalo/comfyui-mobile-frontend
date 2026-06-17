import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  HistoryOutputImage,
  Workflow,
  WorkflowGroup,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphLink,
  NodeTypes,
} from "@/api/types";
import { useImageViewerStore } from "@/hooks/useImageViewer";
import {
  useWorkflowErrorsStore,
  type NodeError,
} from "@/hooks/useWorkflowErrors";
import * as api from "@/api/client";
import { useQueueStore } from "@/hooks/useQueue";
import { computeQueueWorkflowDiff, selectDiffBase } from "@/utils/workflowDiff";
import { useNavigationStore } from "@/hooks/useNavigation";
import { usePinnedWidgetStore } from "@/hooks/usePinnedWidget";
import { useRecentWorkflowsStore } from "@/hooks/useRecentWorkflows";
import { useWorkflowHiddenStore } from "@/hooks/useWorkflowHidden";
import { useSeedStore } from "@/hooks/useSeed";
import { useGenerationSettingsStore } from "@/hooks/useGenerationSettings";
import {
  hasRecognizedFilePrefixAliasShape,
  obfuscateQueuedInputPaths,
  restoreWorkflowFilePrefixes,
} from "@/utils/inputPathAliases";
import {
  buildWorkflowPromptInputs,
  getNodeWidgetIndexMap,
  getWidgetValue,
  normalizeWidgetValue,
  resolveComboOption,
} from "@/utils/workflowInputs";
import { buildWorkflowCacheKey } from "@/utils/workflowCacheKey";
import { collectAllWorkflowGroups, collectAllWorkflowNodes } from "@/utils/workflowNodes";
import { isPowerLoraLoaderNodeType } from "@/utils/loraManager";
import { userScrolledSince } from "@/utils/scrollInterrupt";
import { addInputFileOptionToNodeTypes } from "@/utils/nodeTypeOptions";
import { createThrottledPersistStorage } from "@/utils/idbStorage";
import { expandWorkflowSubgraphs } from "@/utils/expandWorkflowSubgraphs";
import { dissolveSubgraph } from "@/utils/dissolveSubgraph";
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
  clampSeedToNodeBounds,
  hasSeedControlWidget,
  resolveSpecialSeedToUse,
} from "@/utils/seedUtils";
import {
  getWidgetDefinitions,
  getInputWidgetDefinitions,
  resolveSubgraphPlaceholderWidgetDefs,
  resolveSubgraphPlaceholderInputWidgetDefs,
  resolveSubgraphProxyWidgetDefs,
  resolveSubgraphProxyInputWidgetDefs,
} from "@/utils/widgetDefinitions";
import { findConnectedNode, orderNodesForMobile } from "@/utils/nodeOrdering";
import { areTypesCompatible } from "@/utils/connectionUtils";
import {
  type ItemRef,
  type MobileLayout,
  type ContainerId,
  createEmptyMobileLayout,
  buildDefaultLayout,
  makeLocationPointer,
  findItemInLayout,
  removeNodeFromLayout,
  addNodeToLayout,
  placeLayoutItemAfter,
  removeGroupFromLayoutByKey,
} from "@/utils/mobileLayout";
import {
  clampPositionToGroup,
  getBottomPlacement,
  getBottomPlacementForScope,
  getPositionNearNode,
} from "@/utils/nodePositioning";
import { syncWorkflowGeometryFromLayoutChange } from "@/utils/graphSync";
import {
  type ScopeFrame,
  resolveCurrentScope,
  resolveScopeForHierarchicalKey,
  resolveNodeByHierarchicalKey,
  getLinkId,
  getLinkOriginId,
  getLinkOriginSlot,
  getLinkTargetId,
  getLinkTargetSlot,
  getLinkType,
  makeScopeLink,
  maxNodeIdAcrossScopes,
} from "@/utils/canonicalWorkflowOps";
import { duplicateWorkflowNode } from "@/utils/duplicateNode";
import type { HierarchicalKey, ScopedNodeIdentity } from "@/utils/workflowHierarchy";
import {
  annotateWorkflowWithHierarchicalKeys,
  buildScopeStackForSubgraphTrail,
  buildSubgraphParentMap,
  canonicalizeWorkflowHierarchicalKeys,
  clearNodeUiStateForTargets,
  collectBypassContainerTargetNodesFromLayout,
  collectBypassGroupTargetNodes,
  collectBypassSubgraphTargetNodes,
  collectDescendantSubgraphs,
  collectGroupHierarchicalKeys,
  collectNodeHierarchicalKeys,
  collectNodeStateKeys,
  dedupeScopedNodeIdentities,
  findSubgraphHierarchicalKey,
  getGroupIdForNode,
  getParentSubgraphIdFromContainer,
  getSubgraphChildMap,
  hasLayoutGroupKeyMismatch,
  hasMissingHierarchicalKeys,
  layoutMatchesWorkflowNodes,
  layoutRecordFromPointerRecord,
  normalizeManuallyHiddenNodeKeys,
  normalizeMobileLayoutGroupKeys,
  normalizePointerBookmarkList,
  normalizePointerBooleanRecord,
  normalizePointerCollapsedRecord,
  pointerCollapsedRecordFromLayoutRecord,
  pointerRecordFromLayoutRecord,
  reconcilePointerRegistry,
  resolveContainerIdentityFromHierarchicalKey,
  resolveNodeIdentityFromHierarchicalKey,
} from "@/utils/workflowHierarchy";
import { findLayoutPath } from "@/utils/layoutTraversal";
import { resolveWorkflowColor, themeColors } from "@/theme/colors";
import { validateAndNormalizeWorkflow } from "@/utils/workflowValidator";
import {
  HIDDEN_WORKFLOW_EXTRA_DATA_KEY,
  isWorkflowHidden,
} from "@/utils/workflowHidden";

// ScopeFrame is defined in canonicalWorkflowOps.ts and re-exported here.
export type { ScopeFrame };

// Re-export utilities for external consumers
export type { SeedMode };
export type { MobileLayout } from "@/utils/mobileLayout";
import {
  normalizeWorkflowNodes,
  stripWorkflowClientMetadata,
} from "./useWorkflow/metadataNormalization";
export { stripWorkflowClientMetadata };
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
};

// Internal type alias
type SeedModeType = SeedMode;
type SeedLastValues = Record<number, number | null>;

function yieldToBrowserPaint(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        window.setTimeout(resolve, 0);
      });
      return;
    }

    window.setTimeout(resolve, 0);
  });
}

type RepositionScrollTarget =
  | { type: "node"; id: number }
  | { type: "group"; id: number; subgraphId: string | null }
  | { type: "subgraph"; id: string };
let addNodeModalRequestId = 0;
let editContainerLabelRequestId = 0;

function buildLayoutForWorkflow(
  workflow: Workflow,
  hiddenItems: Record<string, boolean>,
): MobileLayout {
  return buildDefaultLayout(
    orderNodesForMobile(workflow),
    workflow,
    hiddenItems,
  );
}


// Per-node UI state that we want to preserve
interface SavedNodeState {
  mode?: number; // bypass state
  flags?: { collapsed?: boolean };
  widgets_values?: unknown[] | Record<string, unknown>;
}

// Per-workflow saved state
interface SavedWorkflowState {
  nodes: Record<number, SavedNodeState>;
  seedModes: Record<number, SeedMode>;
  collapsedItems?: Record<string, boolean>;
  hiddenItems?: Record<string, boolean>;
  bookmarkedItems?: string[];
}

// Node output images from execution
interface NodeOutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

// Output of an Image Comparer node: the two sides to overlay (`a` vs `b`).
export interface NodeComparerOutput {
  a: NodeOutputImage[];
  b: NodeOutputImage[];
}

// Track where the workflow was loaded from for reload functionality
export type WorkflowSource = (
  | { type: "user"; filename: string }
  | { type: "history"; promptId: string }
  | { type: "template"; moduleName: string; templateName: string }
  | { type: "file"; filePath: string; assetSource: "output" | "input" | "temp" }
  | { type: "other" }
) & { hidden?: boolean };

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

function workflowDisplayName(filename: string): string {
  const basename = filename.includes("/")
    ? filename.substring(filename.lastIndexOf("/") + 1)
    : filename;
  return basename.replace(/\.json$/, "");
}

function queueWorkflowLabel(
  filename: string | null,
  source: WorkflowSource | null,
): string {
  if (filename) return workflowDisplayName(filename);
  if (source?.type === "template") return source.templateName;
  return "Untitled";
}

// The flat store fields that constitute a single session's state. Everything in
// the store NOT in this list is global (shared across all tabs): nodeTypes,
// savedWorkflowStates, *DurationStats, connectionButtonsVisible, search/modal
// request state, and the session-registry fields themselves.
const SESSION_STATE_FIELDS = [
  "workflowSource",
  "workflow",
  "originalWorkflow",
  "diffBaseWorkflow",
  "lastEnqueuedWorkflow",
  "scopeStack",
  "currentFilename",
  "currentWorkflowKey",
  "isExecuting",
  "executingNodeId",
  "executingNodeHierarchicalKey",
  "executingNodePath",
  "executingPromptId",
  "progress",
  "expandedNodeIdMap",
  "expandedNodePathMap",
  "executionStartTime",
  "currentNodeStartTime",
  "nodeOutputs",
  "nodeComparerOutputs",
  "nodeTextOutputs",
  "latentPreviews",
  "promptOutputs",
  "runCount",
  "isStopping",
  "workflowLoadedAt",
  "connectionHighlightModes",
  "collapsedItems",
  "hiddenItems",
  "itemKeyByPointer",
  "pointerByHierarchicalKey",
  "mobileLayout",
] as const;

type SessionStateField = (typeof SESSION_STATE_FIELDS)[number];

// A parked session's serialized state. Seed maps come from the seed store
// (which always mirrors the *active* session) and are folded in here on park.
type WorkflowSessionSnapshot = Pick<WorkflowState, SessionStateField> & {
  seedModes: Record<number, SeedMode>;
  seedLastValues: Record<number, number | null>;
};

// Lightweight per-tab descriptor kept in the ordered `sessions` list.
interface WorkflowSessionMeta {
  id: string;
}

// A deferred loadWorkflow call, parked while the user picks which open tab to
// close (when MAX_WORKFLOW_SESSIONS is already reached).
interface PendingWorkflowOpen {
  workflow: Workflow;
  filename?: string;
  options?: LoadWorkflowOptions;
}

interface LoadWorkflowOptions {
  fresh?: boolean;
  source?: WorkflowSource;
  replaceActive?: boolean;
  navigate?: boolean;
  filePrefixAliasesResolved?: boolean;
}

// The workflow-content fields that both `unloadWorkflow` and the
// active-session-empty branch of `closeSession` reset to their empty defaults.
// Centralized so the two resets can't drift (a field added to one but not the
// other). Returns a fresh object each call (mobileLayout must not be shared).
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
    result[id] = { ...snapshot, latentPreviews: {} };
  }
  return result;
}

let sessionIdCounter = 0;
function generateSessionId(): string {
  sessionIdCounter += 1;
  return `wf-${Date.now().toString(36)}-${sessionIdCounter.toString(36)}`;
}

interface WorkflowState {
  // Workflow source tracking for reload functionality
  workflowSource: WorkflowSource | null;

  // Workflow data
  workflow: Workflow | null;
  originalWorkflow: Workflow | null; // For dirty check
  // Per-session baselines for queue-item diffs (see queueWorkflow): the
  // workflow to diff the next enqueue against, and the last enqueued snapshot.
  diffBaseWorkflow: Workflow | null;
  lastEnqueuedWorkflow: Workflow | null;

  // Scope navigation stack; [{ type: 'root' }] when at the top level
  scopeStack: ScopeFrame[];
  currentFilename: string | null;
  currentWorkflowKey: string | null;
  nodeTypes: NodeTypes | null;
  isLoading: boolean;

  // Per-workflow saved states (keyed by deterministic workflow cache key)
  savedWorkflowStates: Record<string, SavedWorkflowState>;

  // Execution state
  isExecuting: boolean;
  executingNodeId: string | null;
  executingNodeHierarchicalKey: string | null;
  executingNodePath: string | null;
  executingPromptId: string | null; // Track the ID of the prompt being executed
  progress: number;
  // Maps hierarchical prompt keys (e.g. "50:7") to canonical itemKeys for WS message routing
  expandedNodeIdMap: Record<string, string>;
  // Maps WS node identifiers (expanded numeric IDs and prompt keys) to
  // hierarchical prompt keys (e.g. "50:7") for scope-aware execution highlighting.
  expandedNodePathMap: Record<string, string>;
  executionStartTime: number | null;
  currentNodeStartTime: number | null;
  nodeDurationStats: Record<string, { avgMs: number; count: number }>;
  workflowDurationStats: Record<string, { avgMs: number; count: number }>;

  // Node output images (keyed by node ID)
  nodeOutputs: Record<string, NodeOutputImage[]>;
  // Image-comparer A/B outputs (keyed by node ID)
  nodeComparerOutputs: Record<string, NodeComparerOutput>;
  // Node text output previews (keyed by node ID)
  nodeTextOutputs: Record<string, string>;
  // Prompt output images (keyed by prompt ID)
  promptOutputs: Record<string, HistoryOutputImage[]>;
  runCount: number;
  infiniteLoop: boolean;
  // True when the user just armed infinite mode but hasn't started a run yet.
  // Arming must NOT auto-start generation (that's the Run button's job); this
  // flag suppresses the websocket idle-resume driver until a run goes live. It
  // is intentionally NOT persisted, so a reload that restores an actively-running
  // loop still auto-resumes.
  infiniteLoopAwaitingRun: boolean;
  isStopping: boolean;
  // Session id currently being saved to disk (drives the tab's save spinner).
  savingSessionId: string | null;
  followQueue: boolean;
  workflowLoadedAt: number;

  // Multi-workflow sessions ("tabs"). The active session's state lives in the
  // flat fields above; other open sessions are snapshotted in parkedSessions.
  sessions: WorkflowSessionMeta[];
  activeSessionId: string | null;
  parkedSessions: Record<string, WorkflowSessionSnapshot>;
  // The single session (if any) currently in infinite-generation mode. Only one
  // session loops at a time; switching tabs does not move it.
  infiniteLoopSessionId: string | null;
  // Maps an enqueued ComfyUI prompt_id to the session that submitted it, so
  // websocket/queue events route to the owning session.
  promptToSession: Record<string, string>;
  // Per-session "queue submit in flight" flags (active session also mirrors the
  // flat isLoading). Guards against double re-enqueue for parked infinite loops.
  isLoadingBySession: Record<string, boolean>;
  // Signature of the last prompt each session submitted to ComfyUI. Used by the
  // infinite-loop safety check to detect a stuck loop (identical prompt re-sent,
  // e.g. a fixed seed). Transient — not persisted.
  lastPromptSignatureBySession: Record<string, string>;
  // Set when a load is deferred because MAX_WORKFLOW_SESSIONS is reached; the UI
  // prompts the user to pick a tab to close, then resolves/cancels.
  closeForNewWorkflowRequest: PendingWorkflowOpen | null;
  connectionHighlightModes: Record<
    HierarchicalKey,
    "off" | "inputs" | "outputs" | "both"
  >;
  connectionButtonsVisible: boolean;
  searchQuery: string;
  searchOpen: boolean;
  addNodeModalRequest: {
    id: number;
    groupId: number | null;
    subgraphId: string | null;
  } | null;
  editContainerLabelRequest: {
    id: number;
    itemKey: HierarchicalKey;
    initialValue?: string;
  } | null;

  // Collapse/visibility state
  collapsedItems: Record<string, boolean>;
  hiddenItems: Record<string, boolean>;
  itemKeyByPointer: Record<string, HierarchicalKey>;
  pointerByHierarchicalKey: Record<HierarchicalKey, string>;

  // Actions
  deleteNode: (itemKey: HierarchicalKey, reconnect: boolean) => void;
  // Duplicate a node (or subgraph placeholder): copies values + incoming
  // connections, leaves outgoing connections blank. Returns the new node ID.
  duplicateNode: (itemKey: HierarchicalKey) => number | null;
  connectNodes: (
    srcHierarchicalKey: HierarchicalKey,
    srcSlot: number,
    tgtHierarchicalKey: HierarchicalKey,
    tgtSlot: number,
    type: string,
  ) => void;
  disconnectInput: (itemKey: HierarchicalKey, inputIndex: number) => void;
  addNode: (
    nodeType: string,
    options?: {
      nearNodeHierarchicalKey?: HierarchicalKey;
      inGroupId?: number;
      inSubgraphId?: string;
    },
  ) => number | null;
  addGroupNearNode: (nearNodeHierarchicalKey?: HierarchicalKey | null) => HierarchicalKey | null;
  addNodeAndConnect: (
    nodeType: string,
    targetHierarchicalKey: HierarchicalKey,
    targetInputIndex: number,
  ) => number | null;
  mobileLayout: MobileLayout;
  setMobileLayout: (layout: MobileLayout) => void;
  commitRepositionLayout: (layout: MobileLayout) => void;
  loadWorkflow: (
    workflow: Workflow,
    filename?: string,
    options?: LoadWorkflowOptions,
  ) => void;
  unloadWorkflow: () => void;

  // Tab management
  switchToSession: (id: string) => void;
  closeSession: (id: string) => void;
  resolveCloseForNewWorkflow: (closeId: string) => void;
  cancelCloseForNewWorkflow: () => void;
  setSavedWorkflow: (workflow: Workflow, filename: string) => void;
  updateNodeWidget: (
    itemKey: HierarchicalKey,
    widgetIndex: number,
    value: unknown,
    widgetName?: string,
  ) => void;
  updateNodeWidgets: (
    itemKey: HierarchicalKey,
    updates: Record<number, unknown>,
  ) => void;
  updateSubgraphInnerNodeWidget: (
    subgraphId: string,
    innerNodeId: number,
    innerWidgetIndex: number,
    value: unknown,
  ) => void;
  updateNodeProperties: (
    itemKey: HierarchicalKey,
    properties: Record<string, unknown>,
  ) => void;
  updateNodeTitle: (itemKey: HierarchicalKey, title: string | null) => void;
  toggleBypass: (itemKey: HierarchicalKey) => void;
  scrollToNode: (
    itemKey: HierarchicalKey,
    label?: string,
    // DOM id of a connection button to flash in sync with the node pulse.
    flashConnectionDomId?: string | null,
  ) => void;
  setNodeTypes: (types: NodeTypes) => void;
  // Splice a freshly-added input file into every image-upload combo's option
  // list, so it resolves as a real combo choice without refetching object_info.
  addInputComboOption: (value: string) => void;
  setExecutionState: (
    executing: boolean,
    itemKey: HierarchicalKey | null,
    promptId: string | null,
    progress: number,
    executingNodePath?: string | null,
    sessionId?: string | null,
  ) => void;
  queueWorkflow: (
    count: number,
    sessionId?: string | null,
    isInfiniteReEnqueue?: boolean,
  ) => Promise<void>;
  saveCurrentWorkflowState: () => void;
  setNodeOutput: (
    itemKey: HierarchicalKey,
    images: NodeOutputImage[],
    sessionId?: string | null,
  ) => void;
  setNodeComparerOutput: (
    itemKey: HierarchicalKey,
    output: NodeComparerOutput,
    sessionId?: string | null,
  ) => void;
  setNodeTextOutput: (
    itemKey: HierarchicalKey,
    text: string,
    sessionId?: string | null,
  ) => void;
  clearNodeOutputs: () => void;
  latentPreviews: Record<string, string>;
  setLatentPreview: (url: string, itemKey: string | null) => void;
  clearAllLatentPreviews: () => void;
  addPromptOutputs: (
    promptId: string,
    images: HistoryOutputImage[],
    sessionId?: string | null,
  ) => void;
  clearPromptOutputs: (promptId?: string, sessionId?: string | null) => void;
  setRunCount: (count: number) => void;
  setInfiniteLoop: (val: boolean) => void;
  setIsStopping: (val: boolean) => void;
  setSavingSessionId: (id: string | null) => void;
  setFollowQueue: (followQueue: boolean) => void;
  cycleConnectionHighlight: (itemKey: HierarchicalKey) => void;
  setConnectionHighlightMode: (
    itemKey: HierarchicalKey,
    mode: "off" | "inputs" | "outputs" | "both",
  ) => void;
  toggleConnectionButtonsVisible: () => void;
  setItemHidden: (itemKey: HierarchicalKey, hidden: boolean) => void;
  revealNodeWithParents: (itemKey: HierarchicalKey) => void;
  showAllHiddenNodes: () => void;

  setItemCollapsed: (itemKey: HierarchicalKey, collapsed: boolean) => void;
  bypassAllInContainer: (itemKey: HierarchicalKey, bypass: boolean) => void;

  deleteContainer: (
    itemKey: HierarchicalKey,
    options?: { deleteNodes?: boolean },
  ) => void;

  updateContainerTitle: (itemKey: HierarchicalKey, title: string) => void;
  updateWorkflowItemColor: (itemKey: HierarchicalKey, color: string) => void;

  setSearchQuery: (query: string) => void;
  setSearchOpen: (open: boolean) => void;
  requestAddNodeModal: (options?: {
    groupId?: number | null;
    subgraphId?: string | null;
  }) => void;
  clearAddNodeModalRequest: () => void;
  clearEditContainerLabelRequest: () => void;
  prepareRepositionScrollTarget: (target: RepositionScrollTarget) => void;
  updateWorkflowDuration: (signature: string, durationMs: number) => void;
  clearWorkflowCache: () => void;
  ensureHierarchicalKeysAndRepair: () => boolean;
  applyControlAfterGenerate: (sessionId?: string | null) => void;

  // Scope navigation
  enterSubgraph: (placeholderNodeId: number) => void;
  exitSubgraph: () => void;
  exitToRoot: () => void;
  /** Pop the scope stack to exactly `depth` frames (1 = root). No-op if already at or above target. */
  exitToDepth: (depth: number) => void;
  navigateToSubgraphTrail: (subgraphIds: string[]) => boolean;
}


interface LayoutPathToTarget {
  groupKeys: string[];
  subgraphIds: string[];
}

function findPathToRepositionTarget(
  mobileLayout: MobileLayout,
  target: RepositionScrollTarget,
): LayoutPathToTarget | null {
  const path = findLayoutPath(mobileLayout, ({ ref, currentSubgraphId }) => {
    if (ref.type === "node" && target.type === "node") {
      return ref.id === target.id;
    }
    if (ref.type === "group" && target.type === "group") {
      return (
        target.id === ref.id &&
        (target.subgraphId ?? null) === currentSubgraphId
      );
    }
    if (ref.type === "subgraph" && target.type === "subgraph") {
      return target.id === ref.id;
    }
    return false;
  });
  if (!path) return null;
  return {
    groupKeys: path.groupKeys,
    subgraphIds: path.subgraphIds,
  };
}



function removeNodesFromWorkflow(
  workflow: Workflow,
  nodesToRemove: ScopedNodeIdentity[],
): Workflow {
  if (nodesToRemove.length === 0) return workflow;

  const deduped = dedupeScopedNodeIdentities(nodesToRemove);
  const rootNodeIdsToRemove = new Set<number>();
  const subgraphNodeIdsToRemove = new Map<string, Set<number>>();
  for (const node of deduped) {
    if (node.subgraphId == null) {
      rootNodeIdsToRemove.add(node.nodeId);
      continue;
    }
    const scoped = subgraphNodeIdsToRemove.get(node.subgraphId) ?? new Set<number>();
    scoped.add(node.nodeId);
    subgraphNodeIdsToRemove.set(node.subgraphId, scoped);
  }

  const removeNodeIdsFromScope = <
    TLink extends WorkflowLink | WorkflowSubgraphLink,
  >(
    scopeNodes: WorkflowNode[],
    scopeLinks: TLink[],
    nodeIdsToRemoveInScope: Set<number>,
  ): { nodes: WorkflowNode[]; links: TLink[]; changed: boolean } => {
    if (nodeIdsToRemoveInScope.size === 0) {
      return { nodes: scopeNodes, links: scopeLinks, changed: false };
    }

    const linksToRemove = new Set<number>();
    for (const link of scopeLinks) {
      const originId = Array.isArray(link) ? link[1] : link.origin_id;
      const targetId = Array.isArray(link) ? link[3] : link.target_id;
      if (nodeIdsToRemoveInScope.has(originId) || nodeIdsToRemoveInScope.has(targetId)) {
        linksToRemove.add(Array.isArray(link) ? link[0] : link.id);
      }
    }

    const nextLinks = scopeLinks.filter((link) => {
      const linkId = Array.isArray(link) ? link[0] : link.id;
      return !linksToRemove.has(linkId);
    });

    const nextNodes = scopeNodes
      .filter((node) => !nodeIdsToRemoveInScope.has(node.id))
      .map((node) => {
        const nextInputs = (node.inputs ?? []).map((input) =>
          input.link != null && linksToRemove.has(input.link)
            ? { ...input, link: null }
            : input,
        );
        const nextOutputs = (node.outputs ?? []).map((output) => {
          const retained = (output.links ?? []).filter(
            (linkId) => !linksToRemove.has(linkId),
          );
          return {
            ...output,
            links: retained.length > 0 ? retained : null,
          };
        });
        return {
          ...node,
          inputs: nextInputs,
          outputs: nextOutputs,
        };
      });

    const changed =
      nextLinks.length !== scopeLinks.length ||
      nextNodes.length !== scopeNodes.length ||
      nextNodes.some((node, index) => node !== scopeNodes[index]);
    return { nodes: nextNodes, links: nextLinks, changed };
  };

  const rootResult = removeNodeIdsFromScope(
    workflow.nodes ?? [],
    workflow.links ?? [],
    rootNodeIdsToRemove,
  );

  const currentSubgraphs = workflow.definitions?.subgraphs ?? [];
  let subgraphsChanged = false;
  const nextSubgraphs = currentSubgraphs.map((subgraph) => {
    const idsToRemove = subgraphNodeIdsToRemove.get(subgraph.id);
    if (!idsToRemove || idsToRemove.size === 0) return subgraph;
    const scopedResult = removeNodeIdsFromScope(
      subgraph.nodes ?? [],
      subgraph.links ?? [],
      idsToRemove,
    );
    if (!scopedResult.changed) return subgraph;
    subgraphsChanged = true;
    return {
      ...subgraph,
      nodes: scopedResult.nodes,
      links: scopedResult.links,
    };
  });

  if (!rootResult.changed && !subgraphsChanged) {
    return workflow;
  }

  return {
    ...workflow,
    ...(rootResult.changed
      ? { nodes: rootResult.nodes, links: rootResult.links }
      : {}),
    ...(subgraphsChanged
      ? {
          definitions: {
            ...(workflow.definitions ?? {}),
            subgraphs: nextSubgraphs,
          },
        }
      : {}),
  };
}

function updateNodeWidgetValues(
  node: WorkflowNode,
  widgetIndex: number,
  value: unknown,
  widgetName?: string,
): WorkflowNode {
  if (!Array.isArray(node.widgets_values)) {
    const nextValues = { ...(node.widgets_values || {}) } as Record<
      string,
      unknown
    >;
    if (widgetName) {
      nextValues[widgetName] = value;
      if (
        node.type === "VHS_VideoCombine" &&
        widgetName === "save_image" &&
        "save_output" in nextValues
      ) {
        nextValues.save_output = value;
      }
    } else if (widgetIndex >= 0) {
      nextValues[String(widgetIndex)] = value;
    }
    return { ...node, widgets_values: nextValues };
  }

  let newWidgetValues = [...node.widgets_values];
  if (widgetIndex >= newWidgetValues.length) {
    newWidgetValues.push(value);
  } else {
    newWidgetValues[widgetIndex] = value;
  }

  if (isPowerLoraLoaderNodeType(node.type)) {
    newWidgetValues = newWidgetValues.filter((v) => v !== null);
  }

  return { ...node, widgets_values: newWidgetValues };
}

function updateNodeWidgetsValues(
  node: WorkflowNode,
  updates: Record<number, unknown>,
): WorkflowNode {
  if (!Array.isArray(node.widgets_values)) {
    return node;
  }
  const newWidgetValues = [...node.widgets_values];
  for (const [idxStr, value] of Object.entries(updates)) {
    const idx = parseInt(idxStr, 10);
    newWidgetValues[idx] = value;
  }
  return { ...node, widgets_values: newWidgetValues };
}

function inferSeedMode(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  node: WorkflowNode,
): SeedModeType {
  const validModes = ["fixed", "randomize", "increment", "decrement"];
  if (Array.isArray(node.widgets_values)) {
    const modeValue = node.widgets_values.find(
      (value) =>
        typeof value === "string" && validModes.includes(value.toLowerCase()),
    );
    if (typeof modeValue === "string") {
      const lowered = modeValue.toLowerCase();
      if (validModes.includes(lowered)) {
        return lowered as SeedMode;
      }
    }
  }

  const seedIndex = findSeedWidgetIndex(workflow, nodeTypes, node);
  if (seedIndex !== null && Array.isArray(node.widgets_values)) {
    const seedValue = Number(node.widgets_values[seedIndex]);
    const specialMode = getSpecialSeedMode(seedValue);
    if (specialMode) {
      return specialMode;
    }
    const outputs = node.outputs ?? [];
    const hasSeedOutput = outputs.some(
      (output) =>
        String(output.name || "")
          .toLowerCase()
          .includes("seed") &&
        String(output.type || "")
          .toUpperCase()
          .includes("INT"),
    );
    const trailingWidgets = node.widgets_values.slice(seedIndex + 1);
    const hasEmptyTrailingWidgets =
      trailingWidgets.length > 0 &&
      trailingWidgets.every(
        (value) => value === "" || value === null || value === undefined,
      );
    const hasSeedRangeProps =
      node.properties &&
      ("randomMin" in node.properties || "randomMax" in node.properties);
    if (hasSeedOutput && hasEmptyTrailingWidgets && hasSeedRangeProps) {
      return "randomize";
    }
  }

  return "fixed";
}

// Derive seed modes for every root + inner-subgraph node that has a seed widget.
function deriveSeedModes(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
): Record<number, SeedMode> {
  const seedModes: Record<number, SeedMode> = {};
  if (!nodeTypes) return seedModes;
  const allNodesForSeed = collectAllWorkflowNodes(workflow);
  for (const node of allNodesForSeed) {
    const seedWidgetIndex = findSeedWidgetIndex(workflow, nodeTypes, node);
    if (seedWidgetIndex !== null) {
      seedModes[node.id] = inferSeedMode(workflow, nodeTypes, node);
    }
  }
  return seedModes;
}

function collectWorkflowLoadErrors(
  workflow: Workflow,
  nodeTypes: NodeTypes,
): Record<string, NodeError[]> {
  const errors: Record<string, NodeError[]> = {};

  for (const node of workflow.nodes) {
    if (node.mode === 4) continue;

    const typeDef = nodeTypes[node.type];
    if (!typeDef?.input) continue;

    const requiredOrder =
      typeDef.input_order?.required ||
      Object.keys(typeDef.input.required || {});
    const optionalOrder =
      typeDef.input_order?.optional ||
      Object.keys(typeDef.input.optional || {});
    const orderedInputs = [...requiredOrder, ...optionalOrder];

    for (const name of orderedInputs) {
      const inputDef =
        typeDef.input.required?.[name] || typeDef.input.optional?.[name];
      if (!inputDef) continue;

      const [typeOrOptions] = inputDef;
      if (!Array.isArray(typeOrOptions)) continue;
      if (typeOrOptions.length === 0) continue;

      const inputEntry = node.inputs.find((input) => input.name === name);
      if (inputEntry?.link != null) continue;

      const widgetIndex = getWidgetIndexForInput(
        workflow,
        nodeTypes,
        node,
        name,
      );
      if (widgetIndex === null) continue;

      const rawValue = getWidgetValue(node, name, widgetIndex);
      if (rawValue === undefined || rawValue === null) continue;

      const resolved = resolveComboOption(rawValue, typeOrOptions);
      const normalized = normalizeWidgetValue(rawValue, typeOrOptions, {
        comboIndexToValue: true,
      });
      const normalizedString = String(normalized);
      const normalizedBase =
        normalizedString.split(/[\\/]/).pop() ?? normalizedString;
      const hasMatch =
        resolved !== undefined ||
        typeOrOptions.some((opt) => {
          const optString = String(opt);
          return optString === normalizedString || optString === normalizedBase;
        });

      if (!hasMatch) {
        const nodeId = String(node.id);
        if (!errors[nodeId]) {
          errors[nodeId] = [];
        }
        errors[nodeId].push({
          type: "workflow_load",
          message: `Missing value: ${normalizedString}`,
          details: "Not found on server.",
          inputName: name,
        });
      }
    }
  }

  return errors;
}

function normalizeWorkflowComboValues(
  workflow: Workflow,
  nodeTypes: NodeTypes
): { workflow: Workflow; changed: boolean } {
  let changed = false;

  const nodes = workflow.nodes.map((node) => {
    if (!Array.isArray(node.widgets_values)) return node;
    const typeDef = nodeTypes[node.type];
    if (!typeDef?.input) return node;

    const requiredOrder = typeDef.input_order?.required || Object.keys(typeDef.input.required || {});
    const optionalOrder = typeDef.input_order?.optional || Object.keys(typeDef.input.optional || {});
    const orderedInputs = [...requiredOrder, ...optionalOrder];
    let nextValues: unknown[] | null = null;

    for (const name of orderedInputs) {
      const inputDef = typeDef.input.required?.[name] || typeDef.input.optional?.[name];
      if (!inputDef) continue;
      const [typeOrOptions] = inputDef;
      if (!Array.isArray(typeOrOptions) || typeOrOptions.length === 0) continue;

      const inputEntry = node.inputs.find((input) => input.name === name);
      if (inputEntry?.link != null) continue;

      const widgetIndex = getWidgetIndexForInput(workflow, nodeTypes, node, name);
      if (widgetIndex === null) continue;
      if (widgetIndex < 0 || widgetIndex >= node.widgets_values.length) continue;

      const rawValue = getWidgetValue(node, name, widgetIndex);
      if (rawValue === undefined || rawValue === null) continue;

      const resolved = resolveComboOption(rawValue, typeOrOptions);
      if (resolved === undefined || resolved === rawValue) continue;

      if (!nextValues) {
        nextValues = [...node.widgets_values];
      }
      nextValues[widgetIndex] = resolved;
      changed = true;
    }

    if (!nextValues) return node;
    return { ...node, widgets_values: nextValues };
  });

  if (!changed) {
    return { workflow, changed: false };
  }

  return {
    workflow: { ...workflow, nodes },
    changed: true
  };
}

// Fields a session-shaped object must expose for rehydration normalization.
// Both the active session (flat store fields) and each parked snapshot match.
type SessionNormalizable = {
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

export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set, get) => {
      const applyNodeErrors = (errors: Record<string, NodeError[]>) => {
        const { hiddenItems, workflow, itemKeyByPointer, expandedNodeIdMap } = get();
        if (!workflow) {
          useWorkflowErrorsStore.getState().setNodeErrors(errors);
          return;
        }
        const errorNodeIds = Object.keys(errors);

        const resolveErrorNodeHierarchicalKeys = (id: string): string[] => {
          // Try direct numeric match first (root nodes)
          const nodeId = Number(id);
          if (Number.isFinite(nodeId)) {
            const keys = collectNodeHierarchicalKeys(workflow, itemKeyByPointer, nodeId);
            if (keys.length > 0) return keys;
          }
          // Fallback: hierarchical prompt key lookup (subgraph inner nodes)
          const mappedKey = expandedNodeIdMap[id];
          return mappedKey ? [mappedKey] : [];
        };

        const nodesToUnhide = errorNodeIds.filter((id) => {
          return resolveErrorNodeHierarchicalKeys(id).some(
            (itemKey) => Boolean(hiddenItems[itemKey]),
          );
        });
        if (nodesToUnhide.length > 0) {
          const newHiddenNodes = { ...hiddenItems };
          for (const id of nodesToUnhide) {
            for (const itemKey of resolveErrorNodeHierarchicalKeys(id)) {
              delete newHiddenNodes[itemKey];
            }
          }
          set({ hiddenItems: newHiddenNodes });
        }
        useWorkflowErrorsStore.getState().setNodeErrors(errors);
      };

      const deleteNode: WorkflowState["deleteNode"] = (
        itemKey,
        reconnect,
      ) => {
        const {
          workflow,
          hiddenItems,
          connectionHighlightModes,
          mobileLayout,
          itemKeyByPointer,
          pointerByHierarchicalKey,
        } = get();
        if (!workflow) return;

        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!node) return;
        const nodeId = node.id;
        const subgraphId = scope.subgraphId;

        const currentLinks = scope.links;

        const linksToRemove = new Set<number>();
        const incomingLinks = currentLinks.filter((link) => {
          const isIncoming = getLinkTargetId(link) === nodeId;
          if (isIncoming) linksToRemove.add(getLinkId(link));
          return isIncoming;
        });
        const outgoingLinks = currentLinks.filter((link) => {
          const isOutgoing = getLinkOriginId(link) === nodeId;
          if (isOutgoing) linksToRemove.add(getLinkId(link));
          return isOutgoing;
        });

        let nextLastLinkId = scope.linkIdBase;
        const bridgeInputLinks = new Map<string, number>();
        const bridgeOutputLinks = new Map<string, number[]>();
        const bridgeLinks: (import('@/api/types').WorkflowLink | import('@/api/types').WorkflowSubgraphLink)[] = [];

        if (reconnect) {
          for (const outLink of outgoingLinks) {
            const outTargetNodeId = getLinkTargetId(outLink);
            const outTargetSlot = getLinkTargetSlot(outLink);
            const outType = getLinkType(outLink);
            const sourceLink = incomingLinks.find((inLink) =>
              areTypesCompatible(getLinkType(inLink), outType),
            );
            if (!sourceLink) continue;

            const inSourceNodeId = getLinkOriginId(sourceLink);
            const inSourceSlot = getLinkOriginSlot(sourceLink);
            nextLastLinkId += 1;
            const bridgeLink = makeScopeLink(
              nextLastLinkId,
              inSourceNodeId,
              inSourceSlot,
              outTargetNodeId,
              outTargetSlot,
              outType,
              subgraphId,
            );
            bridgeLinks.push(bridgeLink);

            const targetKey = `${outTargetNodeId}:${outTargetSlot}`;
            bridgeInputLinks.set(targetKey, nextLastLinkId);

            const sourceKey = `${inSourceNodeId}:${inSourceSlot}`;
            const existing = bridgeOutputLinks.get(sourceKey) ?? [];
            existing.push(nextLastLinkId);
            bridgeOutputLinks.set(sourceKey, existing);
          }
        }

        const newLinks = [
          ...currentLinks.filter((link) => !linksToRemove.has(getLinkId(link))),
          ...bridgeLinks,
        ];

        const newNodes = scope.nodes
          .filter((n) => n.id !== nodeId)
          .map((n) => {
            const nextInputs = n.inputs.map((input, index) => {
              const key = `${n.id}:${index}`;
              const bridgeInputLinkId = bridgeInputLinks.get(key);
              if (bridgeInputLinkId != null) {
                return { ...input, link: bridgeInputLinkId };
              }
              if (input.link != null && linksToRemove.has(input.link)) {
                return { ...input, link: null };
              }
              return input;
            });

            const nextOutputs = n.outputs.map((output, index) => {
              const existingLinks = output.links ?? [];
              const retainedLinks = existingLinks.filter(
                (linkId) => !linksToRemove.has(linkId),
              );
              const sourceKey = `${n.id}:${index}`;
              const appendedLinks = bridgeOutputLinks.get(sourceKey) ?? [];
              const mergedLinks = [...retainedLinks, ...appendedLinks];
              return {
                ...output,
                links: mergedLinks.length > 0 ? mergedLinks : null,
              };
            });

            return { ...n, inputs: nextInputs, outputs: nextOutputs };
          });

        // Clean up UI state
        const nextHiddenNodes = { ...hiddenItems };
        const nodeHierarchicalKeys = collectNodeHierarchicalKeys(
          workflow,
          itemKeyByPointer,
          nodeId,
          subgraphId,
        );
        for (const itemKey of nodeHierarchicalKeys) {
          delete nextHiddenNodes[itemKey];
        }
        for (const legacyPointer of collectNodeStateKeys(
          workflow,
          nodeId,
          subgraphId,
        )) {
          delete nextHiddenNodes[legacyPointer];
        }

        const nextHighlightModes = { ...connectionHighlightModes };
        for (const itemKey of nodeHierarchicalKeys) {
          delete nextHighlightModes[itemKey];
        }

        // Clean up mobile layout
        const nextMobileLayout = removeNodeFromLayout(
          mobileLayout,
          nodeId,
          subgraphId,
        );
        const reconciled = reconcilePointerRegistry(
          nextMobileLayout,
          itemKeyByPointer,
          pointerByHierarchicalKey,
        );
        const patchedWorkflow = scope.applyPatch(workflow, {
          nodes: newNodes,
          links: scope.subgraphId == null
            ? (newLinks as WorkflowLink[])
            : (newLinks as WorkflowSubgraphLink[]),
          last_link_id: nextLastLinkId,
        });
        const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
          patchedWorkflow,
          reconciled.layoutToStable,
        );

        set({
          workflow: nextWorkflowWithHierarchicalKeys,
          hiddenItems: nextHiddenNodes,
          connectionHighlightModes: nextHighlightModes,
          mobileLayout: nextMobileLayout,
          itemKeyByPointer: reconciled.layoutToStable,
          pointerByHierarchicalKey: reconciled.stableToLayout,
        });
      };

      const connectNodes: WorkflowState["connectNodes"] = (
        srcHierarchicalKey,
        srcSlot,
        tgtHierarchicalKey,
        tgtSlot,
        type,
      ) => {
        const { workflow } = get();
        if (!workflow) return;
        // Both endpoints must live in the source key's scope.
        const scope = resolveScopeForHierarchicalKey(workflow, srcHierarchicalKey);

        const srcNode = resolveNodeByHierarchicalKey(scope.nodes, srcHierarchicalKey);
        const tgtNode = resolveNodeByHierarchicalKey(scope.nodes, tgtHierarchicalKey);
        if (!srcNode || !tgtNode) return;
        const srcNodeId = srcNode.id;
        const tgtNodeId = tgtNode.id;

        let newLinks = [...scope.links];
        let nextLastLinkId = scope.linkIdBase;

        // If target input already has a link, remove it first
        const existingLinkId = tgtNode.inputs[tgtSlot]?.link;
        if (existingLinkId != null) {
          newLinks = newLinks.filter((l) => getLinkId(l) !== existingLinkId);
        }

        nextLastLinkId++;
        const newLinkId = nextLastLinkId;
        const newLink = makeScopeLink(newLinkId, srcNodeId, srcSlot, tgtNodeId, tgtSlot, type, scope.subgraphId);
        newLinks.push(newLink);

        const newNodes = scope.nodes.map((n) => {
          if (n.id === tgtNodeId) {
            const newInputs = [...n.inputs];
            newInputs[tgtSlot] = { ...newInputs[tgtSlot], link: newLinkId };
            return { ...n, inputs: newInputs };
          }
          if (n.id === srcNodeId) {
            const newOutputs = [...n.outputs];
            const existingLinks = newOutputs[srcSlot]?.links ?? [];
            const cleanedLinks = existingLinks.filter(
              (id) => id !== existingLinkId,
            );
            const withNewLink = [...cleanedLinks, newLinkId];
            newOutputs[srcSlot] = {
              ...newOutputs[srcSlot],
              links: withNewLink,
            };
            return { ...n, outputs: newOutputs };
          }
          if (existingLinkId != null && n.id !== srcNodeId) {
            const hadLink = n.outputs.some((o) =>
              o.links?.includes(existingLinkId),
            );
            if (hadLink) {
              const newOutputs = n.outputs.map((o) => {
                if (o.links?.includes(existingLinkId)) {
                  const filtered = o.links.filter(
                    (id) => id !== existingLinkId,
                  );
                  return {
                    ...o,
                    links: filtered.length > 0 ? filtered : null,
                  };
                }
                return o;
              });
              return { ...n, outputs: newOutputs };
            }
          }
          return n;
        });

        const nextWorkflow = scope.applyPatch(workflow, {
          nodes: newNodes,
          links: scope.subgraphId == null
            ? (newLinks as WorkflowLink[])
            : (newLinks as WorkflowSubgraphLink[]),
          last_link_id: nextLastLinkId,
        });
        set({
          workflow: nextWorkflow,
        });
      };

      const disconnectInput: WorkflowState["disconnectInput"] = (
        itemKey,
        inputIndex,
      ) => {
        const { workflow } = get();
        if (!workflow) return;
        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!node) return;
        const nodeId = node.id;

        const linkId = node.inputs[inputIndex]?.link;
        if (linkId == null) return;

        const newLinks = scope.links.filter((l) => getLinkId(l) !== linkId);
        const newNodes = scope.nodes.map((n) => {
          if (n.id === nodeId) {
            const newInputs = [...n.inputs];
            newInputs[inputIndex] = { ...newInputs[inputIndex], link: null };
            return { ...n, inputs: newInputs };
          }
          // Clean up source node's output links
          const hadLink = n.outputs.some((o) => o.links?.includes(linkId));
          if (hadLink) {
            const newOutputs = n.outputs.map((o) => {
              if (o.links?.includes(linkId)) {
                const filtered = o.links.filter((id) => id !== linkId);
                return { ...o, links: filtered.length > 0 ? filtered : null };
              }
              return o;
            });
            return { ...n, outputs: newOutputs };
          }
          return n;
        });

        const nextWorkflow = scope.applyPatch(workflow, {
          nodes: newNodes,
          links: scope.subgraphId == null
            ? (newLinks as WorkflowLink[])
            : (newLinks as WorkflowSubgraphLink[]),
        });
        set({
          workflow: nextWorkflow,
        });
      };

      const addNode: WorkflowState["addNode"] = (nodeType, options) => {
        const { workflow, nodeTypes, mobileLayout } = get();
        if (!workflow || !nodeTypes) return null;

        const typeDef = nodeTypes[nodeType];
        if (!typeDef) return null;

        const newId = maxNodeIdAcrossScopes(workflow) + 1;

        // Build inputs from type definition
        const inputs: Array<{ name: string; type: string; link: null }> = [];
        const requiredInputs = typeDef.input?.required ?? {};
        const optionalInputs = typeDef.input?.optional ?? {};
        const requiredOrder =
          typeDef.input_order?.required ?? Object.keys(requiredInputs);
        const optionalOrder =
          typeDef.input_order?.optional ?? Object.keys(optionalInputs);

        for (const name of requiredOrder) {
          const def = requiredInputs[name];
          if (!def) continue;
          const [typeOrOptions] = def;
          // Skip widget inputs (arrays = combo, primitive types = widgets)
          if (Array.isArray(typeOrOptions)) continue;
          const normalized = String(typeOrOptions).toUpperCase();
          if (["INT", "FLOAT", "BOOLEAN", "STRING"].includes(normalized))
            continue;
          inputs.push({ name, type: String(typeOrOptions), link: null });
        }
        for (const name of optionalOrder) {
          const def = optionalInputs[name];
          if (!def) continue;
          const [typeOrOptions] = def;
          if (Array.isArray(typeOrOptions)) continue;
          const normalized = String(typeOrOptions).toUpperCase();
          if (["INT", "FLOAT", "BOOLEAN", "STRING"].includes(normalized))
            continue;
          inputs.push({ name, type: String(typeOrOptions), link: null });
        }

        // Build outputs from type definition
        const outputs = (typeDef.output ?? []).map((type, i) => ({
          name: typeDef.output_name?.[i] ?? type,
          type,
          links: null as number[] | null,
          slot_index: i,
        }));

        // Build default widget values
        const widgetsValues: unknown[] = [];
        for (const name of requiredOrder) {
          const def = requiredInputs[name];
          if (!def) continue;
          const [typeOrOptions, opts] = def;
          if (Array.isArray(typeOrOptions)) {
            widgetsValues.push(typeOrOptions[0] ?? "");
            continue;
          }
          const normalized = String(typeOrOptions).toUpperCase();
          if (normalized === "INT")
            widgetsValues.push((opts as Record<string, unknown>)?.default ?? 0);
          else if (normalized === "FLOAT")
            widgetsValues.push(
              (opts as Record<string, unknown>)?.default ?? 0.0,
            );
          else if (normalized === "STRING")
            widgetsValues.push(
              (opts as Record<string, unknown>)?.default ?? "",
            );
          else if (normalized === "BOOLEAN")
            widgetsValues.push(
              (opts as Record<string, unknown>)?.default ?? false,
            );
        }
        for (const name of optionalOrder) {
          const def = optionalInputs[name];
          if (!def) continue;
          const [typeOrOptions, opts] = def;
          if (Array.isArray(typeOrOptions)) {
            widgetsValues.push(typeOrOptions[0] ?? "");
            continue;
          }
          const normalized = String(typeOrOptions).toUpperCase();
          if (normalized === "INT")
            widgetsValues.push((opts as Record<string, unknown>)?.default ?? 0);
          else if (normalized === "FLOAT")
            widgetsValues.push(
              (opts as Record<string, unknown>)?.default ?? 0.0,
            );
          else if (normalized === "STRING")
            widgetsValues.push(
              (opts as Record<string, unknown>)?.default ?? "",
            );
          else if (normalized === "BOOLEAN")
            widgetsValues.push(
              (opts as Record<string, unknown>)?.default ?? false,
            );
        }

        // Resolve the canonical scope where this node belongs.
        // If inSubgraphId is specified explicitly, use that subgraph's node list;
        // otherwise use the root node list.
        const targetSgId = options?.inSubgraphId ?? null;
        const targetSg = targetSgId
          ? (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === targetSgId)
          : null;
        if (targetSgId && !targetSg) return null; // Unknown subgraph ID
        const scopedNodes: WorkflowNode[] = targetSg ? (targetSg.nodes ?? []) : workflow.nodes;

        // Build a scoped workflow view for position helpers that search workflow.nodes.
        const positionWorkflow = targetSg
          ? { ...workflow, nodes: scopedNodes }
          : workflow;

        // Position near target node or at the bottom of the appropriate scope
        let pos: [number, number] = [0, 0];
        if (options?.nearNodeHierarchicalKey) {
          const nearIdentity = resolveNodeIdentityFromHierarchicalKey(
            positionWorkflow,
            options.nearNodeHierarchicalKey,
            get().pointerByHierarchicalKey,
          );
          if (nearIdentity) {
            pos = getPositionNearNode(positionWorkflow, nearIdentity.nodeId) ?? pos;
          }
        } else if (scopedNodes.length > 0) {
          const maxBottom = Math.max(
            ...scopedNodes.map((n) => n.pos[1] + (n.size?.[1] ?? 100)),
          );
          const minX = Math.min(...scopedNodes.map((n) => n.pos[0]));
          pos = [minX, maxBottom + 80];
        } else {
          pos = getBottomPlacementForScope(workflow, {
            subgraphId: targetSgId,
          });
        }

        if (options?.inGroupId != null) {
          const groups = collectAllWorkflowGroups(workflow);
          const group = groups.find((g) => g.id === options.inGroupId);
          if (group) {
            pos = clampPositionToGroup(pos, group, [200, 100]);
          }
        }

        const newNode: WorkflowNode = {
          id: newId,
          type: nodeType,
          pos,
          size: [200, 100],
          flags: {},
          order: 0,
          mode: 0,
          inputs,
          outputs,
          properties: {},
          widgets_values: widgetsValues,
        };

        // Insert the new node into the correct canonical scope.
        let nextWorkflow: Workflow;
        if (targetSg && targetSgId) {
          const updatedSg = { ...targetSg, nodes: [...scopedNodes, newNode] };
          nextWorkflow = {
            ...workflow,
            last_node_id: newId,
            definitions: {
              ...(workflow.definitions ?? {}),
              subgraphs: (workflow.definitions?.subgraphs ?? []).map((sg) =>
                sg.id === targetSgId ? updatedSg : sg,
              ),
            },
          };
        } else {
          nextWorkflow = {
            ...workflow,
            nodes: [...workflow.nodes, newNode],
            last_node_id: newId,
          };
        }

        const nextMobileLayout = addNodeToLayout(mobileLayout, newId, {
          groupId: options?.inGroupId ?? undefined,
          subgraphId: options?.inSubgraphId ?? undefined,
        });
        const { itemKeyByPointer, pointerByHierarchicalKey } = get();
        const reconciled = reconcilePointerRegistry(
          nextMobileLayout,
          itemKeyByPointer,
          pointerByHierarchicalKey,
        );
        const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
          nextWorkflow,
          reconciled.layoutToStable,
        );

        set({
          workflow: nextWorkflowWithHierarchicalKeys,
          mobileLayout: nextMobileLayout,
          itemKeyByPointer: reconciled.layoutToStable,
          pointerByHierarchicalKey: reconciled.stableToLayout,
        });

        return newId;
      };

      const duplicateNode: WorkflowState["duplicateNode"] = (itemKey) => {
        const { workflow, hiddenItems, itemKeyByPointer, pointerByHierarchicalKey } = get();
        if (!workflow) return null;

        const result = duplicateWorkflowNode(workflow, itemKey);
        if (!result) return null;

        // Rebuild the layout from the new workflow so a duplicated subgraph
        // placeholder is laid out as a subgraph item (not a plain node), then
        // move the copy to sit directly below the original in the list.
        const rebuiltLayout = buildLayoutForWorkflow(
          result.workflow,
          layoutRecordFromPointerRecord(hiddenItems, pointerByHierarchicalKey),
        );
        const nextLayout = placeLayoutItemAfter(
          rebuiltLayout,
          result.newNodeId,
          result.originalNodeId,
        );
        const reconciled = reconcilePointerRegistry(
          nextLayout,
          itemKeyByPointer,
          pointerByHierarchicalKey,
        );
        const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
          result.workflow,
          reconciled.layoutToStable,
        );

        set({
          workflow: nextWorkflowWithHierarchicalKeys,
          mobileLayout: nextLayout,
          itemKeyByPointer: reconciled.layoutToStable,
          pointerByHierarchicalKey: reconciled.stableToLayout,
        });

        return result.newNodeId;
      };

      const addGroupNearNode: WorkflowState["addGroupNearNode"] = (
        nearNodeHierarchicalKey,
      ) => {
        const { workflow, mobileLayout, itemKeyByPointer, pointerByHierarchicalKey } =
          get();
        if (!workflow) return null;

        const nearIdentity = nearNodeHierarchicalKey
          ? resolveNodeIdentityFromHierarchicalKey(
              workflow,
              nearNodeHierarchicalKey,
              pointerByHierarchicalKey,
            )
          : null;
        const targetSubgraphId = nearIdentity?.subgraphId ?? null;
        const subgraphDefs = workflow.definitions?.subgraphs ?? [];
        const targetSubgraph = targetSubgraphId
          ? subgraphDefs.find((subgraph) => subgraph.id === targetSubgraphId)
          : null;
        const groupsInScope = targetSubgraphId
          ? (targetSubgraph?.groups ?? [])
          : (workflow.groups ?? []);
        const maxGroupId = groupsInScope.reduce(
          (maxId, group) => Math.max(maxId, group.id),
          0,
        );
        const newGroupId = maxGroupId + 1;
        const newGroupHierarchicalKey = makeLocationPointer({
          type: "group",
          groupId: newGroupId,
          subgraphId: targetSubgraphId,
        });

        const nearNode = nearIdentity
          ? (() => {
              if (nearIdentity.subgraphId == null) {
                return workflow.nodes.find((n) => n.id === nearIdentity.nodeId) ?? null;
              }
              const sg = subgraphDefs.find((s) => s.id === nearIdentity.subgraphId);
              return (sg?.nodes ?? []).find((n) => n.id === nearIdentity.nodeId) ?? null;
            })()
          : null;
        const basePos = nearNode
          ? [nearNode.pos[0] - 20, nearNode.pos[1] - 24]
          : (() => {
              if (targetSubgraphId != null && targetSubgraph) {
                return getBottomPlacementForScope(workflow, {
                  subgraphId: targetSubgraph.id,
                });
              }
              return getBottomPlacement(workflow);
            })();

        const newGroup: WorkflowGroup = {
          id: newGroupId,
          itemKey: newGroupHierarchicalKey,
          title: "",
          bounding: [Math.round(basePos[0]), Math.round(basePos[1]), 320, 160],
          color: themeColors.brand.blue400,
          font_size: 24,
          flags: {},
        };

        let nextWorkflow: Workflow;
        if (targetSubgraphId) {
          const nextSubgraphs = subgraphDefs.map((subgraph) =>
            subgraph.id === targetSubgraphId
              ? { ...subgraph, groups: [...(subgraph.groups ?? []), newGroup] }
              : subgraph,
          );
          nextWorkflow = {
            ...workflow,
            definitions: {
              ...(workflow.definitions ?? {}),
              subgraphs: nextSubgraphs,
            },
          };
        } else {
          nextWorkflow = {
            ...workflow,
            groups: [...(workflow.groups ?? []), newGroup],
          };
        }

        const getContainerItems = (
          layout: MobileLayout,
          containerId: ContainerId,
        ): ItemRef[] => {
          if (containerId.scope === "root") return layout.root;
          if (containerId.scope === "group") {
            return layout.groups[containerId.groupKey] ?? [];
          }
          return layout.subgraphs[containerId.subgraphId] ?? [];
        };
        const setContainerItems = (
          layout: MobileLayout,
          containerId: ContainerId,
          items: ItemRef[],
        ): MobileLayout => {
          if (containerId.scope === "root") return { ...layout, root: items };
          if (containerId.scope === "group") {
            return {
              ...layout,
              groups: { ...layout.groups, [containerId.groupKey]: items },
            };
          }
          return {
            ...layout,
            subgraphs: { ...layout.subgraphs, [containerId.subgraphId]: items },
          };
        };

        let nextMobileLayout: MobileLayout = {
          ...mobileLayout,
          root: [...mobileLayout.root],
          groups: { ...mobileLayout.groups, [newGroupHierarchicalKey]: [] },
          groupParents: { ...(mobileLayout.groupParents ?? {}) },
          subgraphs: { ...mobileLayout.subgraphs },
          hiddenBlocks: { ...mobileLayout.hiddenBlocks },
        };

        const newGroupRef: ItemRef = {
          type: "group",
          id: newGroupId,
          subgraphId: targetSubgraphId,
          itemKey: newGroupHierarchicalKey,
        };

        let targetContainer: ContainerId = targetSubgraphId
          ? { scope: "subgraph", subgraphId: targetSubgraphId }
          : { scope: "root" };
        let insertionIndex: number | null = null;
        if (nearNode) {
          const nearNodeLocation = findItemInLayout(nextMobileLayout, {
            type: "node",
            id: nearNode.id,
          });
          if (nearNodeLocation) {
            targetContainer = nearNodeLocation.containerId;
            insertionIndex = nearNodeLocation.index + 1;
          }
        }

        const targetItems = [...getContainerItems(nextMobileLayout, targetContainer)];
        const clampedIndex =
          insertionIndex == null
            ? targetItems.length
            : Math.max(0, Math.min(insertionIndex, targetItems.length));
        targetItems.splice(clampedIndex, 0, newGroupRef);
        nextMobileLayout = setContainerItems(
          nextMobileLayout,
          targetContainer,
          targetItems,
        );

        if (targetContainer.scope === "root") {
          nextMobileLayout.groupParents![newGroupHierarchicalKey] = { scope: "root" };
        } else if (targetContainer.scope === "subgraph") {
          nextMobileLayout.groupParents![newGroupHierarchicalKey] = {
            scope: "subgraph",
            subgraphId: targetContainer.subgraphId,
          };
        } else {
          nextMobileLayout.groupParents![newGroupHierarchicalKey] = {
            scope: "group",
            groupKey: targetContainer.groupKey,
          };
        }

        const reconciled = reconcilePointerRegistry(
          nextMobileLayout,
          itemKeyByPointer,
          pointerByHierarchicalKey,
        );
        const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
          nextWorkflow,
          reconciled.layoutToStable,
        );

        set({
          workflow: nextWorkflowWithHierarchicalKeys,
          mobileLayout: nextMobileLayout,
          itemKeyByPointer: reconciled.layoutToStable,
          pointerByHierarchicalKey: reconciled.stableToLayout,
          editContainerLabelRequest: {
            id: ++editContainerLabelRequestId,
            itemKey: newGroupHierarchicalKey,
            initialValue: "",
          },
        });

        return newGroupHierarchicalKey;
      };

      const addNodeAndConnect: WorkflowState["addNodeAndConnect"] = (
        nodeType,
        targetHierarchicalKey,
        targetInputIndex,
      ) => {
        const { workflow, nodeTypes, pointerByHierarchicalKey } = get();
        if (!workflow || !nodeTypes) return null;
        const targetIdentity = resolveNodeIdentityFromHierarchicalKey(
          workflow,
          targetHierarchicalKey,
          pointerByHierarchicalKey,
        );
        if (!targetIdentity) return null;
        const targetNodeId = targetIdentity.nodeId;

        // Resolve the target in its own scope — the key may point inside a subgraph.
        const targetScopeNodes =
          targetIdentity.subgraphId == null
            ? workflow.nodes
            : (workflow.definitions?.subgraphs?.find(
                (sg) => sg.id === targetIdentity.subgraphId,
              )?.nodes ?? []);
        const targetNode = targetScopeNodes.find((n) => n.id === targetNodeId);
        if (!targetNode) return null;

        const targetInput = targetNode.inputs[targetInputIndex];
        if (!targetInput) return null;

        const typeDef = nodeTypes[nodeType];
        if (!typeDef) return null;

        // Find compatible output slot
        const inputType = targetInput.type.toUpperCase();
        const outputIndex = (typeDef.output ?? []).findIndex((outType) =>
          areTypesCompatible(String(outType), inputType),
        );
        if (outputIndex < 0) return null;

        const newId = get().addNode(nodeType, {
          nearNodeHierarchicalKey: targetHierarchicalKey,
          inSubgraphId: targetIdentity.subgraphId ?? undefined,
        });
        if (newId === null) return null;
        const newPointer = makeLocationPointer({
          type: "node",
          nodeId: newId,
          subgraphId: targetIdentity.subgraphId,
        });
        const newHierarchicalKey = get().itemKeyByPointer[newPointer];
        if (!newHierarchicalKey) return null;

        get().connectNodes(
          newHierarchicalKey,
          outputIndex,
          targetHierarchicalKey,
          targetInputIndex,
          targetInput.type,
        );
        return newId;
      };

      // Resolve which session a write targets. Returns null for the active
      // session (write flat fields), or the parked snapshot to mutate.
      const resolveWriteTarget = (
        state: WorkflowState,
        sessionId?: string | null,
      ): WorkflowSessionSnapshot | null => {
        if (
          !sessionId ||
          sessionId === state.activeSessionId ||
          !state.parkedSessions[sessionId]
        ) {
          return null;
        }
        return state.parkedSessions[sessionId];
      };

      // Merge a patch into a parked session snapshot, returning the state slice.
      const patchParkedSession = (
        state: WorkflowState,
        sid: string,
        patch: Partial<WorkflowSessionSnapshot>,
      ): Partial<WorkflowState> => ({
        parkedSessions: {
          ...state.parkedSessions,
          [sid]: { ...state.parkedSessions[sid], ...patch },
        },
      });

      // Resolve the write target (parked snapshot vs flat active state) along
      // with the workflow + pointer maps to use for node identity resolution.
      const resolveWriteContext = (
        state: WorkflowState,
        sessionId?: string | null,
      ): {
        parked: WorkflowSessionSnapshot | null;
        workflow: Workflow | null;
        pointers: Record<string, string>;
      } => {
        const parked = resolveWriteTarget(state, sessionId);
        return {
          parked,
          workflow: parked ? parked.workflow : state.workflow,
          pointers: parked
            ? parked.pointerByHierarchicalKey
            : state.pointerByHierarchicalKey,
        };
      };

      // Resolve a node identity from a hierarchical item key and write a single
      // node-keyed record field, routing to the parked snapshot or flat state.
      // Returns an empty slice when the identity can't be resolved.
      const writeNodeKeyedField = <
        F extends "nodeOutputs" | "nodeComparerOutputs" | "nodeTextOutputs",
      >(
        state: WorkflowState,
        sessionId: string | null | undefined,
        itemKey: string,
        field: F,
        value: WorkflowState[F][string],
      ): Partial<WorkflowState> => {
        const { parked, workflow, pointers } = resolveWriteContext(
          state,
          sessionId,
        );
        const identity = workflow
          ? resolveNodeIdentityFromHierarchicalKey(workflow, itemKey, pointers)
          : null;
        if (!identity) return {};
        const nodeId = String(identity.nodeId);
        if (parked) {
          return patchParkedSession(state, sessionId as string, {
            [field]: { ...parked[field], [nodeId]: value },
          } as Partial<WorkflowSessionSnapshot>);
        }
        return {
          [field]: { ...state[field], [nodeId]: value },
        } as Partial<WorkflowState>;
      };

      const setNodeOutput: WorkflowState["setNodeOutput"] = (
        itemKey,
        images,
        sessionId,
      ) => {
        set((state) =>
          writeNodeKeyedField(state, sessionId, itemKey, "nodeOutputs", images),
        );
      };

      const setNodeComparerOutput: WorkflowState["setNodeComparerOutput"] = (
        itemKey,
        output,
        sessionId,
      ) => {
        set((state) =>
          writeNodeKeyedField(
            state,
            sessionId,
            itemKey,
            "nodeComparerOutputs",
            output,
          ),
        );
      };

      const setNodeTextOutput: WorkflowState["setNodeTextOutput"] = (
        itemKey,
        text,
        sessionId,
      ) => {
        set((state) =>
          writeNodeKeyedField(
            state,
            sessionId,
            itemKey,
            "nodeTextOutputs",
            text,
          ),
        );
      };

      const cycleConnectionHighlight: WorkflowState["cycleConnectionHighlight"] =
        (itemKey) => {
          set((state) => {
            const canonicalHierarchicalKey =
              state.itemKeyByPointer[itemKey] ?? itemKey;
            const current =
              state.connectionHighlightModes[canonicalHierarchicalKey] ?? "off";
            const next =
              current === "off"
                ? "inputs"
                : current === "inputs"
                  ? "outputs"
                  : current === "outputs"
                    ? "both"
                    : "off";
            if (next === "off") {
              const nextModes = { ...state.connectionHighlightModes };
              delete nextModes[canonicalHierarchicalKey];
              return { connectionHighlightModes: nextModes };
            }
            return {
              connectionHighlightModes: { [canonicalHierarchicalKey]: next },
            };
          });
        };

      const setConnectionHighlightMode: WorkflowState["setConnectionHighlightMode"] =
        (itemKey, mode) => {
          set((state) => {
            const canonicalHierarchicalKey =
              state.itemKeyByPointer[itemKey] ?? itemKey;
            if (mode === "off") {
              const nextModes = { ...state.connectionHighlightModes };
              delete nextModes[canonicalHierarchicalKey];
              return { connectionHighlightModes: nextModes };
            }
            return {
              connectionHighlightModes: { [canonicalHierarchicalKey]: mode },
            };
          });
        };

      const setItemHidden: WorkflowState["setItemHidden"] = (
        itemKey,
        hidden,
      ) => {
        if (!itemKey) return;
        set((state) => {
          const canonicalHierarchicalKey =
            state.itemKeyByPointer[itemKey] ?? itemKey;
          const pointerKey = state.pointerByHierarchicalKey[canonicalHierarchicalKey];
          const next = { ...state.hiddenItems };
          if (hidden) {
            next[canonicalHierarchicalKey] = true;
          } else {
            delete next[itemKey];
            delete next[canonicalHierarchicalKey];
            if (pointerKey) delete next[pointerKey];
          }
          return { hiddenItems: next };
        });
      };

      const revealNodeWithParents: WorkflowState["revealNodeWithParents"] = (
        itemKey,
      ) => {
        const { workflow, pointerByHierarchicalKey } = get();
        if (!workflow) return;
        const identity = resolveNodeIdentityFromHierarchicalKey(
          workflow,
          itemKey,
          pointerByHierarchicalKey,
        );
        if (!identity) return;

        const subgraphs = workflow.definitions?.subgraphs ?? [];
        const targetSubgraphId = identity.subgraphId ?? null;

        // Under the canonical model, root nodes are in workflow.nodes and inner nodes in sg.nodes.
        const subgraphById = new Map(subgraphs.map((sg) => [sg.id, sg]));
        const scopedNodes = targetSubgraphId
          ? (subgraphById.get(targetSubgraphId)?.nodes ?? [])
          : workflow.nodes;
        const node = scopedNodes.find((entry) => entry.id === identity.nodeId);
        if (!node) return;

        const parentMap = buildSubgraphParentMap(subgraphs);
        const rootNodes = workflow.nodes;
        const collectParentIds = () => {
          const parents = new Set<number>();
          const stack = [node.id];
          if (targetSubgraphId !== null) {
            const subgraph = subgraphById.get(targetSubgraphId);
            const incoming = new Map<number, number[]>();
            subgraph?.links?.forEach((link) => {
              const list = incoming.get(link.target_id) ?? [];
              list.push(link.origin_id);
              incoming.set(link.target_id, list);
            });
            while (stack.length > 0) {
              const current = stack.pop();
              if (current === undefined) continue;
              const parentList = incoming.get(current) ?? [];
              parentList.forEach((parentId) => {
                if (parents.has(parentId)) return;
                parents.add(parentId);
                stack.push(parentId);
              });
            }
            return parents;
          }
          while (stack.length > 0) {
            const current = stack.pop();
            if (current === undefined) continue;
            const currentNode = workflow.nodes.find(
              (entry) => entry.id === current,
            );
            if (!currentNode) continue;
            currentNode.inputs?.forEach((input, index) => {
              if (input.link === null) return;
              const connected = findConnectedNode(workflow, current, index);
              if (!connected) return;
              const parentId = connected.node.id;
              if (parents.has(parentId)) return;
              parents.add(parentId);
              stack.push(parentId);
            });
          }
          return parents;
        };
        const parentIds = collectParentIds();
        const parentSubgraphId = targetSubgraphId;

        set((state) => {
          const nextHiddenItems = { ...state.hiddenItems };
          for (const itemKey of collectNodeHierarchicalKeys(
            workflow,
            state.itemKeyByPointer,
            identity.nodeId,
            targetSubgraphId,
          )) {
            delete nextHiddenItems[itemKey];
          }
          parentIds.forEach((parentId) => {
            for (const itemKey of collectNodeHierarchicalKeys(
              workflow,
              state.itemKeyByPointer,
              parentId,
              parentSubgraphId,
            )) {
              delete nextHiddenItems[itemKey];
            }
          });
          const nextCollapsedItems = { ...state.collapsedItems };

          const revealGroup = (
            groupId: number | null | undefined,
            subgraphId: string | null = null,
          ) => {
            if (groupId === null || groupId === undefined) return;
            for (const key of collectGroupHierarchicalKeys(
              state.mobileLayout,
              groupId,
              subgraphId,
            )) {
              delete nextHiddenItems[key];
              delete nextCollapsedItems[key];
            }
          };

          const expandSubgraph = (subgraphId: string | null | undefined) => {
            if (!subgraphId) return;
            const key = findSubgraphHierarchicalKey(workflow, subgraphId);
            if (!key) return;
            delete nextCollapsedItems[key];
            delete nextHiddenItems[key];
          };

          if (targetSubgraphId === null) {
            // Root-scope node: reveal its group and the groups of its parent nodes.
            const groupId = getGroupIdForNode(
              node.id,
              rootNodes,
              workflow.groups ?? [],
            );
            revealGroup(groupId, null);
            parentIds.forEach((parentId) => {
              const parentGroupId = getGroupIdForNode(
                parentId,
                rootNodes,
                workflow.groups ?? [],
              );
              revealGroup(parentGroupId, null);
            });
          } else {
            // Inner subgraph node: expand the subgraph section, reveal its group,
            // and also reveal the root group containing the placeholder node for this subgraph.
            expandSubgraph(targetSubgraphId);
            const subgraph = subgraphById.get(targetSubgraphId);
            if (subgraph) {
              const groupId = getGroupIdForNode(
                node.id,
                subgraph.nodes ?? [],
                subgraph.groups ?? [],
              );
              revealGroup(groupId, targetSubgraphId);
            }

            // Under the canonical model: find the placeholder node in root scope
            // to reveal its parent group.
            const placeholderNode = rootNodes.find((n) => n.type === targetSubgraphId);
            if (placeholderNode) {
              const placeholderGroupId = getGroupIdForNode(
                placeholderNode.id,
                rootNodes,
                workflow.groups ?? [],
              );
              revealGroup(placeholderGroupId, null);
            }

            if (subgraph) {
              parentIds.forEach((parentId) => {
                const parentGroupId = getGroupIdForNode(
                  parentId,
                  subgraph.nodes ?? [],
                  subgraph.groups ?? [],
                );
                revealGroup(parentGroupId, targetSubgraphId);
              });
            }

            const stack = [targetSubgraphId];
            const visited = new Set<string>();
            while (stack.length > 0) {
              const current = stack.pop();
              if (!current || visited.has(current)) continue;
              visited.add(current);
              const parents = parentMap.get(current) ?? [];
              for (const parent of parents) {
                expandSubgraph(parent.parentId);
                const parentDef = subgraphById.get(parent.parentId);
                if (parentDef) {
                  const parentGroupId = getGroupIdForNode(
                    parent.nodeId,
                    parentDef.nodes ?? [],
                    parentDef.groups ?? [],
                  );
                  revealGroup(parentGroupId, parent.parentId);
                }
                if (!visited.has(parent.parentId)) {
                  stack.push(parent.parentId);
                }
              }
            }
          }

          return {
            hiddenItems: nextHiddenItems,
            collapsedItems: nextCollapsedItems,
          };
        });
      };

      const updateNodeWidget: WorkflowState["updateNodeWidget"] = (
        itemKey,
        widgetIndex,
        value,
        widgetName,
      ) => {
        const { workflow } = get();
        if (!workflow) return;
        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!node) return;
        const nextNodes = scope.nodes.map((n) =>
          n.id === node.id
            ? updateNodeWidgetValues(n, widgetIndex, value, widgetName)
            : n,
        );
        const nextWorkflow = scope.applyPatch(workflow, { nodes: nextNodes });
        set({ workflow: nextWorkflow });
        useWorkflowErrorsStore.getState().clearNodeError(node.id);
      };

      const updateNodeWidgets: WorkflowState["updateNodeWidgets"] = (
        itemKey,
        updates,
      ) => {
        const { workflow } = get();
        if (!workflow) return;
        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!node) return;
        const nextNodes = scope.nodes.map((n) =>
          n.id === node.id ? updateNodeWidgetsValues(n, updates) : n,
        );
        const nextWorkflow = scope.applyPatch(workflow, { nodes: nextNodes });
        set({ workflow: nextWorkflow });
        useWorkflowErrorsStore.getState().clearNodeError(node.id);
      };

      const updateSubgraphInnerNodeWidget: WorkflowState["updateSubgraphInnerNodeWidget"] = (
        subgraphId,
        innerNodeId,
        innerWidgetIndex,
        value,
      ) => {
        const { workflow } = get();
        if (!workflow) return;

        const subgraphs = workflow.definitions?.subgraphs ?? [];
        const sgIndex = subgraphs.findIndex((s) => s.id === subgraphId);
        if (sgIndex === -1) return;

        const sg = subgraphs[sgIndex];
        const nodes = sg.nodes ?? [];
        const nodeIndex = nodes.findIndex((n) => n.id === innerNodeId);
        if (nodeIndex === -1) return;

        const updatedInnerNode = updateNodeWidgetValues(nodes[nodeIndex], innerWidgetIndex, value);
        const updatedNodes = [
          ...nodes.slice(0, nodeIndex),
          updatedInnerNode,
          ...nodes.slice(nodeIndex + 1),
        ];
        const updatedSg = { ...sg, nodes: updatedNodes };
        const updatedSubgraphs = [
          ...subgraphs.slice(0, sgIndex),
          updatedSg,
          ...subgraphs.slice(sgIndex + 1),
        ];
        const nextWorkflow = {
          ...workflow,
          definitions: {
            ...workflow.definitions,
            subgraphs: updatedSubgraphs,
          },
        };
        set({ workflow: nextWorkflow });
      };

      const updateNodeProperties: WorkflowState["updateNodeProperties"] = (
        itemKey,
        properties,
      ) => {
        const { workflow } = get();
        if (!workflow) return;
        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!node) return;
        const nextNodes = scope.nodes.map((n) => {
          if (n.id !== node.id) return n;
          return {
            ...n,
            properties: {
              ...(n.properties ?? {}),
              ...properties,
            },
          };
        });
        const nextWorkflow = scope.applyPatch(workflow, { nodes: nextNodes });
        set({ workflow: nextWorkflow });
      };

      const updateNodeTitle: WorkflowState["updateNodeTitle"] = (
        itemKey,
        title,
      ) => {
        const { workflow } = get();
        if (!workflow) return;
        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!node) return;
        const normalized = title?.trim() ?? "";
        const nextNodes = scope.nodes.map((n) => {
          if (n.id !== node.id) return n;
          const nextProps = { ...(n.properties ?? {}) } as Record<
            string,
            unknown
          >;
          const nextNode = {
            ...n,
            properties: nextProps,
          } as WorkflowNode & { title?: string };
          // node.title is the canonical label. Older builds also mirrored it into
          // properties.title, which nothing reads and which leaked into the bottom
          // "Note" display — scrub that key and keep the label only on node.title.
          delete nextProps.title;
          if (normalized) {
            nextNode.title = normalized;
          } else {
            delete nextNode.title;
          }
          return nextNode as WorkflowNode;
        });
        const nextWorkflow = scope.applyPatch(workflow, { nodes: nextNodes });
        set({ workflow: nextWorkflow });
      };

      const toggleBypass: WorkflowState["toggleBypass"] = (itemKey) => {
        const { workflow } = get();
        if (!workflow) return;
        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!node) return;
        const currentMode = node.mode || 0;
        const newMode = currentMode === 4 ? 0 : 4;
        const nextNodes = scope.nodes.map((n) => {
          if (n.id !== node.id) return n;
          return { ...n, mode: newMode };
        });
        const nextWorkflow = scope.applyPatch(workflow, { nodes: nextNodes });
        set({ workflow: nextWorkflow });

        // A bypassed node is excluded from the queued prompt, so it can never be
        // the cause of a real error — clear any stale validation error it carries
        // (e.g. a load-time "missing image option") so it doesn't keep flagging.
        // Validation re-runs on load / queue, so un-bypassing resurfaces it if the
        // value is still invalid.
        if (newMode === 4) {
          const errorsStore = useWorkflowErrorsStore.getState();
          if (errorsStore.nodeErrors[String(node.id)]?.length) {
            errorsStore.clearNodeError(node.id);
            const remaining = Object.values(
              useWorkflowErrorsStore.getState().nodeErrors,
            ).flat();
            if (remaining.length === 0) {
              errorsStore.setError(null);
            } else if (remaining.every((e) => e.type === "workflow_load")) {
              errorsStore.setError(
                `Workflow load error: ${remaining.length} input${remaining.length === 1 ? "" : "s"} reference missing options.`,
              );
            }
          }
        }
      };

      const scrollToNode: WorkflowState["scrollToNode"] = (
        itemKey,
        label,
        flashConnectionDomId,
      ) => {
        const { hiddenItems, workflow, pointerByHierarchicalKey } = get();
        if (!workflow) return;
        const identity = resolveNodeIdentityFromHierarchicalKey(
          workflow,
          itemKey,
          pointerByHierarchicalKey,
        );
        if (!identity) return;
        const nodeId = identity.nodeId;
        const isNodeHidden = Boolean(hiddenItems[itemKey]);
        if (isNodeHidden) {
          get().setItemHidden(itemKey, false);
        }
        if (document.body.dataset.textareaFocus === "true") {
          return;
        }
        get().setItemCollapsed(itemKey, false);
        // If the user starts manually scrolling/dragging after this reveal kicks
        // off, abort: don't keep retrying to find the node or re-correcting the
        // alignment, which would fight them and yank the viewport back.
        const startedAt = Date.now();
        const attemptScroll = (
          attemptsLeft: number,
          delayedAttemptsLeft: number,
        ) => {
          if (userScrolledSince(startedAt)) return;
          const anchor =
            document.getElementById(`node-anchor-${nodeId}`) ??
            document.getElementById(`node-${nodeId}`);
          const nodeEl =
            document.getElementById(`node-card-${nodeId}`) ??
            document.getElementById(`node-${nodeId}`);
          // Retry if element not found, or found but has zero height (inside a collapsed group
          // that hasn't re-expanded yet after revealNodeWithParents updated the state).
          if (!anchor || !nodeEl || nodeEl.getBoundingClientRect().height === 0) {
            if (attemptsLeft > 0) {
              requestAnimationFrame(() =>
                attemptScroll(attemptsLeft - 1, delayedAttemptsLeft),
              );
            } else if (delayedAttemptsLeft > 0) {
              setTimeout(() => attemptScroll(10, delayedAttemptsLeft - 1), 200);
            }
            return;
          }
          const container = anchor.closest<HTMLElement>(
            '[data-node-list="true"]',
          );
          const scrollContainer = container || window;
          let scrollEndTimeout: ReturnType<typeof setTimeout> | null = null;
          // Offset of the anchor from the container's top (0 = aligned at top).
          const measureOffset = () =>
            container
              ? anchor.getBoundingClientRect().top -
                container.getBoundingClientRect().top
              : anchor.getBoundingClientRect().top;

          const alignNow = () => {
            if (container) {
              const targetTop = Math.max(
                0,
                container.scrollTop + measureOffset(),
              );
              container.scrollTo({ top: targetTop, behavior: "smooth" });
            } else {
              anchor.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          };

          const highlight = () => {
            document
              .querySelectorAll(".highlight-pulse")
              .forEach((el) => el.classList.remove("highlight-pulse"));
            nodeEl.classList.add("highlight-pulse");
            setTimeout(() => nodeEl.classList.remove("highlight-pulse"), 1200);
            // Flash the reciprocal connection button in the SAME instant and for
            // the same duration as the node pulse, so the two read as one event.
            document
              .querySelectorAll(".connection-highlight-pulse")
              .forEach((el) => el.classList.remove("connection-highlight-pulse"));
            const connectionEl = flashConnectionDomId
              ? document.getElementById(flashConnectionDomId)
              : null;
            if (connectionEl) {
              connectionEl.classList.add("connection-highlight-pulse");
              setTimeout(
                () => connectionEl.classList.remove("connection-highlight-pulse"),
                1200,
              );
            }
            if ("vibrate" in navigator) navigator.vibrate(10);

            if (label) {
              window.dispatchEvent(
                new CustomEvent("node-show-label", {
                  detail: { nodeId, label },
                }),
              );
            }
          };

          // The destination's connections section is unfolded and its card is
          // un-collapsed (and parents revealed) right before this scroll — those
          // animate open AFTER the initial scroll target is computed, growing the
          // content and leaving the smooth scroll short of (or past) the node.
          // So once scrolling settles, re-measure and correct, bounded, until the
          // anchor actually sits at the top (or we run out of attempts).
          let corrections = 0;
          const MAX_CORRECTIONS = 5;

          const cleanup = () => {
            if (scrollEndTimeout) {
              clearTimeout(scrollEndTimeout);
              scrollEndTimeout = null;
            }
            scrollContainer.removeEventListener(
              "scroll",
              handleScroll as EventListener,
            );
          };

          const finalize = () => {
            cleanup();
            // User took over the scroll — stop correcting (and skip the arrival
            // highlight); they're deliberately looking somewhere else.
            if (userScrolledSince(startedAt)) return;
            if (
              container &&
              Math.abs(measureOffset()) > 2 &&
              corrections < MAX_CORRECTIONS
            ) {
              corrections += 1;
              alignNow();
              watchForSettle();
              return;
            }
            highlight();
          };

          function handleScroll() {
            if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
            scrollEndTimeout = setTimeout(finalize, 120);
          }

          function watchForSettle() {
            scrollContainer.addEventListener(
              "scroll",
              handleScroll as EventListener,
              { passive: true },
            );
            // Fallback in case the corrective growth doesn't emit scroll events.
            scrollEndTimeout = setTimeout(finalize, 200);
          }

          alignNow();
          watchForSettle();
        };

        attemptScroll(10, 2);
      };

      const setExecutionState: WorkflowState["setExecutionState"] = (
        isExecuting,
        executingNodeHierarchicalKey,
        executingPromptId,
        progress,
        executingNodePath,
        sessionId,
      ) => {
        set((state) => {
          // Route execution updates for a parked (background-executing) session
          // into its snapshot. Only the scalar execution fields are tracked
          // there; per-node duration stats are intentionally skipped for
          // non-visible sessions.
          const parked = resolveWriteTarget(state, sessionId);
          if (parked) {
            const identity =
              isExecuting && executingNodeHierarchicalKey && parked.workflow
                ? resolveNodeIdentityFromHierarchicalKey(
                    parked.workflow,
                    executingNodeHierarchicalKey,
                    parked.pointerByHierarchicalKey,
                  )
                : null;
            const nextPromptId = isExecuting
              ? (executingPromptId ?? parked.executingPromptId)
              : null;
            return {
              parkedSessions: {
                ...state.parkedSessions,
                [sessionId as string]: {
                  ...parked,
                  isExecuting,
                  progress,
                  executingPromptId: nextPromptId,
                  executingNodeId: isExecuting
                    ? (identity ? String(identity.nodeId) : parked.executingNodeId)
                    : null,
                  executingNodeHierarchicalKey: isExecuting
                    ? (executingNodeHierarchicalKey ??
                       parked.executingNodeHierarchicalKey)
                    : null,
                  executingNodePath: isExecuting
                    ? (executingNodePath !== undefined
                        ? executingNodePath
                        : parked.executingNodePath)
                    : null,
                },
              },
            };
          }

          const now = Date.now();
          const resolvedExecutingNodeId =
            isExecuting && executingNodeHierarchicalKey && state.workflow
              ? (() => {
                  const identity = resolveNodeIdentityFromHierarchicalKey(
                    state.workflow,
                    executingNodeHierarchicalKey,
                    state.pointerByHierarchicalKey,
                  );
                  return identity ? String(identity.nodeId) : null;
                })()
              : null;
          const nextExecutingPromptId = isExecuting
            ? (executingPromptId ?? state.executingPromptId)
            : null;
          const promptChanged =
            Boolean(nextExecutingPromptId) &&
            nextExecutingPromptId !== state.executingPromptId;
          const nextExecutingNodeId = !isExecuting
            ? null
            : resolvedExecutingNodeId !== null
              ? resolvedExecutingNodeId
              : promptChanged
                ? null
                : state.executingNodeId;
          const nextExecutingHierarchicalKey = !isExecuting
            ? null
            : executingNodeHierarchicalKey !== null
              ? executingNodeHierarchicalKey
              : promptChanged
                ? null
                : state.executingNodeHierarchicalKey;
          const nextExecutingNodePath = !isExecuting
            ? null
            : executingNodePath !== undefined
              ? executingNodePath
              : promptChanged
                ? null
                : state.executingNodePath;
          const nextState: Partial<WorkflowState> = {
            isExecuting,
            executingNodeId: nextExecutingNodeId,
            executingNodeHierarchicalKey: nextExecutingHierarchicalKey,
            executingNodePath: nextExecutingNodePath,
            executingPromptId: nextExecutingPromptId,
            progress,
          };

          const updateNodeDuration = (
            nodeId: string | null,
            durationMs: number,
          ) => {
            if (!nodeId || durationMs <= 0) return state.nodeDurationStats;
            const node = state.workflow?.nodes.find(
              (n) => String(n.id) === nodeId,
            );
            if (node?.mode === 4) return state.nodeDurationStats;
            const key = String(nodeId);
            const prev = state.nodeDurationStats[key];
            const count = (prev?.count ?? 0) + 1;
            const avgMs = prev
              ? (prev.avgMs * prev.count + durationMs) / count
              : durationMs;
            return {
              ...state.nodeDurationStats,
              [key]: {
                avgMs,
                count,
              },
            };
          };

          if (!isExecuting) {
            if (state.currentNodeStartTime && state.executingNodeId) {
              const durationMs = now - state.currentNodeStartTime;
              nextState.nodeDurationStats = updateNodeDuration(
                state.executingNodeId,
                durationMs,
              );
            }
            if (state.executionStartTime && state.workflow) {
              const durationMs = now - state.executionStartTime;
              const signature = getWorkflowSignature(state.workflow);
              const prev = state.workflowDurationStats[signature];
              const count = (prev?.count ?? 0) + 1;
              const avgMs = prev
                ? (prev.avgMs * prev.count + durationMs) / count
                : durationMs;
              nextState.workflowDurationStats = {
                ...state.workflowDurationStats,
                [signature]: { avgMs, count },
              };
            }
            nextState.executionStartTime = null;
            nextState.currentNodeStartTime = null;
            return nextState;
          }

          const nodeChanged =
            nextExecutingNodeId &&
            nextExecutingNodeId !== state.executingNodeId;

          if (promptChanged) {
            nextState.executionStartTime = now;
            nextState.currentNodeStartTime = now;
          }

          if (
            nodeChanged &&
            state.currentNodeStartTime &&
            state.executingNodeId
          ) {
            const durationMs = now - state.currentNodeStartTime;
            nextState.nodeDurationStats = updateNodeDuration(
              state.executingNodeId,
              durationMs,
            );
            nextState.currentNodeStartTime = now;
          } else if (!state.currentNodeStartTime) {
            nextState.currentNodeStartTime = now;
          }

          return nextState;
        });
      };

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

          const syncResult = syncWorkflowGeometryFromLayoutChange({
            oldLayout: state.mobileLayout,
            newLayout: normalized,
            workflow: baseWorkflow,
          });
          const nextWorkflow = annotateWorkflowWithHierarchicalKeys(
            syncResult.workflow,
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
        const closingPreviews =
          id === state.activeSessionId
            ? state.latentPreviews
            : state.parkedSessions[id]?.latentPreviews;
        if (closingPreviews) {
          for (const url of Object.values(closingPreviews)) {
            URL.revokeObjectURL(url);
          }
        }
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
        const aliasNodeTypes = get().nodeTypes;
        if (
          !options?.filePrefixAliasesResolved
          && aliasNodeTypes
          && hasRecognizedFilePrefixAliasShape(workflow, aliasNodeTypes)
        ) {
          void restoreWorkflowFilePrefixes(workflow, aliasNodeTypes)
            .then((resolvedWorkflow) => {
              get().loadWorkflow(resolvedWorkflow, filename, {
                ...options,
                filePrefixAliasesResolved: true,
              });
            })
            .catch((error) => {
              console.error("Failed to resolve filename prefix aliases:", error);
              useWorkflowErrorsStore.getState().setError(
                "Unable to resolve local filename prefix aliases. Loading their opaque values instead.",
              );
              get().loadWorkflow(workflow, filename, {
                ...options,
                filePrefixAliasesResolved: true,
              });
            });
          return;
        }

        // Session bookkeeping: decide whether this load opens a new tab or
        // replaces the active one in place (reload/revert callers pass
        // replaceActive).
        {
          const st = get();
          const replaceActive = options?.replaceActive ?? false;
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
        // Normalize workflow to ensure required fields exist
        const normalizedNodes = normalizeWorkflowNodes(workflow.nodes);

        const normalizedWorkflow: Workflow = {
          ...workflow,
          nodes: normalizedNodes,
          links: workflow.links ?? [],
          groups: workflow.groups ?? [],
          config: workflow.config ?? {},
          last_node_id:
            workflow.last_node_id ??
            // Include subgraph inner node IDs — they share the global ID space.
            maxNodeIdAcrossScopes({ ...workflow, nodes: normalizedNodes }),
          last_link_id: workflow.last_link_id ?? 0,
          version: workflow.version ?? 0.4,
        };
        const canonicalWorkflow = canonicalizeWorkflowHierarchicalKeys(
          normalizedWorkflow,
          itemKeyByPointer,
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
                `Workflow load error: ${loadErrorCount} input${loadErrorCount === 1 ? "" : "s"} reference missing options.`,
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

      const clearNodeOutputs: WorkflowState["clearNodeOutputs"] = () => {
        set({ nodeOutputs: {}, nodeComparerOutputs: {}, nodeTextOutputs: {} });
      };

      const setLatentPreview: WorkflowState["setLatentPreview"] = (url, itemKey) => {
        if (!itemKey) { URL.revokeObjectURL(url); return; }
        const prev = get().latentPreviews[itemKey];
        if (prev) URL.revokeObjectURL(prev);
        set((state) => ({
          latentPreviews: { ...state.latentPreviews, [itemKey]: url },
        }));
      };

      const clearAllLatentPreviews: WorkflowState["clearAllLatentPreviews"] = () => {
        const previews = get().latentPreviews;
        for (const url of Object.values(previews)) {
          URL.revokeObjectURL(url);
        }
        set({ latentPreviews: {} });
      };

      const addPromptOutputs: WorkflowState["addPromptOutputs"] = (
        promptId,
        images,
        sessionId,
      ) => {
        if (!promptId || images.length === 0) return;
        set((state) => {
          const parked = resolveWriteTarget(state, sessionId);
          if (parked) {
            return patchParkedSession(state, sessionId as string, {
              promptOutputs: {
                ...parked.promptOutputs,
                [promptId]: [
                  ...(parked.promptOutputs[promptId] ?? []),
                  ...images,
                ],
              },
            });
          }
          return {
            promptOutputs: {
              ...state.promptOutputs,
              [promptId]: [...(state.promptOutputs[promptId] ?? []), ...images],
            },
          };
        });
      };

      const clearPromptOutputs: WorkflowState["clearPromptOutputs"] = (
        promptId,
        sessionId,
      ) => {
        if (!promptId) {
          set((state) => {
            // When a session is named, scope the clear to that session only —
            // a single session's event must never wipe every tab's outputs/routing.
            if (sessionId) {
              const parked = resolveWriteTarget(state, sessionId);
              if (parked) {
                return patchParkedSession(state, sessionId as string, {
                  promptOutputs: {},
                });
              }
              return { promptOutputs: {} };
            }
            // Only a truly unscoped call (no promptId AND no sessionId) clears all.
            const parkedSessions = Object.fromEntries(
              Object.entries(state.parkedSessions).map(([sid, snap]) => [
                sid,
                { ...snap, promptOutputs: {} },
              ]),
            );
            return {
              promptOutputs: {},
              parkedSessions,
              promptToSession: {},
            };
          });
          return;
        }
        set((state) => {
          const parked = resolveWriteTarget(state, sessionId);
          // Intentionally leave the promptToSession entry in place: it's bounded
          // by capPromptToSession and pruned on session close, and keeping it
          // means a late straggler message for this finished prompt still routes
          // to its owning tab instead of falling back to the active one.
          if (parked) {
            if (!parked.promptOutputs[promptId]) return {};
            const nextPromptOutputs = { ...parked.promptOutputs };
            delete nextPromptOutputs[promptId];
            return patchParkedSession(state, sessionId as string, {
              promptOutputs: nextPromptOutputs,
            });
          }
          if (!state.promptOutputs[promptId]) return {};
          const next = { ...state.promptOutputs };
          delete next[promptId];
          return { promptOutputs: next };
        });
      };

      const setRunCount: WorkflowState["setRunCount"] = (count) => {
        set({ runCount: Math.max(1, Math.floor(count)) });
      };

      const setInfiniteLoop: WorkflowState["setInfiniteLoop"] = (val) => {
        // Toggling infinite mode for the visible session is the single source of
        // truth: enabling it for the active session implicitly disables it for
        // whichever other session previously held it.
        const { activeSessionId } = get();
        set({
          infiniteLoop: val,
          infiniteLoopSessionId: val ? activeSessionId : null,
          // Arming waits for an explicit Run; disarming clears the wait.
          infiniteLoopAwaitingRun: val,
        });
      };

      const setIsStopping: WorkflowState["setIsStopping"] = (val) => {
        set({ isStopping: val });
      };

      const setSavingSessionId: WorkflowState["setSavingSessionId"] = (id) => {
        set({ savingSessionId: id });
      };

      const setFollowQueue: WorkflowState["setFollowQueue"] = (followQueue) => {
        set({ followQueue });
      };

      const toggleConnectionButtonsVisible: WorkflowState["toggleConnectionButtonsVisible"] =
        () => {
          set((state) => ({
            connectionButtonsVisible: !state.connectionButtonsVisible,
          }));
        };

      const showAllHiddenNodes: WorkflowState["showAllHiddenNodes"] = () => {
        set({ hiddenItems: {} });
      };

      const setItemCollapsed: WorkflowState["setItemCollapsed"] = (
        itemKey,
        collapsed,
      ) => {
        set((state) => {
          const canonicalHierarchicalKey =
            state.itemKeyByPointer[itemKey] ?? itemKey;
          const pointerKey = state.pointerByHierarchicalKey[canonicalHierarchicalKey];
          const nextCollapsed = { ...state.collapsedItems };
          if (collapsed) {
            nextCollapsed[canonicalHierarchicalKey] = true;
          } else {
            delete nextCollapsed[itemKey];
            delete nextCollapsed[canonicalHierarchicalKey];
            if (pointerKey) delete nextCollapsed[pointerKey];
          }
          return { collapsedItems: nextCollapsed };
        });
      };

      const bypassAllInContainer: WorkflowState["bypassAllInContainer"] = (
        itemKey,
        bypass,
      ) => {
        const { workflow, pointerByHierarchicalKey } = get();
        if (!workflow) return;
        const resolved = resolveContainerIdentityFromHierarchicalKey(
          workflow,
          itemKey,
          pointerByHierarchicalKey,
        );
        if (!resolved) return;
        if (resolved.type === "group") {
          const targetNodes = collectBypassGroupTargetNodes(
            workflow,
            resolved.groupId,
            resolved.subgraphId,
          );
          if (targetNodes.length === 0) return;
          const rootTargetIds = new Set<number>(
            targetNodes
              .filter((target) => target.subgraphId == null)
              .map((target) => target.nodeId),
          );
          const subgraphTargetsById = new Map<string, Set<number>>();
          for (const target of targetNodes) {
            if (target.subgraphId == null) continue;
            const targetSet = subgraphTargetsById.get(target.subgraphId) ?? new Set<number>();
            targetSet.add(target.nodeId);
            subgraphTargetsById.set(target.subgraphId, targetSet);
          }
          const mode = bypass ? 4 : 0;
          const nextRootNodes = (workflow.nodes ?? []).map((node) =>
            rootTargetIds.has(node.id) ? { ...node, mode } : node,
          );
          const rootChanged = nextRootNodes.some(
            (node, index) => node !== (workflow.nodes ?? [])[index],
          );

          const subgraphs = workflow.definitions?.subgraphs ?? [];
          const nextSubgraphs = subgraphs.map((sg) => {
            const targetIds = subgraphTargetsById.get(sg.id);
            if (!targetIds || targetIds.size === 0) return sg;
            const nextNodes = (sg.nodes ?? []).map((node) =>
              targetIds.has(node.id) ? { ...node, mode } : node,
            );
            const changed = nextNodes.some((n, i) => n !== (sg.nodes ?? [])[i]);
            return changed ? { ...sg, nodes: nextNodes } : sg;
          });
          const subgraphsChanged = nextSubgraphs.some((sg, i) => sg !== subgraphs[i]);
          if (!rootChanged && !subgraphsChanged) return;
          const nextWorkflow = {
            ...workflow,
            ...(rootChanged ? { nodes: nextRootNodes } : {}),
            ...(subgraphsChanged
              ? {
                  definitions: {
                    ...(workflow.definitions ?? {}),
                    subgraphs: nextSubgraphs,
                  },
                }
              : {}),
          };
          set({
            workflow: nextWorkflow,
          });
          return;
        }
        if (resolved.type !== "subgraph") return;
        const targetNodes = collectBypassSubgraphTargetNodes(
          workflow,
          resolved.subgraphId,
        );
        if (targetNodes.length === 0) return;
        const targetIdsBySubgraph = new Map<string, Set<number>>();
        for (const target of targetNodes) {
          if (!target.subgraphId) continue;
          const targetSet = targetIdsBySubgraph.get(target.subgraphId) ?? new Set<number>();
          targetSet.add(target.nodeId);
          targetIdsBySubgraph.set(target.subgraphId, targetSet);
        }
        const mode = bypass ? 4 : 0;
        // In canonical model, subgraph inner nodes are in definitions.subgraphs[i].nodes
        const subgraphs = workflow.definitions?.subgraphs ?? [];
        const nextSubgraphs = subgraphs.map((sg) => {
          const targetIds = targetIdsBySubgraph.get(sg.id);
          if (!targetIds || targetIds.size === 0) return sg;
          const nextNodes = (sg.nodes ?? []).map((node) =>
            targetIds.has(node.id) ? { ...node, mode } : node
          );
          const changed = nextNodes.some((n, i) => n !== (sg.nodes ?? [])[i]);
          return changed ? { ...sg, nodes: nextNodes } : sg;
        });
        const subgraphsChanged = nextSubgraphs.some((sg, i) => sg !== subgraphs[i]);
        if (!subgraphsChanged) return;
        // Also bypass/unbypass the placeholder node in workflow.nodes
        const nextNodes = workflow.nodes.map((node) =>
          node.type === resolved.subgraphId ? { ...node, mode } : node
        );
        const nodesChanged = nextNodes.some((n, i) => n !== workflow.nodes[i]);

        const nextWorkflow = {
          ...workflow,
          ...(nodesChanged ? { nodes: nextNodes } : {}),
          definitions: {
            ...(workflow.definitions ?? {}),
            subgraphs: nextSubgraphs,
          },
        };
        set({
          workflow: nextWorkflow,
        });
      };

      const deleteContainer: WorkflowState["deleteContainer"] = (
        itemKey,
        options,
      ) => {
        const {
          workflow,
          itemKeyByPointer,
          pointerByHierarchicalKey,
        } = get();
        if (!workflow) return;
        const resolved = resolveContainerIdentityFromHierarchicalKey(
          workflow,
          itemKey,
          pointerByHierarchicalKey,
        );
        if (!resolved) return;
        if (resolved.type === "group") {
          const {
            hiddenItems,
            connectionHighlightModes,
            mobileLayout,
            collapsedItems,
          } = get();
          const groupId = resolved.groupId;
          const subgraphId = resolved.subgraphId ?? null;
          const groupHierarchicalKeys = collectGroupHierarchicalKeys(
            mobileLayout,
            groupId,
            subgraphId,
          );
          const keysToRemoveSet = new Set<string>(groupHierarchicalKeys);
          keysToRemoveSet.add(resolved.itemKey);
          const keysToRemove =
            keysToRemoveSet.size > 0
              ? [...keysToRemoveSet]
              : [resolved.itemKey];
          const deleteNodes = options?.deleteNodes ?? false;
          const targetNodes = deleteNodes
            ? collectBypassContainerTargetNodesFromLayout(
                workflow,
                mobileLayout,
                itemKey,
              )
            : [];

          let nextWorkflow: Workflow = workflow;
          if (subgraphId) {
            const subgraphs = workflow.definitions?.subgraphs ?? [];
            const nextSubgraphs = subgraphs.map((subgraph) => {
              if (subgraph.id !== subgraphId) return subgraph;
              return {
                ...subgraph,
                groups: (subgraph.groups ?? []).filter(
                  (group) => group.id !== groupId,
                ),
              };
            });
            nextWorkflow = {
              ...workflow,
              definitions: {
                ...(workflow.definitions ?? {}),
                subgraphs: nextSubgraphs,
              },
            };
          } else {
            nextWorkflow = {
              ...workflow,
              groups: (workflow.groups ?? []).filter(
                (group) => group.id !== groupId,
              ),
            };
          }

          if (targetNodes.length > 0) {
            nextWorkflow = removeNodesFromWorkflow(nextWorkflow, targetNodes);
            // Remove orphaned subgraph definitions, preserving nested descendants
            // that are still reachable from retained root placeholders.
            const nextSubgraphDefsAll = nextWorkflow.definitions?.subgraphs ?? [];
            const definedSubgraphIds = new Set(nextSubgraphDefsAll.map((sg) => sg.id));
            const rootPlaceholderIds = (nextWorkflow.nodes ?? [])
              .map((node) => node.type)
              .filter((type): type is string => definedSubgraphIds.has(type));
            const reachableSubgraphIds = collectDescendantSubgraphs(
              rootPlaceholderIds,
              getSubgraphChildMap(nextWorkflow),
            );
            const nextSubgraphDefs = nextSubgraphDefsAll.filter((sg) =>
              reachableSubgraphIds.has(sg.id),
            );
            if (
              nextSubgraphDefs.length !==
              nextSubgraphDefsAll.length
            ) {
              nextWorkflow = {
                ...nextWorkflow,
                definitions: {
                  ...(nextWorkflow.definitions ?? {}),
                  subgraphs: nextSubgraphDefs,
                },
              };
            }
          }

          const uiCleanup = clearNodeUiStateForTargets(
            workflow,
            itemKeyByPointer,
            hiddenItems,
            connectionHighlightModes,
            targetNodes,
          );
          const nextHiddenItems = uiCleanup.hiddenItems;
          const nextHighlightModes = uiCleanup.connectionHighlightModes;

          const nextMobileLayout = deleteNodes
            ? buildLayoutForWorkflow(
                nextWorkflow,
                layoutRecordFromPointerRecord(nextHiddenItems, pointerByHierarchicalKey),
              )
            : (() => {
                let patched = mobileLayout;
                for (const groupKey of keysToRemove) {
                  patched = removeGroupFromLayoutByKey(
                    patched,
                    groupKey,
                  );
                }
                return patched;
              })();

          const nextCollapsedItems = { ...collapsedItems };
          for (const groupKey of keysToRemove) {
            delete nextCollapsedItems[groupKey];
            delete nextHiddenItems[groupKey];
          }
          const reconciled = reconcilePointerRegistry(
            nextMobileLayout,
            itemKeyByPointer,
            pointerByHierarchicalKey,
          );
          const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
            nextWorkflow,
            reconciled.layoutToStable,
          );

          set({
            workflow: nextWorkflowWithHierarchicalKeys,
            hiddenItems: nextHiddenItems,
            connectionHighlightModes: nextHighlightModes,
            mobileLayout: nextMobileLayout,
            itemKeyByPointer: reconciled.layoutToStable,
            pointerByHierarchicalKey: reconciled.stableToLayout,
            collapsedItems: nextCollapsedItems,
          });
          return;
        }
        if (resolved.type !== "subgraph") return;

        const {
          hiddenItems,
          connectionHighlightModes,
          mobileLayout,
          collapsedItems,
        } = get();

        const deleteNodes = options?.deleteNodes ?? false;
        const subgraphId = resolved.subgraphId;
        const subgraphDefs = workflow.definitions?.subgraphs ?? [];
        const targetSubgraph = subgraphDefs.find((sg) => sg.id === subgraphId);
        if (!targetSubgraph) return;

        const subgraphRef: ItemRef = { type: "subgraph", id: subgraphId };
        const location = findItemInLayout(mobileLayout, subgraphRef);
        const parentSubgraphId = location
          ? getParentSubgraphIdFromContainer(location.containerId, mobileLayout)
          : null;

        if (deleteNodes) {
          const subgraphChildMap = getSubgraphChildMap(workflow);
          const removedSubgraphIds = collectDescendantSubgraphs(
            [subgraphId],
            subgraphChildMap,
          );
          const targetNodes = collectBypassSubgraphTargetNodes(
            workflow,
            subgraphId,
          );
          const uiCleanup = clearNodeUiStateForTargets(
            workflow,
            itemKeyByPointer,
            hiddenItems,
            connectionHighlightModes,
            targetNodes,
          );
          const nextHiddenItems = uiCleanup.hiddenItems;
          const nextHighlightModes = uiCleanup.connectionHighlightModes;

          const nextSubgraphs = subgraphDefs.filter(
            (sg) => !removedSubgraphIds.has(sg.id),
          );

          let nextWorkflow = removeNodesFromWorkflow(workflow, targetNodes);
          nextWorkflow = {
            ...nextWorkflow,
            definitions: {
              ...(nextWorkflow.definitions ?? {}),
              subgraphs: nextSubgraphs,
            },
          };

          const nextLayout = buildLayoutForWorkflow(
            nextWorkflow,
            layoutRecordFromPointerRecord(nextHiddenItems, pointerByHierarchicalKey),
          );
          const reconciled = reconcilePointerRegistry(
            nextLayout,
            itemKeyByPointer,
            pointerByHierarchicalKey,
          );
          const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
            nextWorkflow,
            reconciled.layoutToStable,
          );
          const nextCollapsedItems = { ...collapsedItems };
          const nextHiddenSubgraphs = { ...nextHiddenItems };
          const removedSubgraphHierarchicalKeys = new Set(
            subgraphDefs
              .filter((sg) => removedSubgraphIds.has(sg.id))
              .map((sg) => sg.itemKey)
              .filter((key): key is string => typeof key === "string"),
          );
          for (const removedHierarchicalKey of removedSubgraphHierarchicalKeys) {
            delete nextCollapsedItems[removedHierarchicalKey];
            delete nextHiddenSubgraphs[removedHierarchicalKey];
          }

          set({
            workflow: nextWorkflowWithHierarchicalKeys,
            hiddenItems: nextHiddenSubgraphs,
            connectionHighlightModes: nextHighlightModes,
            mobileLayout: nextLayout,
            itemKeyByPointer: reconciled.layoutToStable,
            pointerByHierarchicalKey: reconciled.stableToLayout,
            collapsedItems: nextCollapsedItems,
          });
          return;
        }

        // Delete container only: dissolve the placeholder — promote inner
        // nodes/links/groups into the parent scope with fresh IDs, bridge the
        // boundary connections, and bake promoted widget values into the
        // promoted nodes.
        const dissolved = dissolveSubgraph(
          workflow,
          subgraphId,
          parentSubgraphId,
          get().nodeTypes,
        );
        if (!dissolved) return;
        const idMap = dissolved.groupIdMap;
        const nextWorkflow = dissolved.workflow;

        const nextLayout = buildLayoutForWorkflow(
          nextWorkflow,
          layoutRecordFromPointerRecord(
            hiddenItems,
            pointerByHierarchicalKey,
          ),
        );
        const reconciled = reconcilePointerRegistry(
          nextLayout,
          itemKeyByPointer,
          pointerByHierarchicalKey,
        );
        const nextCollapsedItems = { ...collapsedItems };
        const nextHiddenSubgraphs = { ...hiddenItems };
        const deletedSubgraphHierarchicalKey =
          targetSubgraph.itemKey ?? findSubgraphHierarchicalKey(workflow, subgraphId);
        if (deletedSubgraphHierarchicalKey) {
          delete nextCollapsedItems[deletedSubgraphHierarchicalKey];
          delete nextHiddenSubgraphs[deletedSubgraphHierarchicalKey];
        }

        // Remap any persisted group state that referenced promoted group ids from the deleted subgraph scope.
        const remapGroupState = (
          state: Record<string, boolean>,
        ): Record<string, boolean> => {
          const nextState: Record<string, boolean> = {};
          for (const [itemKey, value] of Object.entries(state)) {
            if (!value) continue;
            const identity = resolveContainerIdentityFromHierarchicalKey(
              workflow,
              itemKey,
              pointerByHierarchicalKey,
            );
            if (identity?.type === "group" && identity.subgraphId === subgraphId) {
              const mappedId = idMap.get(identity.groupId);
              if (mappedId == null) continue;
              const mappedKeys = collectGroupHierarchicalKeys(
                nextLayout,
                mappedId,
                parentSubgraphId,
              );
              for (const mappedKey of mappedKeys) {
                nextState[mappedKey] = true;
              }
              continue;
            }
            nextState[itemKey] = true;
          }
          return nextState;
        };

        const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
          nextWorkflow,
          reconciled.layoutToStable,
        );
        set(() => ({
          workflow: nextWorkflowWithHierarchicalKeys,
          mobileLayout: nextLayout,
          itemKeyByPointer: reconciled.layoutToStable,
          pointerByHierarchicalKey: reconciled.stableToLayout,
          collapsedItems: remapGroupState(nextCollapsedItems),
          hiddenItems: nextHiddenSubgraphs,
        }));
      };

      const updateContainerTitle: WorkflowState["updateContainerTitle"] = (
        itemKey,
        title,
      ) => {
        const { workflow, pointerByHierarchicalKey } = get();
        if (!workflow) return;
        const resolved = resolveContainerIdentityFromHierarchicalKey(
          workflow,
          itemKey,
          pointerByHierarchicalKey,
        );
        if (!resolved) return;
        const nextTitle = title.trim();
        if (resolved.type === "group") {
          const { groupId, subgraphId } = resolved;
          if (subgraphId) {
            const subgraphs = workflow.definitions?.subgraphs ?? [];
            const nextSubgraphs = subgraphs.map((subgraph) => {
              if (subgraph.id !== subgraphId) return subgraph;
              const groups = subgraph.groups ?? [];
              const nextGroups = groups.map((group) =>
                group.id === groupId ? { ...group, title: nextTitle } : group,
              );
              return { ...subgraph, groups: nextGroups };
            });
            useWorkflowErrorsStore.getState().setError(null);
            const nextWorkflow = {
              ...workflow,
              definitions: {
                ...(workflow.definitions ?? {}),
                subgraphs: nextSubgraphs,
              },
            };
            set({
              workflow: nextWorkflow,
            });
            return;
          }
          const nextGroups = (workflow.groups ?? []).map((group) =>
            group.id === groupId ? { ...group, title: nextTitle } : group,
          );
          const nextWorkflow = { ...workflow, groups: nextGroups };
          set({
            workflow: nextWorkflow,
          });
          return;
        }
        if (resolved.type === "subgraph") {
          const subgraphId = resolved.subgraphId;
          const subgraphs = workflow.definitions?.subgraphs ?? [];
          const nextSubgraphs = subgraphs.map((subgraph) =>
            subgraph.id === subgraphId
              ? { ...subgraph, name: nextTitle }
              : subgraph,
          );
          const nextWorkflow = {
            ...workflow,
            definitions: {
              ...(workflow.definitions ?? {}),
              subgraphs: nextSubgraphs,
            },
          };
          set({
            workflow: nextWorkflow,
          });
        }
      };

      const updateWorkflowItemColor: WorkflowState["updateWorkflowItemColor"] = (
        itemKey,
        color,
      ) => {
        const { workflow, pointerByHierarchicalKey } = get();
        if (!workflow) return;
        const resolved = resolveContainerIdentityFromHierarchicalKey(
          workflow,
          itemKey,
          pointerByHierarchicalKey,
        );
        const nextColor = resolveWorkflowColor(color.trim());
        if (!nextColor) return;

        if (resolved) {
          if (resolved.type === "group") {
            const { groupId, subgraphId } = resolved;
            if (subgraphId) {
              const subgraphs = workflow.definitions?.subgraphs ?? [];
              const nextSubgraphs = subgraphs.map((subgraph) => {
                if (subgraph.id !== subgraphId) return subgraph;
                const groups = subgraph.groups ?? [];
                const nextGroups = groups.map((group) =>
                  group.id === groupId ? { ...group, color: nextColor } : group,
                );
                return { ...subgraph, groups: nextGroups };
              });
              const nextWorkflow = {
                ...workflow,
                definitions: {
                  ...(workflow.definitions ?? {}),
                  subgraphs: nextSubgraphs,
                },
              };
              set({
                workflow: nextWorkflow,
              });
              return;
            }

            const nextGroups = (workflow.groups ?? []).map((group) =>
              group.id === groupId ? { ...group, color: nextColor } : group,
            );
            const nextWorkflow = { ...workflow, groups: nextGroups };
            set({
              workflow: nextWorkflow,
            });
            return;
          }

          if (resolved.type === "subgraph") {
            const noColorValue = resolveWorkflowColor("nocolor");
            const nextSubgraphColor =
              nextColor === noColorValue ? themeColors.brand.blue500 : nextColor;
            const nextSubgraphs = (workflow.definitions?.subgraphs ?? []).map(
              (subgraph) => {
                if (subgraph.id !== resolved.subgraphId) return subgraph;
                return {
                  ...subgraph,
                  state: {
                    ...(subgraph.state ?? {}),
                    color: nextSubgraphColor,
                  },
                };
              },
            );
            const nextWorkflow = {
              ...workflow,
              definitions: {
                ...(workflow.definitions ?? {}),
                subgraphs: nextSubgraphs,
              },
            };
            set({
              workflow: nextWorkflow,
            });
            return;
          }
        }

        const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
        const targetNode = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!targetNode) return;
        const nextNodes = scope.nodes.map((n) => {
          if (n.id !== targetNode.id) return n;
          return { ...n, color: nextColor, bgcolor: nextColor };
        });
        const nextWorkflow = scope.applyPatch(workflow, { nodes: nextNodes });
        set({
          workflow: nextWorkflow,
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
      const applyControlAfterGenerate: WorkflowState["applyControlAfterGenerate"] =
        (sessionId) => {
          const state = get();
          const parked = resolveWriteTarget(state, sessionId);
          const workflow = parked ? parked.workflow : state.workflow;
          if (!workflow) return;

          let hasChanges = false;
          const newNodes = workflow.nodes.map((node) => {
            // Handle PrimitiveNode with control_after_generate
            if (node.type === "PrimitiveNode") {
              if (!Array.isArray(node.widgets_values)) {
                return node;
              }
              const outputType = node.outputs?.[0]?.type;
              const normalizedType = String(outputType).toUpperCase();

              // Only numeric types support control_after_generate
              if (normalizedType !== "INT" && normalizedType !== "FLOAT") {
                return node;
              }

              const controlMode = node.widgets_values?.[1] as
                | string
                | undefined;
              if (!controlMode || controlMode === "fixed") {
                return node;
              }

              const currentValue = node.widgets_values?.[0];
              if (typeof currentValue !== "number") {
                return node;
              }

              let newValue = currentValue;
              if (controlMode === "increment") {
                newValue =
                  normalizedType === "INT"
                    ? currentValue + 1
                    : currentValue + 0.01;
              } else if (controlMode === "decrement") {
                newValue =
                  normalizedType === "INT"
                    ? currentValue - 1
                    : currentValue - 0.01;
              } else if (controlMode === "randomize") {
                // For INT, generate a random seed within the safe universal
                // ceiling (2^32-1). A primitive feeds its value to a consumer by
                // connection, whose seed max isn't known here; 2^32-1 is accepted
                // by ~every node (going higher made nodes like Qwen-VL reject the
                // branch at validation). For FLOAT, generate between 0 and 1.
                newValue =
                  normalizedType === "INT"
                    ? Math.floor(Math.random() * (DEFAULT_SPECIAL_SEED_RANGE + 1))
                    : Math.random();
              }

              if (newValue !== currentValue) {
                hasChanges = true;
                const newWidgetValues = [...node.widgets_values];
                newWidgetValues[0] = newValue;
                return { ...node, widgets_values: newWidgetValues };
              }
            }

            return node;
          });

          if (hasChanges) {
            const nextWorkflow = { ...workflow, nodes: newNodes };
            if (parked) {
              set({
                parkedSessions: {
                  ...get().parkedSessions,
                  [sessionId as string]: { ...parked, workflow: nextWorkflow },
                },
              });
            } else {
              set({ workflow: nextWorkflow });
            }
          }
        };

      const enterSubgraph: WorkflowState["enterSubgraph"] = (placeholderNodeId) => {
        const { scopeStack, workflow } = get();
        if (!workflow) return;
        const scope = resolveCurrentScope(scopeStack, workflow);
        const placeholderNode = scope.nodes.find((n) => n.id === placeholderNodeId);
        if (!placeholderNode) return;
        const subgraphId = placeholderNode.type;
        const subgraphs = workflow.definitions?.subgraphs ?? [];
        if (!subgraphs.some((sg) => sg.id === subgraphId)) return;
        const top = scopeStack[scopeStack.length - 1];
        if (top?.type === "subgraph" && top.id === subgraphId) return;
        set({ scopeStack: [...scopeStack, { type: "subgraph", id: subgraphId, placeholderNodeId }] });
      };

      const exitSubgraph: WorkflowState["exitSubgraph"] = () => {
        const { scopeStack } = get();
        if (scopeStack.length <= 1) return;
        set({ scopeStack: scopeStack.slice(0, -1) });
      };

      const exitToRoot: WorkflowState["exitToRoot"] = () => {
        set({ scopeStack: [{ type: "root" }] });
      };

      const exitToDepth: WorkflowState["exitToDepth"] = (depth) => {
        const { scopeStack } = get();
        if (scopeStack.length <= depth) return;
        set({ scopeStack: scopeStack.slice(0, depth) });
      };

      const navigateToSubgraphTrail: WorkflowState["navigateToSubgraphTrail"] = (
        subgraphIds,
      ) => {
        const { workflow, scopeStack } = get();
        if (!workflow) return false;
        const nextScopeStack = buildScopeStackForSubgraphTrail(workflow, subgraphIds);
        if (!nextScopeStack) return false;
        const sameTrail =
          scopeStack.length === nextScopeStack.length &&
          scopeStack.every((frame, index) => {
            const nextFrame = nextScopeStack[index];
            if (frame.type !== nextFrame?.type) return false;
            if (frame.type === "root" || nextFrame.type === "root") return true;
            return frame.id === nextFrame.id;
          });
        if (sameTrail) return true;
        set({ scopeStack: nextScopeStack });
        return true;
      };

      const queueWorkflow: WorkflowState["queueWorkflow"] = async (
        count,
        sessionId,
        isInfiniteReEnqueue,
      ) => {
        const state = get();
        const sid = sessionId ?? state.activeSessionId;
        // A null sid (no sessions registered yet — e.g. tests that set workflow
        // directly) still targets the flat "active" fields.
        const isActive = sid == null || sid === state.activeSessionId;
        const parked = !isActive ? state.parkedSessions[sid!] : null;
        const nodeTypes = state.nodeTypes;
        const sourceWorkflow = isActive ? state.workflow : parked?.workflow ?? null;
        // Seeds: the seed store always mirrors the active session; parked
        // sessions carry their own seed maps in their snapshot.
        const seedModes = isActive
          ? useSeedStore.getState().seedModes
          : parked?.seedModes ?? {};
        const seedLastValues = isActive
          ? useSeedStore.getState().seedLastValues
          : parked?.seedLastValues ?? {};

        if (!isActive && !parked) return;
        if (!sourceWorkflow || !nodeTypes) {
          useWorkflowErrorsStore
            .getState()
            .setError("Node types are still loading. Try again in a moment.");
          return;
        }

        // Write helpers route per-iteration mutations to flat fields (active) or
        // the owning session's snapshot (parked).
        //
        // CRITICAL: these run AFTER awaits (the paint yield + each /api/prompt
        // round-trip). The user can switch tabs mid-enqueue, which folds this
        // session from active→parked. So each write must re-resolve where session
        // `sid` lives RIGHT NOW — trusting the captured `isActive` here would
        // write this enqueue's seed/workflow mutations into whatever tab became
        // active, silently overwriting it.
        const liveTarget = (): "active" | "parked" | "gone" => {
          const cur = get();
          if (sid == null || sid === cur.activeSessionId) return "active";
          if (sid && cur.parkedSessions[sid]) return "parked";
          return "gone"; // session was closed mid-flight — drop the write.
        };
        const writeWorkflow = (wf: Workflow) => {
          const target = liveTarget();
          if (target === "active") {
            set({ workflow: wf });
          } else if (target === "parked") {
            set((s) => ({
              parkedSessions: {
                ...s.parkedSessions,
                [sid!]: { ...s.parkedSessions[sid!], workflow: wf },
              },
            }));
          }
        };
        const writeSeedLastValues = (vals: SeedLastValues) => {
          const target = liveTarget();
          if (target === "active") {
            useSeedStore.getState().setSeedLastValues(vals);
          } else if (target === "parked") {
            set((s) => ({
              parkedSessions: {
                ...s.parkedSessions,
                [sid!]: { ...s.parkedSessions[sid!], seedLastValues: vals },
              },
            }));
          }
        };
        const writeExpandedMaps = (
          idMap: Record<string, string>,
          pathMap: Record<string, string>,
        ) => {
          const target = liveTarget();
          if (target === "active") {
            set({ expandedNodeIdMap: idMap, expandedNodePathMap: pathMap });
          } else if (target === "parked") {
            set((s) => ({
              parkedSessions: {
                ...s.parkedSessions,
                [sid!]: {
                  ...s.parkedSessions[sid!],
                  expandedNodeIdMap: idMap,
                  expandedNodePathMap: pathMap,
                },
              },
            }));
          }
        };

        useWorkflowErrorsStore.getState().setError(null);
        if (liveTarget() === "active") set({ isLoading: true });
        if (sid) {
          set((s) => ({
            isLoadingBySession: { ...s.isLoadingBySession, [sid]: true },
          }));
        }

        try {
          await yieldToBrowserPaint();

          let currentWorkflow = sourceWorkflow;
          let nextSeedLastValues: SeedLastValues = { ...seedLastValues };

          // Process seed mode for a single node; mutates seedOverrides and
          // nextSeedLastValues in-place. Overrides are keyed by scoped key
          // ("nodeId" at root, "subgraphId:nodeId" inside a definition) so a
          // root node and an inner node sharing a numeric ID can't clobber
          // each other; queueing remaps them to expanded node IDs.
          const processSeedNode = (
            node: WorkflowNode,
            seedOverrides: Record<string, number>,
            scopeSubgraphId: string | null,
          ): WorkflowNode => {
            const seedIndex = findSeedWidgetIndex(currentWorkflow, nodeTypes, node);
            if (seedIndex === null) return node;
            if (!Array.isArray(node.widgets_values)) return node;

            const controlWidgetIndex = seedIndex + 1;
            const hasControlWidget = hasSeedControlWidget(
              node,
              node.widgets_values[controlWidgetIndex],
            );
            const controlWidgetMode =
              hasControlWidget && typeof node.widgets_values[controlWidgetIndex] === "string"
                ? (node.widgets_values[controlWidgetIndex] as SeedMode)
                : null;
            const mode =
              controlWidgetMode ??
              seedModes[node.id] ??
              inferSeedMode(currentWorkflow, nodeTypes, node);

            if (hasControlWidget) {
              if (!mode || mode === "fixed") return node;
              const currentSeed = Number(node.widgets_values[seedIndex]) || 0;
              let nextSeed: number;
              switch (mode) {
                case "randomize": nextSeed = generateSeedFromNode(nodeTypes, node); break;
                case "increment": nextSeed = currentSeed + 1; break;
                case "decrement": nextSeed = currentSeed - 1; break;
                default: return node;
              }
              const newWidgetValues = [...node.widgets_values];
              newWidgetValues[seedIndex] = clampSeedToNodeBounds(nextSeed, nodeTypes, node);
              return { ...node, widgets_values: newWidgetValues };
            }

            const rawSeed = Number(node.widgets_values[seedIndex]);
            const lastSeed = nextSeedLastValues[node.id] ?? null;
            let seedToUse: number | null = null;
            if (isSpecialSeedValue(rawSeed)) {
              seedToUse = resolveSpecialSeedToUse(rawSeed, lastSeed, nodeTypes, node);
            } else if (mode && mode !== "fixed") {
              if (mode === "randomize") {
                seedToUse = generateSeedFromNode(nodeTypes, node);
              } else if (mode === "increment") {
                const base = typeof lastSeed === "number" ? lastSeed : rawSeed;
                seedToUse = base + 1;
              } else if (mode === "decrement") {
                const base = typeof lastSeed === "number" ? lastSeed : rawSeed;
                seedToUse = base - 1;
              }
            }
            if (seedToUse === null) return node;
            // Never hand the node a seed outside its declared range, or ComfyUI
            // silently drops that node's branch at validation.
            seedToUse = clampSeedToNodeBounds(seedToUse, nodeTypes, node);
            const overrideKey =
              scopeSubgraphId == null
                ? String(node.id)
                : `${scopeSubgraphId}:${node.id}`;
            seedOverrides[overrideKey] = seedToUse;
            nextSeedLastValues = { ...nextSeedLastValues, [node.id]: seedToUse };
            return node;
          };

          for (let i = 0; i < count; i++) {
            const seedOverrides: Record<string, number> = {};
            // Handle seed modes for root nodes and inner subgraph nodes.
            const updatedNodes = currentWorkflow.nodes.map((node) =>
              processSeedNode(node, seedOverrides, null),
            );
            const subgraphDefsForSeed = currentWorkflow.definitions?.subgraphs ?? [];
            const updatedSubgraphDefs = subgraphDefsForSeed.map((sg) => {
              const updatedSgNodes = (sg.nodes ?? []).map((node) =>
                processSeedNode(node, seedOverrides, sg.id),
              );
              const changed = updatedSgNodes.some((n, idx) => n !== (sg.nodes ?? [])[idx]);
              return changed ? { ...sg, nodes: updatedSgNodes } : sg;
            });

            // Update current workflow with new seeds for this iteration
            currentWorkflow = {
              ...currentWorkflow,
              nodes: updatedNodes,
              definitions: currentWorkflow.definitions
                ? { ...currentWorkflow.definitions, subgraphs: updatedSubgraphDefs }
                : currentWorkflow.definitions,
            };
            writeSeedLastValues(nextSeedLastValues);
            writeWorkflow(currentWorkflow);

            // Expand JIT for prompt building (one-way, ephemeral — no sync-back needed).
            // promptKeyMap maps each expanded node's numeric ID to its hierarchical
            // execution ID (e.g. "50:7" for inner node 7 inside placeholder 50),
            // matching the ID scheme used by the main ComfyUI frontend.
            const { workflow: expandedForQueue, promptKeyMap } = expandWorkflowSubgraphs(currentWorkflow, nodeTypes);

            // Build mapping from WS node IDs back to canonical itemKeys.
            // ComfyUI may report either expanded numeric IDs or hierarchical prompt keys,
            // so we store both forms for robust node-progress routing.
            {
              const idMap: Record<string, string> = {};
              const pathMap: Record<string, string> = {};

              // Build lookup: placeholder node ID → subgraph definition UUID.
              // Needed for deriving itemKeys of expanded inner nodes that lack one.
              const placeholderToSgId = new Map<string, string>();
              const subgraphDefs = currentWorkflow.definitions?.subgraphs ?? [];
              const sgIdSet = new Set(subgraphDefs.map((sg) => sg.id));
              for (const node of currentWorkflow.nodes) {
                if (sgIdSet.has(node.type)) {
                  placeholderToSgId.set(String(node.id), node.type);
                }
              }

              for (const node of expandedForQueue.nodes) {
                const promptKey = promptKeyMap.get(node.id);
                let resolvedKey = node.itemKey ?? null;

                // Expanded subgraph inner nodes may lack itemKey when the user
                // hasn't navigated into that subgraph scope yet.  Derive from
                // the prompt key hierarchy: "placeholderId:innerNodeId".
                if (!resolvedKey && promptKey) {
                  const colonIdx = promptKey.indexOf(':');
                  if (colonIdx !== -1) {
                    const placeholderId = promptKey.substring(0, colonIdx);
                    const innerNodeId = promptKey.substring(colonIdx + 1);
                    const sgId = placeholderToSgId.get(placeholderId);
                    // Only handle single-level nesting (no further colons)
                    if (sgId && !innerNodeId.includes(':')) {
                      resolvedKey = `root/subgraph:${sgId}/node:${innerNodeId}`;
                    }
                  }
                }

                if (!resolvedKey) continue;
                idMap[String(node.id)] = resolvedKey;
                if (promptKey) idMap[promptKey] = resolvedKey;
              }
              for (const [expandedId, promptKey] of promptKeyMap) {
                pathMap[String(expandedId)] = promptKey;
                pathMap[promptKey] = promptKey;
              }
              writeExpandedMaps(idMap, pathMap);
            }

            // Remap scoped seed overrides ("nodeId" / "subgraphId:nodeId") to
            // expanded node IDs by walking each prompt key's placeholder path
            // down to the definition that owns the innermost node.
            const subgraphDefsById = new Map(
              (currentWorkflow.definitions?.subgraphs ?? []).map((sg) => [sg.id, sg]),
            );
            const scopedOverrideKeyForPromptKey = (promptKey: string): string | null => {
              const segments = promptKey.split(":");
              if (segments.length === 1) return segments[0];
              let scopeNodes = currentWorkflow.nodes;
              let scopeSgId: string | null = null;
              for (let s = 0; s < segments.length - 1; s += 1) {
                const placeholderId = Number(segments[s]);
                const placeholder = scopeNodes.find((n) => n.id === placeholderId);
                const sg = placeholder ? subgraphDefsById.get(placeholder.type) : undefined;
                if (!sg) return null;
                scopeSgId = sg.id;
                scopeNodes = sg.nodes ?? [];
              }
              return `${scopeSgId}:${segments[segments.length - 1]}`;
            };
            const expandedSeedOverrides: Record<number, number> = {};
            for (const node of expandedForQueue.nodes) {
              const promptKey = promptKeyMap.get(node.id) ?? String(node.id);
              const scopedKey = scopedOverrideKeyForPromptKey(promptKey);
              if (scopedKey != null && seedOverrides[scopedKey] !== undefined) {
                expandedSeedOverrides[node.id] = seedOverrides[scopedKey];
              }
            }

            const prompt: Record<string, unknown> = {};
            const allowedNodeIds = new Set<number>();
            const classTypeById = new Map<number, string>();

            for (const node of expandedForQueue.nodes) {
              if (node.mode === 4) continue;
              let classType: string | null = null;
              if (nodeTypes[node.type]) {
                classType = node.type;
              } else {
                const match = Object.entries(nodeTypes).find(
                  ([, def]) =>
                    def.display_name === node.type || def.name === node.type,
                );
                if (match) classType = match[0];
              }
              if (classType) {
                allowedNodeIds.add(node.id);
                classTypeById.set(node.id, classType);
              }
            }

            for (const node of expandedForQueue.nodes) {
              if (node.mode === 4) continue;
              const classType = classTypeById.get(node.id);
              if (!classType) continue;
              const inputs = buildWorkflowPromptInputs(
                expandedForQueue,
                nodeTypes,
                node,
                classType,
                allowedNodeIds,
                getNodeWidgetIndexMap(expandedForQueue, node),
                expandedSeedOverrides,
                promptKeyMap,
              );
              const promptKey = promptKeyMap.get(node.id) ?? String(node.id);
              prompt[promptKey] = { class_type: classType, inputs };
            }

            // Infinite-loop safety: if an infinite re-enqueue would submit the
            // exact same prompt as last time (e.g. a fixed seed), the loop would
            // just regenerate an identical result forever. Stop and explain.
            const promptSignature = JSON.stringify(prompt);
            if (
              isInfiniteReEnqueue &&
              sid &&
              promptSignature === get().lastPromptSignatureBySession[sid]
            ) {
              set({ infiniteLoopSessionId: null });
              if (isActive) set({ infiniteLoop: false });
              useWorkflowErrorsStore
                .getState()
                .setError(
                  "Infinite generation stopped: the workflow would re-run an identical prompt (likely a fixed seed), producing the same result over and over. Set a seed widget to randomize — or change an input — to keep generating new outputs.",
                );
              return;
            }

            // Embed the canonical workflow (not expanded) so desktop ComfyUI can reload it correctly.
            // Run validateAndNormalizeWorkflow to repair any stale SubgraphIO.linkIds before embedding.
            let queuedWorkflow = validateAndNormalizeWorkflow(stripWorkflowClientMetadata(currentWorkflow));
            let queuedPrompt = prompt;
            if (useGenerationSettingsStore.getState().obfuscateSharedInputPaths) {
              const obfuscated = await obfuscateQueuedInputPaths(prompt, queuedWorkflow, nodeTypes);
              queuedPrompt = obfuscated.prompt;
              queuedWorkflow = obfuscated.workflow;
            }
            const metadataFilename = isActive ? state.currentFilename : parked?.currentFilename ?? null;
            const metadataSource = isActive ? state.workflowSource : parked?.workflowSource ?? null;
            const metadataWorkflowLabel = queueWorkflowLabel(metadataFilename, metadataSource);
            const hiddenWorkflow = isWorkflowHidden(metadataSource, metadataFilename);
            const previewMethod = useGenerationSettingsStore.getState().previewMethod;
            const promptRequest: api.PromptQueueRequest = {
              prompt: queuedPrompt,
              client_id: api.clientId,
              extra_data: {
                extra_pnginfo: {
                  workflow: queuedWorkflow,
                },
                ...(hiddenWorkflow ? { [HIDDEN_WORKFLOW_EXTRA_DATA_KEY]: true } : {}),
                ...(previewMethod !== 'none' ? { preview_method: previewMethod } : {}),
              },
            };
            const response = await fetch('/api/prompt', {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(promptRequest),
            });

            if (!response.ok) {
              const errorData = await response.json();
              const getErrorMessage = (value: unknown): string | null => {
                if (typeof value === 'string') return value;
                if (value && typeof value === 'object') {
                  const details = value as { message?: unknown; error?: unknown; details?: unknown };
                  if (typeof details.message === 'string') return details.message;
                  if (typeof details.error === 'string') return details.error;
                  if (typeof details.details === 'string') return details.details;
                }
                return null;
              };

              // Parse node-specific errors if present
              const nodeErrors: Record<string, NodeError[]> = {};
              if (errorData.node_errors) {
                for (const [nodeId, nodeError] of Object.entries(
                  errorData.node_errors,
                )) {
                  const errorsArray = Array.isArray(nodeError)
                    ? nodeError
                    : (typeof nodeError === "object" &&
                        nodeError !== null &&
                        "errors" in nodeError &&
                        Array.isArray((nodeError as { errors?: unknown[] }).errors))
                    ? (nodeError as { errors: Array<{
                        type: string;
                        message: string;
                        details: string;
                        extra_info?: { input_name?: string };
                      }> }).errors
                    : [];
                  if (errorsArray && errorsArray.length > 0) {
                    nodeErrors[nodeId] = errorsArray.map((e) => ({
                      type: e.type,
                      message: e.message,
                      details: e.details,
                      inputName: e.extra_info?.input_name,
                    }));
                  }
                }
              }

              if (Object.keys(nodeErrors).length > 0) {
                applyNodeErrors(nodeErrors);
              }

              throw new Error(
                getErrorMessage(errorData.error) || "Failed to queue prompt",
              );
            }

            // Record which session owns this prompt_id for websocket routing.
            try {
              const okData = (await response.json()) as { prompt_id?: string };
              const promptId = okData?.prompt_id;
              if (promptId && sid) {
                // Prompts still in the backend queue must keep their routing
                // entry even if the map is over the cap (a long/infinite run can
                // accumulate >200 entries); only finished ones are safe to evict.
                const q = useQueueStore.getState();
                const activePromptIds = new Set<string>([
                  promptId,
                  ...q.running.map((item) => item.prompt_id),
                  ...q.pending.map((item) => item.prompt_id),
                ]);
                set((s) => ({
                  promptToSession: capPromptToSession(
                    {
                      ...s.promptToSession,
                      [promptId]: sid,
                    },
                    activePromptIds,
                  ),
                  // A run was actually queued for the loop owner, so it is no
                  // longer "armed but awaiting Run" — the idle-resume driver
                  // may keep the loop going from here on.
                  ...(sid === s.infiniteLoopSessionId && s.infiniteLoopAwaitingRun
                    ? { infiniteLoopAwaitingRun: false }
                    : {}),
                }));
              }
              if (promptId) {
                useQueueStore.getState().registerLocalPrompt(promptId);
                useQueueStore.getState().recordQueuedPrompt(promptId, promptRequest, {
                  sessionId: sid,
                });
                let workflowDiffForMetadata: ReturnType<typeof computeQueueWorkflowDiff> | undefined;
                // Compute & store this queue item's workflow diff (prompt
                // preview) against the session's rolling base, then advance the
                // base for next time. See selectDiffBase for the "same diff
                // until you make a change" rule.
                try {
                  const fresh = get();
                  // Re-resolve where this session lives now (it may have been
                  // switched active→parked during the fetch); see liveTarget.
                  const diffTarget = liveTarget();
                  const diffUseFlat = diffTarget === "active";
                  const parkedForDiff =
                    diffTarget === "parked" && sid ? fresh.parkedSessions[sid] : null;
                  const diffBase = diffUseFlat
                    ? fresh.diffBaseWorkflow
                    : parkedForDiff?.diffBaseWorkflow ?? null;
                  const lastEnqueued = diffUseFlat
                    ? fresh.lastEnqueuedWorkflow
                    : parkedForDiff?.lastEnqueuedWorkflow ?? null;
                  const originalForSession = diffUseFlat
                    ? fresh.originalWorkflow
                    : parkedForDiff?.originalWorkflow ?? null;
                  const { base, nextDiffBase } = selectDiffBase(
                    currentWorkflow,
                    lastEnqueued,
                    diffBase,
                    originalForSession,
                    nodeTypes,
                  );
                  const diff = computeQueueWorkflowDiff(base, currentWorkflow);
                  workflowDiffForMetadata = diff;
                  useQueueStore.getState().recordWorkflowDiff(promptId, diff);
                  const enqueuedSnapshot = structuredClone(currentWorkflow);
                  if (diffUseFlat) {
                    set({
                      diffBaseWorkflow: nextDiffBase,
                      lastEnqueuedWorkflow: enqueuedSnapshot,
                    });
                  } else if (diffTarget === "parked" && sid) {
                    set((s) => ({
                      parkedSessions: {
                        ...s.parkedSessions,
                        [sid]: {
                          ...s.parkedSessions[sid],
                          diffBaseWorkflow: nextDiffBase,
                          lastEnqueuedWorkflow: enqueuedSnapshot,
                        },
                      },
                    }));
                  }
                } catch (diffErr) {
                  console.warn("Failed to compute queue workflow diff:", diffErr);
                }
                api.upsertQueuePromptMetadata({
                  promptId,
                  workflowLabel: metadataWorkflowLabel,
                  workflowSource: metadataSource ?? undefined,
                  sessionId: sid ?? undefined,
                  clientId: api.clientId,
                  workflowDiff: workflowDiffForMetadata,
                }).catch((metadataErr) => {
                  console.warn("Failed to save mobile queue metadata:", metadataErr);
                });
              }
              // Remember this prompt so an infinite loop can detect a stuck
              // (identical) re-enqueue on the next iteration.
              if (sid) {
                set((s) => ({
                  lastPromptSignatureBySession: {
                    ...s.lastPromptSignatureBySession,
                    [sid]: promptSignature,
                  },
                }));
              }
            } catch {
              // Response body not JSON / already consumed — routing falls back
              // to the active session in the websocket handler.
            }

            // Clear any previous node errors on successful queue
            useWorkflowErrorsStore.getState().clearNodeErrors();
          }
        } catch (err) {
          console.error("Failed to queue prompt:", err);
          useWorkflowErrorsStore
            .getState()
            .setError(
              err instanceof Error ? err.message : "Failed to queue workflow",
            );
        } finally {
          // Keep the submit feedback visible until the queued prompt is
          // observable, instead of flashing back to Run while queue sync lags.
          await useQueueStore.getState().fetchQueue();
          if (liveTarget() === "active") set({ isLoading: false });
          if (sid) {
            set((s) => {
              const next = { ...s.isLoadingBySession };
              delete next[sid];
              return { isLoadingBySession: next };
            });
          }
        }
      };

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
        deleteNode,
        duplicateNode,
        deleteContainer,
        connectNodes,
        disconnectInput,
        setNodeOutput,
        setNodeComparerOutput,
        setNodeTextOutput,
        clearNodeOutputs,
        setLatentPreview,
        clearAllLatentPreviews,
        requestAddNodeModal,
        clearAddNodeModalRequest,
        clearEditContainerLabelRequest,
        toggleBypass,
        bypassAllInContainer,
        updateNodeWidget,
        updateNodeWidgets,
        updateSubgraphInnerNodeWidget,

        updateNodeProperties,

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

// Cache signatures by workflow object reference. The store replaces the
// `workflow` reference on every edit, so a cache hit means "same workflow
// object" — safe to reuse. Parked tabs keep a stable reference across renders,
// so this makes the per-tab dirty check in WorkflowTabline O(1) between edits.
const signatureCache = new WeakMap<Workflow, string>();
const dirtySignatureCache = new WeakMap<Workflow, string>();

/** Structural signature: topology only (ignores widget values), used to key
 *  duration/timing stats so they aggregate across runs that differ only by
 *  seed/prompt. NOT suitable for unsaved-changes detection. */
export function getWorkflowSignature(workflow: Workflow): string {
  const cached = signatureCache.get(workflow);
  if (cached !== undefined) return cached;
  const nodes = [...workflow.nodes]
    .sort((a, b) => a.id - b.id)
    .map((node) => ({
      id: node.id,
      type: node.type,
      mode: node.mode,
      inputs: node.inputs?.map((input) => input.link ?? null) ?? [],
      outputs: node.outputs?.map((output) => output.links ?? []) ?? [],
    }));
  const signature = JSON.stringify({
    nodes,
    links: workflow.links ?? [],
  });
  signatureCache.set(workflow, signature);
  return signature;
}

/** Full content signature including widget values. Used for unsaved-changes
 *  detection so widget-only edits (prompt text, steps, cfg, seed) register. */
function getWorkflowDirtySignature(workflow: Workflow): string {
  const cached = dirtySignatureCache.get(workflow);
  if (cached !== undefined) return cached;
  const signature = JSON.stringify(workflow);
  dirtySignatureCache.set(workflow, signature);
  return signature;
}

/** Whether `workflow` has unsaved changes relative to `original`. Single source
 *  of truth for the tab `*` indicator and close/discard confirmations — must
 *  stay consistent with the structural dirty checks elsewhere in the app. */
export function isWorkflowModified(
  workflow: Workflow | null | undefined,
  original: Workflow | null | undefined,
): boolean {
  if (!workflow || !original) return false;
  return getWorkflowDirtySignature(workflow) !== getWorkflowDirtySignature(original);
}

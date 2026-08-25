import type { HistoryOutputImage, NodeTypes, Workflow } from "@/api/types";
import type { StoreApi } from "zustand/vanilla";
import type { ScopeFrame } from "@/utils/canonicalWorkflowOps";
import type { MobileLayout } from "@/utils/mobileLayout";
import type { SeedMode } from "@/utils/seedUtils";
import type { HierarchicalKey } from "@/utils/workflowHierarchy";
import type { RepositionScrollTarget } from "./layoutOps";

/**
 * Canonical state types for the useWorkflow store: the `WorkflowState`
 * interface, node-output/comparer shapes, `WorkflowSource`, and the session
 * snapshot/saved-state types. Extracted verbatim from `../useWorkflow.ts`
 * and `./sessions.ts` so the runtime modules share one type location
 * without import cycles (mirrors `./metadataNormalization`).
 */

// Internal type alias
export type SeedLastValues = Record<number, number | null>;

// Node output images from execution
export type NodeOutputImage = HistoryOutputImage;

// Output of an Image Comparer node: the two sides to overlay (`a` vs `b`).
export interface NodeComparerOutput {
  a: NodeOutputImage[];
  b: NodeOutputImage[];
  video?: DenoVideoCompareMetadata;
}

export interface DenoVideoCompareAudio {
  filename: string;
  channels: number;
  samples: number;
  sample_rate: number;
  dtype?: string;
  layout?: string;
}

export interface DenoVideoCompareMetadata {
  mode: 'Slider' | 'Side by Side' | 'Difference' | 'Toggle';
  splitPosition: number;
  toggleImage: 'A' | 'B';
  swapped: boolean;
  fps: number;
  sourceFps: number;
  duration: number;
  frameCount: number;
  subfolder: string;
  haveA: boolean;
  haveB: boolean;
  aSourceWidth: number;
  aSourceHeight: number;
  bSourceWidth: number;
  bSourceHeight: number;
  aSourceCount: number;
  bSourceCount: number;
  audioA: DenoVideoCompareAudio | null;
  audioB: DenoVideoCompareAudio | null;
  error?: string;
}

// Track where the workflow was loaded from for reload functionality
export type WorkflowSource = (
  | { type: "user"; filename: string }
  | { type: "history"; promptId: string }
  | { type: "template"; moduleName: string; templateName: string }
  | { type: "file"; filePath: string; assetSource: "output" | "input" | "temp" }
  | { type: "other" }
) & { hidden?: boolean };

// A deferred loadWorkflow call, parked while the user picks which open tab to
// close (when MAX_WORKFLOW_SESSIONS is already reached).
export interface PendingWorkflowOpen {
  workflow: Workflow;
  filename?: string;
  options?: LoadWorkflowOptions;
}

export interface LoadWorkflowOptions {
  fresh?: boolean;
  source?: WorkflowSource;
  replaceActive?: boolean;
  navigate?: boolean;
  pathAliasesResolved?: boolean;
}

// ─── Saved per-file state ─────────────────────────────────────────────────────────────

// Per-node UI state that we want to preserve
export interface SavedNodeState {
  mode?: number; // bypass state
  flags?: { collapsed?: boolean };
  widgets_values?: unknown[] | Record<string, unknown>;
}

// Per-workflow saved state
export interface SavedWorkflowState {
  nodes: Record<number, SavedNodeState>;
  seedModes: Record<number, SeedMode>;
  collapsedItems?: Record<string, boolean>;
  hiddenItems?: Record<string, boolean>;
  bookmarkedItems?: string[];
}

// ─── Session snapshot shape ───────────────────────────────────────────────────────────

// The flat store fields that constitute a single session's state. Everything in
// the store NOT in this list is global (shared across all tabs): nodeTypes,
// savedWorkflowStates, *DurationStats, connectionButtonsVisible, search/modal
// request state, and the session-registry fields themselves.
export const SESSION_STATE_FIELDS = [
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
  "latentPreviewTiles",
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

export type SessionStateField = (typeof SESSION_STATE_FIELDS)[number];

// A parked session's serialized state. Seed maps come from the seed store
// (which always mirrors the *active* session) and are folded in here on park.
export type WorkflowSessionSnapshot = Pick<WorkflowState, SessionStateField> & {
  seedModes: Record<number, SeedMode>;
  seedLastValues: Record<number, number | null>;
};

// Lightweight per-tab descriptor kept in the ordered `sessions` list.
export interface WorkflowSessionMeta {
  id: string;
}

export interface WorkflowState {
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
  // Collapse every Set/Get relay pair into direct connections (A -> Set ~ Get ->
  // D becomes A -> D) and remove the relay nodes. No-op when there are none.
  collapseSetGetNodes: () => void;
  // Duplicate a node (or subgraph placeholder): copies values + incoming
  // connections, leaves outgoing connections blank. Returns the new node ID.
  duplicateNode: (itemKey: HierarchicalKey) => number | null;
  // Paste the shared clipboard's contents into the current scope. When
  // belowNodeKey is given, the pasted nodes are placed directly below that node;
  // otherwise they go to the bottom of the scope. Returns the new node ids.
  pasteClipboard: (belowNodeKey?: HierarchicalKey | null) => number[] | null;
  // Copy a whole container (group or subgraph placeholder) to the clipboard.
  copyContainer: (itemKey: HierarchicalKey) => void;
  // Paste the clipboard into a container: a subgraph's inner scope, or inside a
  // group (the pasted nodes become members). Returns the new node ids.
  pasteIntoContainer: (itemKey: HierarchicalKey) => number[] | null;
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
  addGroupNearNode: (
    nearNodeHierarchicalKey?: HierarchicalKey | null,
    scopeSubgraphId?: string | null,
  ) => HierarchicalKey | null;
  addNodeAndConnect: (
    nodeType: string,
    targetHierarchicalKey: HierarchicalKey,
    targetInputIndex: number,
  ) => number | null;
  // "Pop out" a widget value into a new typed primitive node connected to the
  // widget's input slot. Creates PrimitiveString/Int/Float/Boolean below the
  // node in its scope, seeds its value with the current widget value, and links
  // its output to the input. Returns the new node id, or null if not poppable.
  popWidgetToPrimitive: (
    targetHierarchicalKey: HierarchicalKey,
    inputName: string,
    widgetValue: unknown,
    options?: { title?: string },
  ) => number | null;
  // Ensure a node has a materialized input slot for the named widget-input
  // (creating it from the type definition when absent). Returns the slot index,
  // or null if the node/key can't be resolved.
  ensureWidgetInputSlot: (
    targetHierarchicalKey: HierarchicalKey,
    inputName: string,
    inputType: string,
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
  // Rename a Set/Get relay (its name widget). When the target is a SetNode, every
  // GetNode in the same scope that was reading the OLD name is updated to the new
  // name too, so the wireless Set<->Get link survives the rename.
  renameSetGetNode: (itemKey: HierarchicalKey, newName: string) => void;
  updateSubgraphInnerNodeWidget: (
    subgraphId: string,
    innerNodeId: number,
    innerWidgetIndex: number,
    value: unknown,
    widgetName?: string,
  ) => void;
  updateNodeProperties: (
    itemKey: HierarchicalKey,
    properties: Record<string, unknown>,
  ) => void;
  updateNodeTitle: (itemKey: HierarchicalKey, title: string | null) => void;
  // One-tap conversion between PreviewImage and SaveImage. Both nodes share the
  // same `images` input topology, so existing connections survive — only `type`
  // (and the filename_prefix widget value, which only SaveImage uses) flips.
  convertImageOutputNode: (
    itemKey: HierarchicalKey,
    target: 'PreviewImage' | 'SaveImage',
  ) => void;
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
    queueFront?: boolean,
  ) => Promise<boolean>;
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
  // Batched runs preview every image in the batch, so a node can hold several
  // live previews at once. `latentPreviews` keeps the first of them (every
  // consumer that only has room for one reads it); `latentPreviewTiles` carries
  // the full set, and only exists for keys with more than one. A null entry is
  // a tile whose first frame has not arrived yet — the slot is held so tiles
  // don't reshuffle as the batch fills in.
  latentPreviewTiles: Record<string, (string | null)[]>;
  setLatentPreview: (url: string, itemKey: string | null) => void;
  setLatentPreviewTiles: (urls: (string | null)[], itemKey: string | null) => void;
  clearAllLatentPreviews: () => void;
  // Live latent preview keyed by prompt_id (global, not per-session) so the queue
  // card for an actively-generating prompt can show it — even for a run started
  // in a parked tab. `seq` is a monotonic recency stamp used by the card to
  // decide whether the latest latent or the latest real output is newer.
  // `prevUrl` is the immediately-previous frame, kept alive one extra generation
  // so the queue card never references a revoked blob while React commits the
  // new src (the card reads only `url`/`seq`).
  latentPreviewByPrompt: Record<string, {
    url: string;
    prevUrl?: string;
    seq: number;
    // Present only for a batch: every live preview in the run, in batch order.
    tiles?: (string | null)[];
    prevTiles?: (string | null)[];
  }>;
  setQueueLatentPreview: (promptId: string | null, url: string) => void;
  setQueueLatentPreviewTiles: (promptId: string | null, urls: (string | null)[]) => void;
  clearQueueLatentPreviews: () => void;
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

  // Workflow-panel select-mode bulk operations. Each takes the selected items'
  // hierarchical keys (nodes, subgraph placeholders, and/or group containers).
  // copySelectedItems gathers the selected nodes into a one-shot paste payload;
  // createGroupFromItems wraps the selected nodes in a new group; and
  // deleteSelectedItems removes selected nodes and removes the box of any
  // selected group (its nodes are kept unless individually selected).
  copySelectedItems: (itemKeys: HierarchicalKey[]) => void;
  createGroupFromItems: (itemKeys: HierarchicalKey[]) => void;
  deleteSelectedItems: (itemKeys: HierarchicalKey[]) => void;

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

// Store action factories extracted into sibling modules type their
// `set`/`get` parameters with zustand's own action types.

export type WorkflowGet = () => WorkflowState;
export type WorkflowSet = StoreApi<WorkflowState>["setState"];

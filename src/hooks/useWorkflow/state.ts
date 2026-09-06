import type { HistoryOutputImage, NodeTypes, Workflow } from "@/api/types";
import type { StoreApi } from "zustand/vanilla";
import type { ScopeFrame } from "@/utils/canonicalWorkflowOps";
import type { JumpAlignment } from "@/utils/workflowJumpDom";
import type { WorkflowJumpTarget } from "@/utils/workflowJumpTargets";
import type { MobileLayout } from "@/utils/mobileLayout";
import type { SeedMode } from "@/utils/seedUtils";
import type { HierarchicalKey } from "@/utils/workflowHierarchy";
import type { PromotedWidgetForm } from "@/utils/promotedWidgetForm";
import type { WidgetVariationSpec } from "@/utils/widgetVariations";
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
  /**
   * The filename is app-generated (a pasted-workflow stamp, a history id, an
   * image path) rather than a name the user chose, so Save must ask for a
   * real one instead of writing the placeholder to disk. Defaults to true for
   * history/file sources, which always name themselves.
   */
  filenameIsPlaceholder?: boolean;
  /** Executed API prompt embedded alongside an output workflow, when available. */
  executedPrompt?: unknown;
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
  "workflowPanelScrollTops",
  "currentFilename",
  "filenameIsPlaceholder",
  "currentWorkflowKey",
  "currentLineageId",
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
  // Per-session workflow panel scroll positions. Root and each subgraph
  // definition keep independent positions so instances of one type share it.
  workflowPanelScrollTops: Record<string, number>;
  currentFilename: string | null;
  // True when currentFilename is an app-generated stand-in rather than a name
  // the user picked; Save then behaves as Save-As (see WorkflowTopBarControls).
  filenameIsPlaceholder: boolean;
  currentWorkflowKey: string | null;
  // Lineage (workflow family) this tab's workflow belongs to. Resolved on
  // load; null until the registry has seen this structure.
  currentLineageId: string | null;
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
  // Duplicate a group and its direct contents without changing the clipboard.
  duplicateContainer: (itemKey: HierarchicalKey) => number[] | null;
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
  // Boundary (subgraph input/output slot) link editing. Only meaningful inside
  // a subgraph scope; all three no-op at root. connectBoundaryInput replaces
  // subgraph input slot `slotIndex`'s whole fan-out with the given inner input
  // targets; connectBoundaryOutput sets (or, with null, clears) the single
  // inner output feeding subgraph output slot `slotIndex`.
  connectBoundaryInput: (
    slotIndex: number,
    targets: Array<{ nodeKey: HierarchicalKey; inputSlot: number }>,
  ) => void;
  connectBoundaryOutput: (
    slotIndex: number,
    source: { nodeKey: HierarchicalKey; outputSlot: number } | null,
  ) => void;
  disconnectBoundaryLink: (
    direction: "input" | "output",
    slotIndex: number,
    innerNodeId: number,
    innerSlot: number,
  ) => void;
  // Promote an inner slot into a new boundary slot of the current subgraph,
  // appended to the definition's boundary list, and wire it to that slot.
  // Every placeholder instance gains the matching slot.
  addBoundaryInput: (target: { nodeKey: HierarchicalKey; inputSlot: number }) => void;
  addBoundaryOutput: (source: { nodeKey: HierarchicalKey; outputSlot: number }) => void;
  // Promote one widget on a node in the current subgraph scope. This also
  // materializes widget-only inputs that are absent from the serialized node.
  promoteWidget: (
    target: {
      nodeKey: HierarchicalKey;
      inputName: string;
      inputType: string;
      value: unknown;
    },
    // "widget" (the default) draws an editable control on the placeholder and
    // gives every instance its own value; "input" exposes a plain socket and
    // leaves the value on the inner node, shared by the type.
    options?: { form?: PromotedWidgetForm },
  ) => boolean;
  // Switch an already-promoted widget between those two forms, keeping the
  // boundary slot and anything wired to it.
  setPromotedWidgetForm: (
    target: { nodeKey: HierarchicalKey; inputName: string },
    form: PromotedWidgetForm,
  ) => boolean;
  // Undo a promotion: drop the boundary slot and its link, and return the
  // widget to the inner node holding the value it was showing.
  demoteWidget: (target: { nodeKey: HierarchicalKey; inputName: string }) => boolean;
  // Rename a widget's label on one node, stored as the input slot's `label`
  // the way the desktop frontend stores it. A blank label clears the override.
  setWidgetLabel: (
    nodeKey: HierarchicalKey,
    inputName: string,
    label: string,
  ) => boolean;
  // Move a boundary slot within the definition's list. Every instance follows,
  // values included — widgets_values is positional, so the order and the values
  // have to move together.
  // `subgraphId` names the definition when the edit comes from a placeholder
  // outside it; without one the subgraph on screen is the target.
  moveBoundarySlot: (
    direction: "input" | "output",
    fromIndex: number,
    toIndex: number,
    options?: { subgraphId?: string },
  ) => boolean;
  // Demote a boundary slot: drop it, its links, and — for a widget-backed
  // input — the widgets_values entry it owns on every instance.
  removeBoundarySlot: (
    direction: "input" | "output",
    slotIndex: number,
    options?: { subgraphId?: string },
  ) => void;
  // Rename a boundary slot, either on the DEFINITION (every instance of the
  // type) or on the ONE instance the current scope was entered through. Blank
  // clears the label at that level, falling back to the level beneath it.
  setBoundarySlotLabel: (
    direction: "input" | "output",
    slotIndex: number,
    label: string,
    scope: "definition" | "instance",
    // Named when the rename comes from a placeholder card rather than from
    // inside the subgraph, where the scope stack supplies both.
    options?: { subgraphId?: string; instanceNodeId?: number },
  ) => void;
  // Set (or clear, with an empty string) a promoted widget's label on the
  // DEFINITION, shared by every instance of the subgraph type; the {n} token
  // interpolates each instance's number at render time. 'slot' covers both
  // slot-promoted and boundary-only widgets (the definition's boundary input
  // entry, matched by name); 'proxy' targets a proxyWidgets entry.
  setPromotedWidgetLabel: (
    subgraphId: string,
    target:
      | { kind: "slot"; slotName: string }
      | { kind: "proxy"; innerNodeId: number; widgetName: string },
    label: string,
  ) => void;
  // The same edit, applied to ONE placeholder instead of the type: the label
  // lands in that placeholder's own properties, where the definition rebuild
  // cannot overwrite it (see utils/boundarySlotLabels).
  setInstanceWidgetLabel: (
    itemKey: HierarchicalKey,
    target:
      | { kind: "slot"; direction: "input" | "output"; slotName: string }
      | { kind: "proxy"; innerNodeId: number; widgetName: string },
    label: string,
  ) => void;
  // "Fork Subgraph": copy the type into a new one and move the chosen instances
  // onto it, so they can be changed without touching the instances left behind.
  // Returns the new type's id, or null if nothing was forked.
  forkSubgraphType: (
    subgraphId: string,
    instanceNodeIds: number[],
    name: string,
  ) => string | null;
  // Rename a subgraph type (the definition name — every instance follows).
  renameSubgraphType: (subgraphId: string, name: string) => void;
  // Delete a subgraph type. With instances present, `mode` decides their fate:
  // 'dissolve' promotes each instance's inner nodes into its parent scope,
  // 'delete' removes the instances outright. The definition (and any nested
  // definition only it referenced) is collected either way.
  deleteSubgraphType: (subgraphId: string, mode: "dissolve" | "delete") => void;
  // "Replace Subgraph": swap the placeholder for an instance of definition
  // `newDefId`, rewiring matching slots (name-then-type). Returns
  // the dropped-connection summary, or null when nothing was replaced.
  replaceSubgraphInstance: (
    itemKey: HierarchicalKey,
    newDefId: string,
  ) => Array<{
    direction: "input" | "output";
    slotName: string;
    slotType: string;
    peerNodeTitle: string;
  }> | null;
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
  // Power Puter (rgthree): its outputs widget doubles as the node's output slot
  // list, so setting it also rebuilds `node.outputs` and drops the links that
  // any removed slot was carrying. See `setPowerPuterOutputs` in nodeControl.ts.
  setPowerPuterOutputs: (
    itemKey: HierarchicalKey,
    widgetIndex: number,
    outputs: string[],
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
  /**
   * Go to anything in the workflow: travel to its scope, reveal it, scroll it
   * into view, flash it. One entry point so every jump behaves the same, and so
   * a new kind of destination is a new case here rather than a new code path.
   */
  jumpToWorkflowItem: (
    target: WorkflowJumpTarget,
    options?: {
      label?: string;
      alsoFlashDomId?: string | null;
      /** Where the target lands in the panel; defaults to the top. */
      align?: JumpAlignment;
    },
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
    /**
     * Vary one combo widget across the enqueued runs — `count` must equal
     * `variations.values.length`. Seed modes are ignored for the whole batch so
     * the varied widget is the only thing that differs between runs, and the
     * variation is never written back into the session's workflow.
     */
    variations?: WidgetVariationSpec,
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
  // Wrap the selection in a new subgraph, its boundary taken from whatever the
  // selected nodes were already connected to. Returns what was made, so the
  // caller can say so and jump to it; null when nothing was selectable.
  // Move the selection into a subgraph already in this scope. Slots the moved
  // nodes made redundant are removed and slots their remaining outside links
  // need are added; with a shared type that changes it for every instance,
  // which the caller is expected to have offered to fork away from first.
  moveItemsIntoSubgraph: (
    itemKeys: HierarchicalKey[],
    placeholderItemKey: HierarchicalKey,
  ) => {
    removedInputs: number;
    removedOutputs: number;
    addedInputs: number;
    addedOutputs: number;
    /**
     * Nodes that fed OTHER instances through a slot this move retired. Their
     * values have already been copied onto those instances; these are now
     * feeding nothing, so the caller may offer to remove them. A node still
     * feeding something else is deliberately absent.
     */
    harvestedFrom: number[];
  } | null;
  // Delete root nodes whose value a move already carried onto a placeholder.
  // Returns how many were actually removed; anything still feeding something is
  // refused rather than silently cutting a live connection.
  removeHarvestedNodes: (nodeIds: number[]) => number;
  // Move a one-sided terminal node from a subgraph definition to root. Source
  // terminals become one shared root node; sink terminals become one root
  // clone per concrete instance path.
  popNodeOutToRoot: (
    itemKey: HierarchicalKey,
  ) => { kind: "source" | "sink"; rootNodeIds: number[] } | null;
  createSubgraphFromItems: (
    itemKeys: HierarchicalKey[],
    name: string,
  ) => {
    subgraphId: string;
    placeholderItemKey: HierarchicalKey | null;
    inputCount: number;
    outputCount: number;
  } | null;
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
  // Switch which instance of the current subgraph type the boundary is read
  // through, without leaving the subgraph. Rebuilds the whole trail when the
  // chosen instance lives in a different parent scope.
  setScopeInstance: (placeholderNodeId: number) => void;
  exitToRoot: () => void;
  /** Pop the scope stack to exactly `depth` frames (1 = root). No-op if already at or above target. */
  exitToDepth: (depth: number) => void;
  navigateToSubgraphTrail: (subgraphIds: string[]) => boolean;
  // Move to an already-resolved scope trail (see findScopeTrailForPlaceholder),
  // used when travelling to a node in another instance's parent scope.
  setScopeTrail: (trail: ScopeFrame[]) => void;
}

// Store action factories extracted into sibling modules type their
// `set`/`get` parameters with zustand's own action types.

export type WorkflowGet = () => WorkflowState;
export type WorkflowSet = StoreApi<WorkflowState>["setState"];

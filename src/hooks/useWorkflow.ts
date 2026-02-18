import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  HistoryOutputImage,
  Workflow,
  WorkflowGroup,
  WorkflowNode,
  WorkflowSubgraphDefinition,
  NodeTypes,
} from "@/api/types";
import { useImageViewerStore } from "@/hooks/useImageViewer";
import {
  useWorkflowErrorsStore,
  type NodeError,
} from "@/hooks/useWorkflowErrors";
import * as api from "@/api/client";
import { useQueueStore } from "@/hooks/useQueue";
import { useNavigationStore } from "@/hooks/useNavigation";
import { usePinnedWidgetStore } from "@/hooks/usePinnedWidget";
import { useSeedStore } from "@/hooks/useSeed";
import {
  buildWorkflowPromptInputs,
  getWorkflowWidgetIndexMap,
  getWidgetValue,
  normalizeWidgetValue,
  resolveComboOption,
} from "@/utils/workflowInputs";
import { buildWorkflowCacheKey } from "@/utils/workflowCacheKey";
import { expandWorkflowSubgraphs } from "@/utils/expandWorkflowSubgraphs";
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
  resolveSpecialSeedToUse,
} from "@/utils/seedUtils";
import {
  getWidgetDefinitions,
  getInputWidgetDefinitions,
} from "@/utils/widgetDefinitions";
import { findConnectedNode, orderNodesForMobile } from "@/utils/nodeOrdering";
import { areTypesCompatible } from "@/utils/connectionUtils";
import {
  type ItemRef,
  type MobileLayout,
  type ContainerId,
  createEmptyMobileLayout,
  buildDefaultLayout,
  flattenLayoutToNodeOrder,
  makeLocationPointer,
  parseLocationPointer,
  findItemInLayout,
  removeNodeFromLayout,
  addNodeToLayout,
  removeGroupFromLayoutByKey,
} from "@/utils/mobileLayout";
import {
  clampPositionToGroup,
  getBottomPlacement,
  getPositionNearNode,
} from "@/utils/nodePositioning";
import { computeNodeGroupsFor } from "@/utils/nodeGroups";
import { findLayoutPath } from "@/utils/layoutTraversal";

// Re-export utilities for external consumers
export type { SeedMode };
export type { MobileLayout } from "@/utils/mobileLayout";
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
};

// Internal type alias
type SeedModeType = SeedMode;
type SeedLastValues = Record<number, number | null>;
type StableKey = string;
type RepositionScrollTarget =
  | { type: "node"; id: number }
  | { type: "group"; id: number; subgraphId: string | null }
  | { type: "subgraph"; id: string };
type MobileOrigin =
  | { scope: "root"; nodeId: number }
  | { scope: "subgraph"; subgraphId: string; nodeId: number };
const MOBILE_ORIGIN_KEY = "__mobile_origin";
const MOBILE_SUBGRAPH_GROUP_MAP_KEY = "__mobile_subgraph_group_map";
let addNodeModalRequestId = 0;

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

function createStableKey(): StableKey {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `sk_${crypto.randomUUID()}`;
  }
  return `sk_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function collectLayoutObjectKeys(layout: MobileLayout): string[] {
  const keys: string[] = [];
  const visitedGroups = new Set<string>();
  const visitedSubgraphs = new Set<string>();
  const visit = (refs: ItemRef[], currentSubgraphId: string | null) => {
    for (const ref of refs) {
      if (ref.type === "node") {
        keys.push(
          makeLocationPointer({
            type: "node",
            nodeId: ref.id,
            subgraphId: currentSubgraphId,
          }),
        );
        continue;
      }
      if (ref.type === "group") {
        keys.push(ref.stableKey);
        if (visitedGroups.has(ref.stableKey)) continue;
        visitedGroups.add(ref.stableKey);
        visit(layout.groups[ref.stableKey] ?? [], currentSubgraphId);
        continue;
      }
      if (ref.type === "subgraph") {
        const sgKey = makeLocationPointer({ type: "subgraph", subgraphId: ref.id });
        keys.push(sgKey);
        if (visitedSubgraphs.has(ref.id)) continue;
        visitedSubgraphs.add(ref.id);
        visit(layout.subgraphs[ref.id] ?? [], ref.id);
      }
    }
  };
  visit(layout.root, null);
  return keys;
}

function pointerIdentityHint(pointer: string): string {
  const parsed = parseLocationPointer(pointer);
  if (!parsed) return `unknown:${pointer}`;
  if (parsed.type === "node") return `node:${parsed.nodeId}`;
  if (parsed.type === "group")
    return `group:${parsed.subgraphId ?? "root"}:${parsed.groupId}`;
  return `subgraph:${parsed.subgraphId}`;
}

function reconcileStableRegistry(
  layout: MobileLayout,
  prevLayoutToStable: Record<string, StableKey>,
  prevStableToLayout: Record<StableKey, string>,
): {
  layoutToStable: Record<string, StableKey>;
  stableToLayout: Record<StableKey, string>;
} {
  const nextPointers = collectLayoutObjectKeys(layout);
  const hintToStable = new Map<string, StableKey[]>();
  for (const [stableKey, pointer] of Object.entries(prevStableToLayout)) {
    const hint = pointerIdentityHint(pointer);
    const bucket = hintToStable.get(hint) ?? [];
    bucket.push(stableKey);
    hintToStable.set(hint, bucket);
  }

  const usedStable = new Set<StableKey>();
  const layoutToStable: Record<string, StableKey> = {};
  const stableToLayout: Record<StableKey, string> = {};

  for (const pointer of nextPointers) {
    let stableKey: StableKey | undefined = prevLayoutToStable[pointer];
    if (stableKey && usedStable.has(stableKey)) {
      stableKey = undefined;
    }
    if (!stableKey) {
      const hint = pointerIdentityHint(pointer);
      const bucket = hintToStable.get(hint) ?? [];
      while (bucket.length > 0) {
        const candidate = bucket.shift();
        if (!candidate || usedStable.has(candidate)) continue;
        stableKey = candidate;
        break;
      }
      hintToStable.set(hint, bucket);
    }
    if (!stableKey) {
      stableKey = createStableKey();
    }
    usedStable.add(stableKey);
    layoutToStable[pointer] = stableKey;
    stableToLayout[stableKey] = pointer;
  }

  return { layoutToStable, stableToLayout };
}

function layoutMatchesWorkflowNodes(
  layout: MobileLayout,
  workflow: Workflow,
): boolean {
  const workflowNodeIds = new Set(workflow.nodes.map((node) => node.id));
  const layoutNodeIds = new Set(flattenLayoutToNodeOrder(layout));
  if (workflowNodeIds.size !== layoutNodeIds.size) return false;
  for (const nodeId of workflowNodeIds) {
    if (!layoutNodeIds.has(nodeId)) return false;
  }
  return true;
}

function nodeStateKey(
  nodeId: number,
  subgraphId: string | null = null,
): string {
  return makeLocationPointer({ type: "node", nodeId, subgraphId });
}

function getNodeStateKeyForNode(node: WorkflowNode): string {
  const origin = getMobileOrigin(node);
  return nodeStateKey(
    node.id,
    origin?.scope === "subgraph" ? origin.subgraphId : null,
  );
}

const nodeStateKeyIndexCache = new WeakMap<Workflow, Map<number, string[]>>();

function getNodeStateKeyIndex(workflow: Workflow): Map<number, string[]> {
  const cached = nodeStateKeyIndexCache.get(workflow);
  if (cached) return cached;

  const index = new Map<number, string[]>();
  for (const node of workflow.nodes) {
    const key = getNodeStateKeyForNode(node);
    const bucket = index.get(node.id);
    if (bucket) {
      if (!bucket.includes(key)) bucket.push(key);
    } else {
      index.set(node.id, [key]);
    }
  }
  nodeStateKeyIndexCache.set(workflow, index);
  return index;
}

function collectNodeStateKeys(
  workflow: Workflow,
  nodeId: number,
  subgraphId: string | null = null,
): string[] {
  if (subgraphId != null) {
    return [nodeStateKey(nodeId, subgraphId)];
  }

  const keys = getNodeStateKeyIndex(workflow).get(nodeId) ?? [];

  if (keys.length > 0) {
    return [...keys];
  }
  return [nodeStateKey(nodeId, null)];
}

function normalizeManuallyHiddenNodeKeys(
  workflow: Workflow,
  hiddenItems: Record<string, boolean> | undefined,
): Record<string, boolean> {
  if (!hiddenItems) return {};
  const normalized: Record<string, boolean> = {};
  for (const [key, hidden] of Object.entries(hiddenItems)) {
    if (!hidden) continue;
    if (key.includes(":node:") || key.includes("/node:")) {
      const parsed = parseLocationPointer(key);
      if (parsed?.type === "node") {
        normalized[nodeStateKey(parsed.nodeId, parsed.subgraphId)] = true;
        continue;
      }
      const legacy = key.match(/^(root|subgraph:(.*)):node:(\d+)$/);
      if (!legacy) continue;
      const nodeId = Number(legacy[3]);
      if (!Number.isFinite(nodeId)) continue;
      normalized[
        nodeStateKey(nodeId, legacy[1] === "root" ? null : (legacy[2] ?? null))
      ] = true;
      continue;
    }
    const legacyNodeId = Number(key);
    if (!Number.isFinite(legacyNodeId)) continue;
    for (const nodeKey of collectNodeStateKeys(workflow, legacyNodeId)) {
      normalized[nodeKey] = true;
    }
  }
  return normalized;
}

function normalizeMobileLayoutGroupKeys(layout: MobileLayout): MobileLayout {
  const normalizeRefs = (refs: ItemRef[]): ItemRef[] =>
    refs.map((ref) => {
      if (ref.type !== "group") return ref;
      return {
        ...ref,
      };
    });

  const nextGroups: Record<string, ItemRef[]> = {};
  for (const [groupKey, refs] of Object.entries(layout.groups)) {
    const normalizedKey = groupKey;
    const normalizedRefs = normalizeRefs(refs);
    if (nextGroups[normalizedKey]) {
      nextGroups[normalizedKey] = [
        ...nextGroups[normalizedKey],
        ...normalizedRefs,
      ];
    } else {
      nextGroups[normalizedKey] = normalizedRefs;
    }
  }

  const nextSubgraphs: Record<string, ItemRef[]> = {};
  for (const [subgraphId, refs] of Object.entries(layout.subgraphs)) {
    nextSubgraphs[subgraphId] = normalizeRefs(refs);
  }

  return {
    ...layout,
    root: normalizeRefs(layout.root),
    groups: nextGroups,
    subgraphs: nextSubgraphs,
  };
}

function collectGroupStableKeys(
  layout: MobileLayout,
  groupId: number,
  subgraphId: string | null = null,
): string[] {
  const keys = new Set<string>();
  const visit = (refs: ItemRef[], currentSubgraphId: string | null) => {
    for (const ref of refs) {
      if (ref.type === "group") {
        if (ref.id === groupId && currentSubgraphId === subgraphId) {
          keys.add(ref.stableKey);
        }
        visit(layout.groups[ref.stableKey] ?? [], currentSubgraphId);
      } else if (ref.type === "subgraph") {
        visit(layout.subgraphs[ref.id] ?? [], ref.id);
      }
    }
  };
  visit(layout.root, null);
  return [...keys];
}

function toStableKey(
  pointer: string,
  stableKeyByPointer: Record<string, StableKey>,
): StableKey | null {
  return stableKeyByPointer[pointer] ?? null;
}

function toStableKeys(
  pointers: string[],
  stableKeyByPointer: Record<string, StableKey>,
): StableKey[] {
  const seen = new Set<StableKey>();
  const keys: StableKey[] = [];
  for (const pointer of pointers) {
    const stableKey = toStableKey(pointer, stableKeyByPointer);
    if (!stableKey || seen.has(stableKey)) continue;
    seen.add(stableKey);
    keys.push(stableKey);
  }
  return keys;
}

function collectNodeStableKeysFromRegistry(
  stableKeyByPointer: Record<string, StableKey>,
  nodeId: number,
  subgraphId: string | null = null,
): StableKey[] {
  const keys: StableKey[] = [];
  const seen = new Set<StableKey>();
  for (const [pointer, stableKey] of Object.entries(stableKeyByPointer)) {
    if (seen.has(stableKey)) continue;
    const parsed = parseLocationPointer(pointer);
    if (parsed?.type !== "node") continue;
    if (parsed.nodeId !== nodeId) continue;
    if (subgraphId !== null && parsed.subgraphId !== subgraphId) continue;
    seen.add(stableKey);
    keys.push(stableKey);
  }
  return keys;
}

function collectNodeStableKeys(
  workflow: Workflow,
  stableKeyByPointer: Record<string, StableKey>,
  nodeId: number,
  subgraphId: string | null = null,
): StableKey[] {
  const keys = collectNodeStableKeysFromRegistry(
    stableKeyByPointer,
    nodeId,
    subgraphId,
  );
  if (keys.length > 0) return keys;
  return toStableKeys(
    collectNodeStateKeys(workflow, nodeId, subgraphId),
    stableKeyByPointer,
  );
}

function resolveNodeIdentityFromStableKey(
  workflow: Workflow,
  stableKey: StableKey,
  _pointerByStableKey?: Record<string, string>,
): { nodeId: number; subgraphId: string | null } | null {
  void _pointerByStableKey;
  const node = workflow.nodes.find((entry) => entry.stableKey === stableKey);
  if (node) {
    const origin = getMobileOrigin(node);
    return {
      nodeId: node.id,
      subgraphId: origin?.scope === "subgraph" ? origin.subgraphId : null,
    };
  }
  return null;
}

type ContainerIdentity =
  | { type: "group"; groupId: number; subgraphId: string | null; stableKey: StableKey }
  | { type: "subgraph"; subgraphId: string; stableKey: StableKey };

function resolveContainerIdentityFromStableKey(
  workflow: Workflow,
  stableKey: StableKey,
  _pointerByStableKey?: Record<string, string>,
): ContainerIdentity | null {
  void _pointerByStableKey;
  const rootGroup = (workflow.groups ?? []).find((group) => group.stableKey === stableKey);
  if (rootGroup) {
    return {
      type: "group",
      groupId: rootGroup.id,
      subgraphId: null,
      stableKey,
    };
  }

  for (const subgraph of workflow.definitions?.subgraphs ?? []) {
    if (subgraph.stableKey === stableKey) {
      return {
        type: "subgraph",
        subgraphId: subgraph.id,
        stableKey,
      };
    }
    const nestedGroup = (subgraph.groups ?? []).find((group) => group.stableKey === stableKey);
    if (nestedGroup) {
      return {
        type: "group",
        groupId: nestedGroup.id,
        subgraphId: subgraph.id,
        stableKey,
      };
    }
  }

  return null;
}

function findSubgraphStableKey(
  workflow: Workflow,
  subgraphId: string,
): StableKey | null {
  const subgraph = (workflow.definitions?.subgraphs ?? []).find(
    (entry) => entry.id === subgraphId,
  );
  return subgraph?.stableKey ?? null;
}

function findGroupSubgraphIdByStableKey(
  layout: MobileLayout,
  groupStableKey: string,
): string | null {
  const parent = layout.groupParents?.[groupStableKey];
  if (!parent) return null;
  if (parent.scope === "subgraph") return parent.subgraphId;
  if (parent.scope === "root") return null;
  return findGroupSubgraphIdByStableKey(layout, parent.groupKey);
}

function stableRecordFromLayoutRecord(
  layoutState: Record<string, boolean> | undefined,
  stableKeyByPointer: Record<string, StableKey>,
): Record<string, boolean> {
  if (!layoutState) return {};
  const next: Record<string, boolean> = {};
  for (const [pointer, value] of Object.entries(layoutState)) {
    if (!value) continue;
    const stableKey = toStableKey(pointer, stableKeyByPointer);
    if (!stableKey) continue;
    next[stableKey] = true;
  }
  return next;
}

function stableCollapsedRecordFromLayoutRecord(
  layoutState: Record<string, boolean> | undefined,
  stableKeyByPointer: Record<string, StableKey>,
): Record<string, boolean> {
  if (!layoutState) return {};
  const next: Record<string, boolean> = {};
  for (const [pointer, value] of Object.entries(layoutState)) {
    if (value !== true) continue;
    const stableKey = toStableKey(pointer, stableKeyByPointer);
    if (!stableKey) continue;
    next[stableKey] = true;
  }
  return next;
}

function normalizeStableBooleanRecord(
  state: Record<string, boolean> | undefined,
  stableKeyByPointer: Record<string, StableKey>,
  pointerByStableKey: Record<string, string>,
): Record<string, boolean> {
  if (!state) return {};
  const next: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(state)) {
    if (!value) continue;
    if (pointerByStableKey[key]) {
      next[key] = true;
      continue;
    }
    const stableKey = stableKeyByPointer[key];
    if (!stableKey) continue;
    next[stableKey] = true;
  }
  return next;
}

function normalizeStableCollapsedRecord(
  state: Record<string, boolean> | undefined,
  stableKeyByPointer: Record<string, StableKey>,
  pointerByStableKey: Record<string, string>,
): Record<string, boolean> {
  if (!state) return {};
  const next: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(state)) {
    if (value !== true) continue;
    if (pointerByStableKey[key]) {
      next[key] = true;
      continue;
    }
    const stableKey = stableKeyByPointer[key];
    if (!stableKey) continue;
    next[stableKey] = true;
  }
  return next;
}

function layoutRecordFromStableRecord(
  state: Record<string, boolean> | undefined,
  pointerByStableKey: Record<string, string>,
): Record<string, boolean> {
  if (!state) return {};
  const next: Record<string, boolean> = {};
  for (const [stableKey, value] of Object.entries(state)) {
    if (!value) continue;
    const pointer = pointerByStableKey[stableKey];
    if (!pointer) continue;
    next[pointer] = true;
  }
  return next;
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

// Track where the workflow was loaded from for reload functionality
export type WorkflowSource =
  | { type: "user"; filename: string }
  | { type: "history"; promptId: string }
  | { type: "template"; moduleName: string; templateName: string }
  | { type: "other" };

interface WorkflowState {
  // Workflow source tracking for reload functionality
  workflowSource: WorkflowSource | null;

  // Workflow data
  workflow: Workflow | null;
  embedWorkflow: Workflow | null;
  originalWorkflow: Workflow | null; // For dirty check
  currentFilename: string | null;
  currentWorkflowKey: string | null;
  nodeTypes: NodeTypes | null;
  isLoading: boolean;

  // Per-workflow saved states (keyed by deterministic workflow cache key)
  savedWorkflowStates: Record<string, SavedWorkflowState>;

  // Execution state
  isExecuting: boolean;
  executingNodeId: string | null;
  executingPromptId: string | null; // Track the ID of the prompt being executed
  progress: number;
  executionStartTime: number | null;
  currentNodeStartTime: number | null;
  nodeDurationStats: Record<string, { avgMs: number; count: number }>;
  workflowDurationStats: Record<string, { avgMs: number; count: number }>;

  // Node output images (keyed by node ID)
  nodeOutputs: Record<string, NodeOutputImage[]>;
  // Node text output previews (keyed by node ID)
  nodeTextOutputs: Record<string, string>;
  // Prompt output images (keyed by prompt ID)
  promptOutputs: Record<string, HistoryOutputImage[]>;
  runCount: number;
  followQueue: boolean;
  workflowLoadedAt: number;
  connectionHighlightModes: Record<
    number,
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

  // Collapse/visibility state
  collapsedItems: Record<string, boolean>;
  hiddenItems: Record<string, boolean>;
  stableKeyByPointer: Record<string, StableKey>;
  pointerByStableKey: Record<StableKey, string>;

  // Actions
  deleteNode: (stableKey: StableKey, reconnect: boolean) => void;
  connectNodes: (
    srcStableKey: StableKey,
    srcSlot: number,
    tgtStableKey: StableKey,
    tgtSlot: number,
    type: string,
  ) => void;
  disconnectInput: (stableKey: StableKey, inputIndex: number) => void;
  addNode: (
    nodeType: string,
    options?: {
      nearNodeStableKey?: StableKey;
      inGroupId?: number;
      inSubgraphId?: string;
    },
  ) => number | null;
  addNodeAndConnect: (
    nodeType: string,
    targetStableKey: StableKey,
    targetInputIndex: number,
  ) => number | null;
  mobileLayout: MobileLayout;
  setMobileLayout: (layout: MobileLayout) => void;
  loadWorkflow: (
    workflow: Workflow,
    filename?: string,
    options?: { fresh?: boolean; source?: WorkflowSource },
  ) => void;
  unloadWorkflow: () => void;
  setSavedWorkflow: (workflow: Workflow, filename: string) => void;
  updateNodeWidget: (
    stableKey: StableKey,
    widgetIndex: number,
    value: unknown,
    widgetName?: string,
  ) => void;
  updateNodeWidgets: (
    stableKey: StableKey,
    updates: Record<number, unknown>,
  ) => void;
  updateNodeTitle: (stableKey: StableKey, title: string | null) => void;
  toggleBypass: (stableKey: StableKey) => void;
  scrollToNode: (stableKey: StableKey, label?: string) => void;
  setNodeTypes: (types: NodeTypes) => void;
  setExecutionState: (
    executing: boolean,
    stableKey: StableKey | null,
    promptId: string | null,
    progress: number,
  ) => void;
  queueWorkflow: (count: number) => Promise<void>;
  saveCurrentWorkflowState: () => void;
  setNodeOutput: (stableKey: StableKey, images: NodeOutputImage[]) => void;
  setNodeTextOutput: (stableKey: StableKey, text: string) => void;
  clearNodeOutputs: () => void;
  addPromptOutputs: (promptId: string, images: HistoryOutputImage[]) => void;
  clearPromptOutputs: (promptId?: string) => void;
  setRunCount: (count: number) => void;
  setFollowQueue: (followQueue: boolean) => void;
  cycleConnectionHighlight: (stableKey: StableKey) => void;
  setConnectionHighlightMode: (
    stableKey: StableKey,
    mode: "off" | "inputs" | "outputs" | "both",
  ) => void;
  toggleConnectionButtonsVisible: () => void;
  setItemHidden: (stableKey: StableKey, hidden: boolean) => void;
  revealNodeWithParents: (stableKey: StableKey) => void;
  showAllHiddenNodes: () => void;

  setItemCollapsed: (stableKey: StableKey, collapsed: boolean) => void;
  bypassAllInContainer: (stableKey: StableKey, bypass: boolean) => void;

  deleteContainer: (
    stableKey: StableKey,
    options?: { deleteNodes?: boolean },
  ) => void;

  updateContainerTitle: (stableKey: StableKey, title: string) => void;

  setSearchQuery: (query: string) => void;
  setSearchOpen: (open: boolean) => void;
  requestAddNodeModal: (options?: {
    groupId?: number | null;
    subgraphId?: string | null;
  }) => void;
  clearAddNodeModalRequest: () => void;
  prepareRepositionScrollTarget: (target: RepositionScrollTarget) => void;
  updateWorkflowDuration: (signature: string, durationMs: number) => void;
  clearWorkflowCache: () => void;
  applyControlAfterGenerate: () => void;
}

function normalizeWorkflowNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node) => ({
    ...node,
    widgets_values: node.widgets_values ?? [],
    inputs: node.inputs ?? [],
    outputs: node.outputs ?? [],
    flags: node.flags ?? {},
    properties: node.properties ?? {},
    mode: node.mode ?? 0,
    order: node.order ?? 0,
  }));
}

function normalizeWorkflowForEmbed(workflow: Workflow): Workflow {
  const cloned = JSON.parse(JSON.stringify(workflow)) as Workflow;
  cloned.nodes = normalizeWorkflowNodes(cloned.nodes ?? []);
  cloned.links = cloned.links ?? [];
  cloned.groups = cloned.groups ?? [];
  cloned.config = cloned.config ?? {};
  if (cloned.definitions?.subgraphs) {
    cloned.definitions.subgraphs = cloned.definitions.subgraphs.map(
      (subgraph) => ({
        ...subgraph,
        nodes: normalizeWorkflowNodes(subgraph.nodes ?? []),
        links: subgraph.links ?? [],
      }),
    );
  }
  cloned.last_node_id =
    cloned.last_node_id ?? Math.max(0, ...cloned.nodes.map((n) => n.id));
  cloned.last_link_id = cloned.last_link_id ?? 0;
  cloned.version = cloned.version ?? 0.4;
  return cloned;
}

function stripNodeClientMetadata(node: WorkflowNode): WorkflowNode {
  if (!("stableKey" in node)) return node;
  const { stableKey, ...rest } = node;
  void stableKey;
  return rest as WorkflowNode;
}

function stripGroupClientMetadata(group: WorkflowGroup): WorkflowGroup {
  if (!("stableKey" in group)) return group;
  const { stableKey, ...rest } = group;
  void stableKey;
  return rest as WorkflowGroup;
}

export function stripWorkflowClientMetadata(workflow: Workflow): Workflow {
  const nextNodes = workflow.nodes.map(stripNodeClientMetadata);
  const nextGroups = (workflow.groups ?? []).map(stripGroupClientMetadata);
  const hadRootStableKeys =
    nextNodes.some((node, index) => node !== workflow.nodes[index]) ||
    nextGroups.some((group, index) => group !== (workflow.groups ?? [])[index]);
  const subgraphs = workflow.definitions?.subgraphs;
  if (!subgraphs) {
    return hadRootStableKeys
      ? { ...workflow, nodes: nextNodes, groups: nextGroups }
      : workflow;
  }

  let subgraphChanged = false;
  const nextSubgraphs = subgraphs.map((subgraph) => {
    const cleanedNodes = subgraph.nodes.map(stripNodeClientMetadata);
    const cleanedGroups = (subgraph.groups ?? []).map(stripGroupClientMetadata);
    let changed =
      cleanedNodes.some((node, index) => node !== subgraph.nodes[index]) ||
      cleanedGroups.some((group, index) => group !== (subgraph.groups ?? [])[index]);
    if (subgraph.stableKey != null) changed = true;
    if (!changed) return subgraph;
    subgraphChanged = true;
    const { stableKey, ...subgraphRest } = subgraph;
    void stableKey;
    return { ...subgraphRest, nodes: cleanedNodes, groups: cleanedGroups };
  });

  if (!hadRootStableKeys && !subgraphChanged) return workflow;

  return {
    ...workflow,
    nodes: nextNodes,
    groups: nextGroups,
    definitions: {
      ...(workflow.definitions ?? {}),
      subgraphs: nextSubgraphs,
    },
  };
}

function getMobileOrigin(node: WorkflowNode | undefined): MobileOrigin | null {
  if (!node) return null;
  const props = node.properties as Record<string, unknown> | undefined;
  const origin = props?.[MOBILE_ORIGIN_KEY];
  if (!origin || typeof origin !== "object") return null;
  const scope = (origin as { scope?: string }).scope;
  if (scope === "root") {
    const nodeId = (origin as { nodeId?: number }).nodeId;
    return typeof nodeId === "number" ? { scope: "root", nodeId } : null;
  }
  if (scope === "subgraph") {
    const nodeId = (origin as { nodeId?: number }).nodeId;
    const subgraphId = (origin as { subgraphId?: string }).subgraphId;
    if (typeof nodeId === "number" && typeof subgraphId === "string") {
      return { scope: "subgraph", subgraphId, nodeId };
    }
  }
  return null;
}

function getNodePointerFromWorkflowNode(node: WorkflowNode): string {
  const origin = getMobileOrigin(node);
  return makeLocationPointer({
    type: "node",
    nodeId: node.id,
    subgraphId: origin?.scope === "subgraph" ? origin.subgraphId : null,
  });
}

function withStableKeysForNodes(
  nodes: WorkflowNode[],
  stableKeyByPointer: Record<string, StableKey>,
  forcedSubgraphId: string | null = null,
): WorkflowNode[] {
  return nodes.map((node) => {
    const pointer =
      forcedSubgraphId === null
        ? getNodePointerFromWorkflowNode(node)
        : makeLocationPointer({
            type: "node",
            nodeId: node.id,
            subgraphId: forcedSubgraphId,
          });
    const stableKey = stableKeyByPointer[pointer];
    if (!stableKey) return node;
    if (node.stableKey === stableKey) return node;
    return { ...node, stableKey };
  });
}

function withStableKeysForGroups(
  groups: WorkflowGroup[],
  stableKeyByPointer: Record<string, StableKey>,
  subgraphId: string | null,
): WorkflowGroup[] {
  return groups.map((group) => {
    const pointer = makeLocationPointer({
      type: "group",
      groupId: group.id,
      subgraphId,
    });
    const stableKey = stableKeyByPointer[pointer];
    if (!stableKey) return group;
    if (group.stableKey === stableKey) return group;
    return { ...group, stableKey };
  });
}

function annotateWorkflowWithStableKeys(
  workflow: Workflow,
  stableKeyByPointer: Record<string, StableKey>,
): Workflow {
  const nextNodes = withStableKeysForNodes(workflow.nodes, stableKeyByPointer);
  const nextGroups = withStableKeysForGroups(
    workflow.groups ?? [],
    stableKeyByPointer,
    null,
  );
  const rootNodesChanged = nextNodes.some(
    (node, index) => node !== workflow.nodes[index],
  );
  const rootGroupsChanged = nextGroups.some(
    (group, index) => group !== (workflow.groups ?? [])[index],
  );

  const subgraphs = workflow.definitions?.subgraphs;
  if (!subgraphs) {
    return rootNodesChanged || rootGroupsChanged
      ? { ...workflow, nodes: nextNodes, groups: nextGroups }
      : workflow;
  }

  let subgraphsChanged = false;
  const nextSubgraphs = subgraphs.map((subgraph) => {
    const nextSubgraphNodes = withStableKeysForNodes(
      subgraph.nodes ?? [],
      stableKeyByPointer,
      subgraph.id,
    );
    const nextSubgraphGroups = withStableKeysForGroups(
      subgraph.groups ?? [],
      stableKeyByPointer,
      subgraph.id,
    );
    const subgraphPointer = makeLocationPointer({
      type: "subgraph",
      subgraphId: subgraph.id,
    });
    const subgraphStableKey = stableKeyByPointer[subgraphPointer];
    const changed =
      nextSubgraphNodes.some(
        (node, index) => node !== (subgraph.nodes ?? [])[index],
      ) ||
      nextSubgraphGroups.some(
        (group, index) => group !== (subgraph.groups ?? [])[index],
      ) ||
      (subgraphStableKey != null && subgraph.stableKey !== subgraphStableKey);
    if (!changed) return subgraph;
    subgraphsChanged = true;
    return {
      ...subgraph,
      stableKey: subgraphStableKey ?? subgraph.stableKey,
      nodes: nextSubgraphNodes,
      groups: nextSubgraphGroups,
    };
  });

  if (!rootNodesChanged && !rootGroupsChanged && !subgraphsChanged)
    return workflow;

  return {
    ...workflow,
    nodes: nextNodes,
    groups: nextGroups,
    definitions: {
      ...(workflow.definitions ?? {}),
      subgraphs: nextSubgraphs,
    },
  };
}

function collectDescendantSubgraphs(
  startIds: Iterable<string>,
  childMap: Map<string, Set<string>>,
): Set<string> {
  const result = new Set<string>();
  const stack = Array.from(startIds);
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || result.has(current)) continue;
    result.add(current);
    const children = childMap.get(current);
    if (children) {
      for (const child of children) {
        if (!result.has(child)) stack.push(child);
      }
    }
  }
  return result;
}

function buildSubgraphParentMap(
  subgraphs: WorkflowSubgraphDefinition[],
): Map<string, Array<{ parentId: string; nodeId: number }>> {
  const subgraphIds = new Set(subgraphs.map((sg) => sg.id));
  const map = new Map<string, Array<{ parentId: string; nodeId: number }>>();
  for (const subgraph of subgraphs) {
    for (const node of subgraph.nodes ?? []) {
      if (!subgraphIds.has(node.type)) continue;
      const entry = map.get(node.type) ?? [];
      entry.push({ parentId: subgraph.id, nodeId: node.id });
      map.set(node.type, entry);
    }
  }
  return map;
}

function getGroupIdForNode(
  targetNodeId: number,
  nodes: WorkflowNode[],
  groups: Workflow["groups"],
): number | null {
  if (!groups || groups.length === 0) return null;
  const nodeToGroup = computeNodeGroupsFor(nodes, groups);
  return nodeToGroup.get(targetNodeId) ?? null;
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

export function collectBypassGroupTargetNodeIds(
  workflow: Workflow,
  groupId: number,
  subgraphId: string | null = null,
): Set<number> {
  const nodes = workflow.nodes ?? [];
  const groups = workflow.groups ?? [];
  const subgraphs = workflow.definitions?.subgraphs ?? [];

  const subgraphById = new Map(subgraphs.map((sg) => [sg.id, sg]));
  const subgraphIds = new Set(subgraphs.map((sg) => sg.id));
  const nodesBySubgraph = new Map<string, WorkflowNode[]>();
  const rootNodes: WorkflowNode[] = [];

  for (const node of nodes) {
    const origin = getMobileOrigin(node);
    if (origin?.scope === "subgraph") {
      const bucket = nodesBySubgraph.get(origin.subgraphId);
      if (bucket) {
        bucket.push(node);
      } else {
        nodesBySubgraph.set(origin.subgraphId, [node]);
      }
    } else {
      rootNodes.push(node);
    }
  }

  const subgraphChildMap = new Map<string, Set<string>>();
  for (const subgraph of subgraphs) {
    const children = new Set<string>();
    for (const node of subgraph.nodes ?? []) {
      if (subgraphIds.has(node.type)) {
        children.add(node.type);
      }
    }
    if (children.size > 0) {
      subgraphChildMap.set(subgraph.id, children);
    }
  }

  const targetNodeIds = new Set<number>();

  if (subgraphId) {
    const subgraph = subgraphById.get(subgraphId);
    if (!subgraph) return targetNodeIds;
    const subgraphGroups = subgraph.groups ?? [];
    const group = subgraphGroups.find((g) => g.id === groupId);
    if (!group) return targetNodeIds;

    const subgraphNodes = subgraph.nodes ?? [];
    const nodeToGroup = computeNodeGroupsFor(subgraphNodes, subgraphGroups);
    const nestedSubgraphIds = new Set<string>();
    const directNodeOriginIds = new Set<number>();

    for (const node of subgraphNodes) {
      if (nodeToGroup.get(node.id) !== groupId) continue;
      if (subgraphIds.has(node.type)) {
        nestedSubgraphIds.add(node.type);
      } else {
        directNodeOriginIds.add(node.id);
      }
    }

    const scopedNodes = nodesBySubgraph.get(subgraphId) ?? [];
    for (const node of scopedNodes) {
      const origin = getMobileOrigin(node);
      if (origin?.scope !== "subgraph") continue;
      if (directNodeOriginIds.has(origin.nodeId)) {
        targetNodeIds.add(node.id);
      }
    }

    const descendantSubgraphs = collectDescendantSubgraphs(
      nestedSubgraphIds,
      subgraphChildMap,
    );
    for (const nestedId of descendantSubgraphs) {
      const nestedNodes = nodesBySubgraph.get(nestedId) ?? [];
      for (const node of nestedNodes) {
        targetNodeIds.add(node.id);
      }
    }
  } else {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return targetNodeIds;

    const nodeToGroup = computeNodeGroupsFor(rootNodes, groups);
    for (const node of rootNodes) {
      if (nodeToGroup.get(node.id) === groupId) {
        targetNodeIds.add(node.id);
      }
    }

    const rawSubgraphGroupMap = (
      workflow.extra as Record<string, unknown> | undefined
    )?.[MOBILE_SUBGRAPH_GROUP_MAP_KEY];
    const directSubgraphIds = new Set<string>();
    if (rawSubgraphGroupMap && typeof rawSubgraphGroupMap === "object") {
      for (const [key, value] of Object.entries(
        rawSubgraphGroupMap as Record<string, unknown>,
      )) {
        if (value === groupId) {
          directSubgraphIds.add(key);
        }
      }
    }

    const descendantSubgraphs = collectDescendantSubgraphs(
      directSubgraphIds,
      subgraphChildMap,
    );
    for (const subgraphId of descendantSubgraphs) {
      const subgraphNodes = nodesBySubgraph.get(subgraphId) ?? [];
      for (const node of subgraphNodes) {
        targetNodeIds.add(node.id);
      }
    }
  }

  return targetNodeIds;
}

function getSubgraphChildMap(workflow: Workflow): Map<string, Set<string>> {
  const subgraphs = workflow.definitions?.subgraphs ?? [];
  const subgraphIds = new Set(subgraphs.map((sg) => sg.id));
  const childMap = new Map<string, Set<string>>();
  for (const subgraph of subgraphs) {
    const children = new Set<string>();
    for (const node of subgraph.nodes ?? []) {
      if (subgraphIds.has(node.type)) children.add(node.type);
    }
    if (children.size > 0) childMap.set(subgraph.id, children);
  }
  return childMap;
}

function collectBypassSubgraphTargetNodeIds(
  workflow: Workflow,
  subgraphId: string,
): Set<number> {
  const subgraphChildMap = getSubgraphChildMap(workflow);
  const descendantSubgraphs = collectDescendantSubgraphs(
    [subgraphId],
    subgraphChildMap,
  );
  const targetNodeIds = new Set<number>();
  for (const node of workflow.nodes ?? []) {
    const origin = getMobileOrigin(node);
    if (origin?.scope !== "subgraph") continue;
    if (descendantSubgraphs.has(origin.subgraphId)) {
      targetNodeIds.add(node.id);
    }
  }
  return targetNodeIds;
}

function getParentSubgraphIdFromContainer(
  containerId: ContainerId,
  layout: MobileLayout,
): string | null {
  if (containerId.scope === "subgraph") return containerId.subgraphId;
  if (containerId.scope === "root") return null;
  return findGroupSubgraphIdByStableKey(layout, containerId.groupKey);
}

function remapPromotedGroups(
  sourceGroups: WorkflowGroup[],
  targetGroups: WorkflowGroup[],
): {
  idMap: Map<number, number>;
  promotedGroups: WorkflowGroup[];
} {
  const idMap = new Map<number, number>();
  let nextId = Math.max(0, ...targetGroups.map((g) => g.id)) + 1;
  const promotedGroups = sourceGroups.map((group) => {
    const mappedId = nextId++;
    idMap.set(group.id, mappedId);
    return { ...group, id: mappedId };
  });
  return { idMap, promotedGroups };
}

function removeNodeIdsFromWorkflow(
  workflow: Workflow,
  nodeIdsToRemove: Set<number>,
): Workflow {
  if (nodeIdsToRemove.size === 0) return workflow;

  const linksToRemove = new Set<number>();
  for (const link of workflow.links ?? []) {
    if (nodeIdsToRemove.has(link[1]) || nodeIdsToRemove.has(link[3])) {
      linksToRemove.add(link[0]);
    }
  }

  const nextLinks = (workflow.links ?? []).filter(
    (link) => !linksToRemove.has(link[0]),
  );
  const nextNodes = (workflow.nodes ?? [])
    .filter((node) => !nodeIdsToRemove.has(node.id))
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

  return {
    ...workflow,
    nodes: nextNodes,
    links: nextLinks,
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

  if (node.type === "Power Lora Loader (rgthree)") {
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

function updateEmbedWorkflowFromExpandedNode(
  embedWorkflow: Workflow,
  expandedNode: WorkflowNode,
): Workflow {
  const origin = getMobileOrigin(expandedNode) ?? {
    scope: "root",
    nodeId: expandedNode.id,
  };

  if (origin.scope === "root") {
    const nextNodes = embedWorkflow.nodes.map((node) =>
      node.id === origin.nodeId
        ? { ...node, widgets_values: expandedNode.widgets_values ?? [] }
        : node,
    );
    return { ...embedWorkflow, nodes: nextNodes };
  }

  const subgraphs = embedWorkflow.definitions?.subgraphs;
  if (!subgraphs) return embedWorkflow;

  const nextSubgraphs = subgraphs.map((subgraph) => {
    if (subgraph.id !== origin.subgraphId) return subgraph;
    const nextNodes = subgraph.nodes.map((node) =>
      node.id === origin.nodeId
        ? { ...node, widgets_values: expandedNode.widgets_values ?? [] }
        : node,
    );
    return { ...subgraph, nodes: nextNodes };
  });

  return {
    ...embedWorkflow,
    definitions: {
      ...embedWorkflow.definitions,
      subgraphs: nextSubgraphs,
    },
  };
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

function collectWorkflowLoadErrors(
  workflow: Workflow,
  nodeTypes: NodeTypes,
): Record<string, NodeError[]> {
  const errors: Record<string, NodeError[]> = {};

  for (const node of workflow.nodes) {
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
export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set, get) => {
      const applyNodeErrors = (errors: Record<string, NodeError[]>) => {
        const { hiddenItems, workflow, stableKeyByPointer } = get();
        if (!workflow) {
          useWorkflowErrorsStore.getState().setNodeErrors(errors);
          return;
        }
        const errorNodeIds = Object.keys(errors);
        const nodesToUnhide = errorNodeIds.filter((id) => {
          const nodeId = Number(id);
          if (!Number.isFinite(nodeId)) return false;
          return collectNodeStableKeys(
            workflow,
            stableKeyByPointer,
            nodeId,
          ).some((stableKey) => Boolean(hiddenItems[stableKey]));
        });
        if (nodesToUnhide.length > 0) {
          const newHiddenNodes = { ...hiddenItems };
          for (const id of nodesToUnhide) {
            const nodeId = Number(id);
            if (!Number.isFinite(nodeId)) continue;
            for (const stableKey of collectNodeStableKeys(
              workflow,
              stableKeyByPointer,
              nodeId,
            )) {
              delete newHiddenNodes[stableKey];
            }
          }
          set({ hiddenItems: newHiddenNodes });
        }
        useWorkflowErrorsStore.getState().setNodeErrors(errors);
      };

      const deleteNode: WorkflowState["deleteNode"] = (
        stableKey,
        reconnect,
      ) => {
        const {
          workflow,
          hiddenItems,
          connectionHighlightModes,
          mobileLayout,
          stableKeyByPointer,
          pointerByStableKey,
        } = get();
        if (!workflow) return;
        const identity = resolveNodeIdentityFromStableKey(
          workflow,
          stableKey,
          pointerByStableKey,
        );
        if (!identity) return;
        const { nodeId, subgraphId } = identity;

        if (
          !workflow.nodes.some((n) => {
            if (n.id !== nodeId) return false;
            const origin = getMobileOrigin(n);
            if (subgraphId == null) return origin?.scope !== "subgraph";
            return (
              origin?.scope === "subgraph" && origin.subgraphId === subgraphId
            );
          })
        )
          return;

        const linksToRemove = new Set<number>();
        const incomingLinks = workflow.links.filter((link) => {
          const isIncoming = link[3] === nodeId;
          if (isIncoming) linksToRemove.add(link[0]);
          return isIncoming;
        });
        const outgoingLinks = workflow.links.filter((link) => {
          const isOutgoing = link[1] === nodeId;
          if (isOutgoing) linksToRemove.add(link[0]);
          return isOutgoing;
        });

        let nextLastLinkId = workflow.last_link_id;
        const bridgeInputLinks = new Map<string, number>();
        const bridgeOutputLinks = new Map<string, number[]>();
        const bridgeLinks: Workflow["links"] = [];

        if (reconnect) {
          for (const outLink of outgoingLinks) {
            const [, , , outTargetNodeId, outTargetSlot, outType] = outLink;
            const sourceLink = incomingLinks.find((inLink) =>
              areTypesCompatible(inLink[5], outType),
            );
            if (!sourceLink) continue;

            const [, inSourceNodeId, inSourceSlot] = sourceLink;
            nextLastLinkId += 1;
            const bridgeLink: Workflow["links"][number] = [
              nextLastLinkId,
              inSourceNodeId,
              inSourceSlot,
              outTargetNodeId,
              outTargetSlot,
              outType,
            ];
            bridgeLinks.push(bridgeLink);

            const targetKey = `${outTargetNodeId}:${outTargetSlot}`;
            bridgeInputLinks.set(targetKey, bridgeLink[0]);

            const sourceKey = `${inSourceNodeId}:${inSourceSlot}`;
            const existing = bridgeOutputLinks.get(sourceKey) ?? [];
            existing.push(bridgeLink[0]);
            bridgeOutputLinks.set(sourceKey, existing);
          }
        }

        const newLinks = [
          ...workflow.links.filter((link) => !linksToRemove.has(link[0])),
          ...bridgeLinks,
        ];

        const newNodes = workflow.nodes
          .filter((node) => node.id !== nodeId)
          .map((node) => {
            const nextInputs = node.inputs.map((input, index) => {
              const key = `${node.id}:${index}`;
              const bridgeInputLinkId = bridgeInputLinks.get(key);
              if (bridgeInputLinkId != null) {
                return { ...input, link: bridgeInputLinkId };
              }
              if (input.link != null && linksToRemove.has(input.link)) {
                return { ...input, link: null };
              }
              return input;
            });

            const nextOutputs = node.outputs.map((output, index) => {
              const existingLinks = output.links ?? [];
              const retainedLinks = existingLinks.filter(
                (linkId) => !linksToRemove.has(linkId),
              );
              const sourceKey = `${node.id}:${index}`;
              const appendedLinks = bridgeOutputLinks.get(sourceKey) ?? [];
              const mergedLinks = [...retainedLinks, ...appendedLinks];
              return {
                ...output,
                links: mergedLinks.length > 0 ? mergedLinks : null,
              };
            });

            return { ...node, inputs: nextInputs, outputs: nextOutputs };
          });

        // Clean up UI state
        const nextHiddenNodes = { ...hiddenItems };
        for (const stableKey of collectNodeStableKeys(
          workflow,
          stableKeyByPointer,
          nodeId,
          subgraphId,
        )) {
          delete nextHiddenNodes[stableKey];
        }
        for (const legacyPointer of collectNodeStateKeys(
          workflow,
          nodeId,
          subgraphId,
        )) {
          delete nextHiddenNodes[legacyPointer];
        }

        const nextHighlightModes = { ...connectionHighlightModes };
        delete nextHighlightModes[nodeId];

        // Clean up mobile layout
        const nextMobileLayout = removeNodeFromLayout(mobileLayout, nodeId);
        const reconciled = reconcileStableRegistry(
          nextMobileLayout,
          stableKeyByPointer,
          pointerByStableKey,
        );
        const nextWorkflowWithStableKeys = annotateWorkflowWithStableKeys(
          {
            ...workflow,
            nodes: newNodes,
            links: newLinks,
            last_link_id: nextLastLinkId,
          },
          reconciled.layoutToStable,
        );

        set({
          workflow: nextWorkflowWithStableKeys,
          hiddenItems: nextHiddenNodes,
          connectionHighlightModes: nextHighlightModes,
          mobileLayout: nextMobileLayout,
          stableKeyByPointer: reconciled.layoutToStable,
          pointerByStableKey: reconciled.stableToLayout,
        });
      };

      const connectNodes: WorkflowState["connectNodes"] = (
        srcStableKey,
        srcSlot,
        tgtStableKey,
        tgtSlot,
        type,
      ) => {
        const { workflow, pointerByStableKey } = get();
        if (!workflow) return;
        const srcIdentity = resolveNodeIdentityFromStableKey(
          workflow,
          srcStableKey,
          pointerByStableKey,
        );
        const tgtIdentity = resolveNodeIdentityFromStableKey(
          workflow,
          tgtStableKey,
          pointerByStableKey,
        );
        if (!srcIdentity || !tgtIdentity) return;
        const srcNodeId = srcIdentity.nodeId;
        const tgtNodeId = tgtIdentity.nodeId;

        const srcNode = workflow.nodes.find((n) => n.id === srcNodeId);
        const tgtNode = workflow.nodes.find((n) => n.id === tgtNodeId);
        if (!srcNode || !tgtNode) return;

        let newLinks = [...workflow.links];
        let nextLastLinkId = workflow.last_link_id;

        // If target input already has a link, remove it first
        const existingLinkId = tgtNode.inputs[tgtSlot]?.link;
        if (existingLinkId != null) {
          newLinks = newLinks.filter((l) => l[0] !== existingLinkId);
        }

        nextLastLinkId++;
        const newLinkId = nextLastLinkId;
        const newLink: [number, number, number, number, number, string] = [
          newLinkId,
          srcNodeId,
          srcSlot,
          tgtNodeId,
          tgtSlot,
          type,
        ];
        newLinks.push(newLink);

        const newNodes = workflow.nodes.map((n) => {
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

        set({
          workflow: {
            ...workflow,
            nodes: newNodes,
            links: newLinks,
            last_link_id: nextLastLinkId,
          },
        });
      };

      const disconnectInput: WorkflowState["disconnectInput"] = (
        stableKey,
        inputIndex,
      ) => {
        const { workflow, pointerByStableKey } = get();
        if (!workflow) return;
        const identity = resolveNodeIdentityFromStableKey(
          workflow,
          stableKey,
          pointerByStableKey,
        );
        if (!identity) return;
        const nodeId = identity.nodeId;

        const node = workflow.nodes.find((n) => n.id === nodeId);
        if (!node) return;

        const linkId = node.inputs[inputIndex]?.link;
        if (linkId == null) return;

        const newLinks = workflow.links.filter((l) => l[0] !== linkId);
        const newNodes = workflow.nodes.map((n) => {
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

        set({
          workflow: { ...workflow, nodes: newNodes, links: newLinks },
        });
      };

      const addNode: WorkflowState["addNode"] = (nodeType, options) => {
        const { workflow, nodeTypes, mobileLayout } = get();
        if (!workflow || !nodeTypes) return null;

        const typeDef = nodeTypes[nodeType];
        if (!typeDef) return null;

        const newId = workflow.last_node_id + 1;

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

        // Position near target node or at the bottom
        let pos: [number, number] = [0, 0];
        if (options?.nearNodeStableKey) {
          const nearIdentity = resolveNodeIdentityFromStableKey(
            workflow,
            options.nearNodeStableKey,
            get().pointerByStableKey,
          );
          if (nearIdentity) {
            pos = getPositionNearNode(workflow, nearIdentity.nodeId) ?? pos;
          }
        } else if (options?.inSubgraphId) {
          const subgraphNodes = workflow.nodes.filter((n) => {
            const origin = getMobileOrigin(n);
            return (
              origin?.scope === "subgraph" &&
              origin.subgraphId === options.inSubgraphId
            );
          });
          if (subgraphNodes.length > 0) {
            const maxBottom = Math.max(
              ...subgraphNodes.map((n) => n.pos[1] + (n.size?.[1] ?? 100)),
            );
            const minX = Math.min(...subgraphNodes.map((n) => n.pos[0]));
            pos = [minX, maxBottom + 80];
          } else {
            pos = getBottomPlacement(workflow);
          }
        } else {
          pos = getBottomPlacement(workflow);
        }

        if (options?.inGroupId != null) {
          const groups = [
            ...(workflow.groups ?? []),
            ...(workflow.definitions?.subgraphs ?? []).flatMap(
              (sg) => sg.groups ?? [],
            ),
          ];
          const group = groups.find((g) => g.id === options.inGroupId);
          if (group) {
            pos = clampPositionToGroup(pos, group, [200, 100]);
          }
        }

        const nodeProperties: Record<string, unknown> = {};
        if (options?.inSubgraphId) {
          nodeProperties[MOBILE_ORIGIN_KEY] = {
            scope: "subgraph",
            subgraphId: options.inSubgraphId,
            nodeId: newId,
          };
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
          properties: nodeProperties,
          widgets_values: widgetsValues,
        };

        const nextMobileLayout = addNodeToLayout(mobileLayout, newId, {
          groupId: options?.inGroupId ?? undefined,
          subgraphId: options?.inSubgraphId ?? undefined,
        });
        const { stableKeyByPointer, pointerByStableKey } = get();
        const reconciled = reconcileStableRegistry(
          nextMobileLayout,
          stableKeyByPointer,
          pointerByStableKey,
        );
        const nextWorkflowWithStableKeys = annotateWorkflowWithStableKeys(
          {
            ...workflow,
            nodes: [...workflow.nodes, newNode],
            last_node_id: newId,
          },
          reconciled.layoutToStable,
        );

        set({
          workflow: nextWorkflowWithStableKeys,
          mobileLayout: nextMobileLayout,
          stableKeyByPointer: reconciled.layoutToStable,
          pointerByStableKey: reconciled.stableToLayout,
        });

        return newId;
      };

      const addNodeAndConnect: WorkflowState["addNodeAndConnect"] = (
        nodeType,
        targetStableKey,
        targetInputIndex,
      ) => {
        const { workflow, nodeTypes, pointerByStableKey } = get();
        if (!workflow || !nodeTypes) return null;
        const targetIdentity = resolveNodeIdentityFromStableKey(
          workflow,
          targetStableKey,
          pointerByStableKey,
        );
        if (!targetIdentity) return null;
        const targetNodeId = targetIdentity.nodeId;

        const targetNode = workflow.nodes.find((n) => n.id === targetNodeId);
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
          nearNodeStableKey: targetStableKey,
        });
        if (newId === null) return null;
        const newPointer = makeLocationPointer({
          type: "node",
          nodeId: newId,
          subgraphId: targetIdentity.subgraphId,
        });
        const newStableKey = get().stableKeyByPointer[newPointer];
        if (!newStableKey) return null;

        get().connectNodes(
          newStableKey,
          outputIndex,
          targetStableKey,
          targetInputIndex,
          targetInput.type,
        );
        return newId;
      };

      const setNodeOutput: WorkflowState["setNodeOutput"] = (
        stableKey,
        images,
      ) => {
        set((state) => ({
          ...(() => {
            const identity = state.workflow
              ? resolveNodeIdentityFromStableKey(
                  state.workflow,
                  stableKey,
                  state.pointerByStableKey,
                )
              : null;
            if (!identity) return {};
            const nodeId = String(identity.nodeId);
            return {
              nodeOutputs: {
                ...state.nodeOutputs,
                [nodeId]: images,
              },
            };
          })(),
        }));
      };

      const setNodeTextOutput: WorkflowState["setNodeTextOutput"] = (
        stableKey,
        text,
      ) => {
        set((state) => ({
          ...(() => {
            const identity = state.workflow
              ? resolveNodeIdentityFromStableKey(
                  state.workflow,
                  stableKey,
                  state.pointerByStableKey,
                )
              : null;
            if (!identity) return {};
            const nodeId = String(identity.nodeId);
            return {
              nodeTextOutputs: {
                ...state.nodeTextOutputs,
                [nodeId]: text,
              },
            };
          })(),
        }));
      };

      const cycleConnectionHighlight: WorkflowState["cycleConnectionHighlight"] =
        (stableKey) => {
          set((state) => {
            const identity = state.workflow
              ? resolveNodeIdentityFromStableKey(
                  state.workflow,
                  stableKey,
                  state.pointerByStableKey,
                )
              : null;
            if (!identity) return {};
            const nodeId = identity.nodeId;
            const current = state.connectionHighlightModes[nodeId] ?? "off";
            const next =
              current === "off"
                ? "inputs"
                : current === "inputs"
                  ? "outputs"
                  : current === "outputs"
                    ? "both"
                    : "off";
            return {
              connectionHighlightModes: {
                ...state.connectionHighlightModes,
                [nodeId]: next,
              },
            };
          });
        };

      const setConnectionHighlightMode: WorkflowState["setConnectionHighlightMode"] =
        (stableKey, mode) => {
          set((state) => ({
            ...(() => {
              const identity = state.workflow
                ? resolveNodeIdentityFromStableKey(
                    state.workflow,
                    stableKey,
                    state.pointerByStableKey,
                  )
                : null;
              if (!identity) return {};
              return {
                connectionHighlightModes: {
                  ...state.connectionHighlightModes,
                  [identity.nodeId]: mode,
                },
              };
            })(),
          }));
        };

      const setItemHidden: WorkflowState["setItemHidden"] = (
        stableKey,
        hidden,
      ) => {
        if (!stableKey) return;
        set((state) => {
          const next = { ...state.hiddenItems };
          if (hidden) {
            next[stableKey] = true;
          } else {
            delete next[stableKey];
          }
          return { hiddenItems: next };
        });
      };

      const revealNodeWithParents: WorkflowState["revealNodeWithParents"] = (
        stableKey,
      ) => {
        const { workflow, pointerByStableKey } = get();
        if (!workflow) return;
        const identity = resolveNodeIdentityFromStableKey(
          workflow,
          stableKey,
          pointerByStableKey,
        );
        if (!identity) return;

        const subgraphs = workflow.definitions?.subgraphs ?? [];
        const targetSubgraphId = identity.subgraphId ?? null;
        const node = workflow.nodes.find((entry) => {
          if (entry.id !== identity.nodeId) return false;
          const origin = getMobileOrigin(entry);
          if (targetSubgraphId === null) return origin?.scope !== "subgraph";
          return (
            origin?.scope === "subgraph" &&
            origin.subgraphId === targetSubgraphId
          );
        });
        if (!node) return;

        const subgraphById = new Map(subgraphs.map((sg) => [sg.id, sg]));
        const parentMap = buildSubgraphParentMap(subgraphs);
        const origin = getMobileOrigin(node);
        const rootNodes = workflow.nodes.filter(
          (entry) => getMobileOrigin(entry)?.scope !== "subgraph",
        );
        const startingNodeId =
          origin?.scope === "subgraph" ? origin.nodeId : node.id;
        const collectParentIds = () => {
          const parents = new Set<number>();
          const stack = [startingNodeId];
          if (origin?.scope === "subgraph") {
            const subgraph = subgraphById.get(origin.subgraphId);
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
        const parentSubgraphId =
          origin?.scope === "subgraph" ? origin.subgraphId : null;

        set((state) => {
          const nextHiddenItems = { ...state.hiddenItems };
          for (const stableKey of collectNodeStableKeys(
            workflow,
            state.stableKeyByPointer,
            identity.nodeId,
            targetSubgraphId,
          )) {
            delete nextHiddenItems[stableKey];
          }
          parentIds.forEach((parentId) => {
            for (const stableKey of collectNodeStableKeys(
              workflow,
              state.stableKeyByPointer,
              parentId,
              parentSubgraphId,
            )) {
              delete nextHiddenItems[stableKey];
            }
          });
          const nextCollapsedItems = { ...state.collapsedItems };

          const revealGroup = (
            groupId: number | null | undefined,
            subgraphId: string | null = null,
          ) => {
            if (groupId === null || groupId === undefined) return;
            for (const key of collectGroupStableKeys(
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
            const key = findSubgraphStableKey(workflow, subgraphId);
            if (!key) return;
            delete nextCollapsedItems[key];
            delete nextHiddenItems[key];
          };

          if (!origin || origin.scope === "root") {
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
            expandSubgraph(origin.subgraphId);
            const subgraph = subgraphById.get(origin.subgraphId);
            if (subgraph) {
              const groupId = getGroupIdForNode(
                origin.nodeId,
                subgraph.nodes ?? [],
                subgraph.groups ?? [],
              );
              revealGroup(groupId, origin.subgraphId);
            }

            const rawSubgraphGroupMap = (
              workflow.extra as Record<string, unknown> | undefined
            )?.[MOBILE_SUBGRAPH_GROUP_MAP_KEY];
            const rootGroupId =
              rawSubgraphGroupMap && typeof rawSubgraphGroupMap === "object"
                ? (rawSubgraphGroupMap as Record<string, unknown>)[
                    origin.subgraphId
                  ]
                : undefined;
            if (typeof rootGroupId === "number") {
              revealGroup(rootGroupId, null);
            }

            if (subgraph) {
              parentIds.forEach((parentId) => {
                const parentGroupId = getGroupIdForNode(
                  parentId,
                  subgraph.nodes ?? [],
                  subgraph.groups ?? [],
                );
                revealGroup(parentGroupId, origin.subgraphId);
              });
            }

            const stack = [origin.subgraphId];
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
        stableKey,
        widgetIndex,
        value,
        widgetName,
      ) => {
        const { workflow, embedWorkflow, pointerByStableKey } = get();
        if (!workflow) return;
        const identity = resolveNodeIdentityFromStableKey(
          workflow,
          stableKey,
          pointerByStableKey,
        );
        if (!identity) return;
        const nodeId = identity.nodeId;

        const newNodes = workflow.nodes.map((node) => {
          if (node.id === nodeId) {
            return updateNodeWidgetValues(node, widgetIndex, value, widgetName);
          }
          return node;
        });

        const updatedNode = newNodes.find((node) => node.id === nodeId);
        const nextEmbedWorkflow =
          embedWorkflow && updatedNode
            ? updateEmbedWorkflowFromExpandedNode(embedWorkflow, updatedNode)
            : embedWorkflow;

        set({
          workflow: { ...workflow, nodes: newNodes },
          embedWorkflow: nextEmbedWorkflow,
        });
        useWorkflowErrorsStore.getState().clearNodeError(nodeId);
      };

      const updateNodeWidgets: WorkflowState["updateNodeWidgets"] = (
        stableKey,
        updates,
      ) => {
        const { workflow, embedWorkflow, pointerByStableKey } = get();
        if (!workflow) return;
        const identity = resolveNodeIdentityFromStableKey(
          workflow,
          stableKey,
          pointerByStableKey,
        );
        if (!identity) return;
        const nodeId = identity.nodeId;

        const newNodes = workflow.nodes.map((node) => {
          if (node.id === nodeId) {
            return updateNodeWidgetsValues(node, updates);
          }
          return node;
        });

        const updatedNode = newNodes.find((node) => node.id === nodeId);
        const nextEmbedWorkflow =
          embedWorkflow && updatedNode
            ? updateEmbedWorkflowFromExpandedNode(embedWorkflow, updatedNode)
            : embedWorkflow;

        set({
          workflow: { ...workflow, nodes: newNodes },
          embedWorkflow: nextEmbedWorkflow,
        });
        useWorkflowErrorsStore.getState().clearNodeError(nodeId);
      };

      const updateNodeTitle: WorkflowState["updateNodeTitle"] = (
        stableKey,
        title,
      ) => {
        const { workflow, pointerByStableKey } = get();
        if (!workflow) return;
        const identity = resolveNodeIdentityFromStableKey(
          workflow,
          stableKey,
          pointerByStableKey,
        );
        if (!identity) return;
        const nodeId = identity.nodeId;
        const normalized = title?.trim() ?? "";
        const nextNodes = workflow.nodes.map((node) => {
          if (node.id !== nodeId) return node;
          const nextProps = { ...(node.properties ?? {}) } as Record<
            string,
            unknown
          >;
          const nextNode = {
            ...node,
            properties: nextProps,
          } as WorkflowNode & { title?: string };
          if (normalized) {
            nextNode.title = normalized;
            nextProps.title = normalized;
          } else {
            delete nextNode.title;
            delete nextProps.title;
          }
          return nextNode;
        });
        set({ workflow: { ...workflow, nodes: nextNodes } });
      };

      const toggleBypass: WorkflowState["toggleBypass"] = (stableKey) => {
        const { workflow, pointerByStableKey } = get();
        if (!workflow) return;
        const identity = resolveNodeIdentityFromStableKey(
          workflow,
          stableKey,
          pointerByStableKey,
        );
        if (!identity) return;
        const nodeId = identity.nodeId;

        const newNodes = workflow.nodes.map((node) => {
          if (node.id === nodeId) {
            const currentMode = node.mode || 0;
            const newMode = currentMode === 4 ? 0 : 4;
            return { ...node, mode: newMode };
          }
          return node;
        });

        set({ workflow: { ...workflow, nodes: newNodes } });
      };

      const scrollToNode: WorkflowState["scrollToNode"] = (
        stableKey,
        label,
      ) => {
        const { hiddenItems, workflow, pointerByStableKey } = get();
        if (!workflow) return;
        const identity = resolveNodeIdentityFromStableKey(
          workflow,
          stableKey,
          pointerByStableKey,
        );
        if (!identity) return;
        const nodeId = identity.nodeId;
        const isNodeHidden = Boolean(hiddenItems[stableKey]);
        if (isNodeHidden) {
          get().setItemHidden(stableKey, false);
        }
        if (document.body.dataset.textareaFocus === "true") {
          return;
        }
        get().setItemCollapsed(stableKey, false);
        const attemptScroll = (
          attemptsLeft: number,
          delayedAttemptsLeft: number,
        ) => {
          const anchor =
            document.getElementById(`node-anchor-${nodeId}`) ??
            document.getElementById(`node-${nodeId}`);
          const nodeEl =
            document.getElementById(`node-card-${nodeId}`) ??
            document.getElementById(`node-${nodeId}`);
          if (!anchor || !nodeEl) {
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
          if (container) {
            const anchorRect = anchor.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const offset = anchorRect.top - containerRect.top;
            const targetTop = Math.max(0, container.scrollTop + offset);
            container.scrollTo({ top: targetTop, behavior: "smooth" });
          } else {
            anchor.scrollIntoView({ behavior: "smooth", block: "start" });
          }

          const scrollContainer = container || window;
          let scrollEndTimeout: ReturnType<typeof setTimeout> | null = null;

          const highlight = () => {
            document
              .querySelectorAll(".highlight-pulse")
              .forEach((el) => el.classList.remove("highlight-pulse"));
            nodeEl.classList.add("highlight-pulse");
            setTimeout(() => nodeEl.classList.remove("highlight-pulse"), 1200);
            if ("vibrate" in navigator) navigator.vibrate(10);

            if (label) {
              window.dispatchEvent(
                new CustomEvent("node-show-label", {
                  detail: { nodeId, label },
                }),
              );
            }
          };

          const handleScroll = () => {
            if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
            scrollEndTimeout = setTimeout(() => {
              cleanup();
              highlight();
            }, 120);
          };

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

          scrollContainer.addEventListener(
            "scroll",
            handleScroll as EventListener,
            { passive: true },
          );
          scrollEndTimeout = setTimeout(() => {
            cleanup();
            highlight();
          }, 200);
        };

        attemptScroll(10, 2);
      };

      const setExecutionState: WorkflowState["setExecutionState"] = (
        isExecuting,
        executingNodeStableKey,
        executingPromptId,
        progress,
      ) => {
        set((state) => {
          const now = Date.now();
          const resolvedExecutingNodeId =
            isExecuting && executingNodeStableKey && state.workflow
              ? (() => {
                  const identity = resolveNodeIdentityFromStableKey(
                    state.workflow,
                    executingNodeStableKey,
                    state.pointerByStableKey,
                  );
                  return identity ? String(identity.nodeId) : null;
                })()
              : null;
          const nextExecutingPromptId = isExecuting
            ? (executingPromptId ?? state.executingPromptId)
            : null;
          const nextExecutingNodeId = isExecuting
            ? (resolvedExecutingNodeId ?? state.executingNodeId)
            : null;
          const nextState: Partial<WorkflowState> = {
            isExecuting,
            executingNodeId: nextExecutingNodeId,
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

          const promptChanged =
            nextExecutingPromptId &&
            nextExecutingPromptId !== state.executingPromptId;
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
          const reconciled = reconcileStableRegistry(
            normalized,
            state.stableKeyByPointer,
            state.pointerByStableKey,
          );
          const nextWorkflow = state.workflow
            ? annotateWorkflowWithStableKeys(
                state.workflow,
                reconciled.layoutToStable,
              )
            : state.workflow;
          return {
            workflow: nextWorkflow,
            mobileLayout: normalized,
            stableKeyByPointer: reconciled.layoutToStable,
            pointerByStableKey: reconciled.stableToLayout,
          };
        });
      };

      const loadWorkflow: WorkflowState["loadWorkflow"] = (
        workflow,
        filename,
        options,
      ) => {
        const { currentFilename, savedWorkflowStates, nodeTypes } = get();
        const fresh = options?.fresh ?? false;
        const source = options?.source ?? { type: "other" as const };
        // Always reset workflow error/popover state when switching workflows.
        useWorkflowErrorsStore.getState().clearNodeErrors();
        const expandedWorkflow = expandWorkflowSubgraphs(workflow);
        const normalizedEmbedWorkflow = normalizeWorkflowForEmbed(workflow);

        // Normalize workflow to ensure required fields exist
        const normalizedNodes = normalizeWorkflowNodes(expandedWorkflow.nodes);

        const normalizedWorkflow: Workflow = {
          ...expandedWorkflow,
          nodes: normalizedNodes,
          links: expandedWorkflow.links ?? [],
          groups: expandedWorkflow.groups ?? [],
          config: expandedWorkflow.config ?? {},
          last_node_id:
            expandedWorkflow.last_node_id ??
            Math.max(0, ...normalizedNodes.map((n) => n.id)),
          last_link_id: expandedWorkflow.last_link_id ?? 0,
          version: expandedWorkflow.version ?? 0.4,
        };
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
          normalizedWorkflow,
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

        // Initialize seed modes from workflow
        const seedModes: Record<number, SeedMode> = {};
        if (nodeTypes) {
          for (const node of normalizedWorkflow.nodes) {
            const seedWidgetIndex = findSeedWidgetIndex(
              normalizedWorkflow,
              nodeTypes,
              node,
            );
            if (seedWidgetIndex !== null) {
              seedModes[node.id] = inferSeedMode(
                normalizedWorkflow,
                nodeTypes,
                node,
              );
            }
          }
        }

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

        let finalWorkflow = normalizedWorkflow;

        if (savedState) {
          // Restore saved UI state
          const restoredNodes = normalizedWorkflow.nodes.map((node) => {
            const savedNodeState = savedState.nodes[node.id];
            if (!savedNodeState) return node;

            return {
              ...node,
              mode: savedNodeState.mode ?? node.mode,
              flags: savedNodeState.flags ?? node.flags,
              widgets_values:
                savedNodeState.widgets_values ?? node.widgets_values,
            };
          });

          const restoredWorkflow = {
            ...normalizedWorkflow,
            nodes: restoredNodes,
          };
          const normalizedResult = nodeTypes
            ? normalizeWorkflowComboValues(restoredWorkflow, nodeTypes)
            : { workflow: restoredWorkflow, changed: false };
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
          const reconciled = reconcileStableRegistry(
            restoredLayout,
            get().stableKeyByPointer,
            get().pointerByStableKey,
          );
          const normalizedHiddenNodesStable = stableRecordFromLayoutRecord(
            normalizedHiddenNodes,
            reconciled.layoutToStable,
          );
          const normalizedCollapsedItemsStable =
            stableCollapsedRecordFromLayoutRecord(
              rawCollapsedItems,
              reconciled.layoutToStable,
            );
          const normalizedHiddenItemsStable = stableRecordFromLayoutRecord(
            rawHiddenItems,
            reconciled.layoutToStable,
          );
          const restoredCollapsedItems = normalizeStableCollapsedRecord(
            {
              ...rawCollapsedItems,
              ...normalizedCollapsedItemsStable,
            },
            reconciled.layoutToStable,
            reconciled.stableToLayout,
          );
          const restoredHiddenItems = normalizeStableBooleanRecord(
            {
              ...rawHiddenItems,
              ...normalizedHiddenItemsStable,
            },
            reconciled.layoutToStable,
            reconciled.stableToLayout,
          );
          const defaultCollapsedItems: Record<string, boolean> = {};
          const restoredWorkflowWithStableKeys = annotateWorkflowWithStableKeys(
            finalWorkflow,
            reconciled.layoutToStable,
          );
          finalWorkflow = restoredWorkflowWithStableKeys;
          let syncedEmbedWorkflow = normalizedEmbedWorkflow;
          if (syncedEmbedWorkflow) {
            for (const node of restoredWorkflowWithStableKeys.nodes) {
              syncedEmbedWorkflow = updateEmbedWorkflowFromExpandedNode(
                syncedEmbedWorkflow,
                node,
              );
            }
          }

          set({
            workflowSource: source,
            workflow: restoredWorkflowWithStableKeys,
            embedWorkflow: syncedEmbedWorkflow,
            originalWorkflow: JSON.parse(
              JSON.stringify(restoredWorkflowWithStableKeys),
            ), // Keep original for dirty check
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
            stableKeyByPointer: reconciled.layoutToStable,
            pointerByStableKey: reconciled.stableToLayout,
            runCount: 1,
            followQueue: false,
            workflowLoadedAt: Date.now(),
          });
          useSeedStore
            .getState()
            .setSeedModes({ ...seedModes, ...savedState.seedModes });
          useSeedStore.getState().setSeedLastValues({});
          useNavigationStore.getState().setCurrentPanel("workflow");
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
            normalizedWorkflow,
            get().hiddenItems,
          );
          const nextLayout = buildLayoutForWorkflow(
            normalizedWorkflow,
            normalizedHiddenNodes,
          );
          const reconciled = reconcileStableRegistry(
            nextLayout,
            get().stableKeyByPointer,
            get().pointerByStableKey,
          );
          const normalizedHiddenNodesStable = stableRecordFromLayoutRecord(
            normalizedHiddenNodes,
            reconciled.layoutToStable,
          );
          const defaultCollapsedItems: Record<string, boolean> = {};
          const carriedCollapsedItems = shouldCarryFoldState
            ? normalizeStableCollapsedRecord(
                currentState.collapsedItems,
                reconciled.layoutToStable,
                reconciled.stableToLayout,
              )
            : {};
          useWorkflowErrorsStore.getState().setError(null);
          const normalizedResult = nodeTypes
            ? normalizeWorkflowComboValues(normalizedWorkflow, nodeTypes)
            : { workflow: normalizedWorkflow, changed: false };
          finalWorkflow = normalizedResult.workflow;
          const normalizedWorkflowWithStableKeys =
            annotateWorkflowWithStableKeys(
              finalWorkflow,
              reconciled.layoutToStable,
            );
          let syncedEmbedWorkflow = normalizedEmbedWorkflow;
          if (syncedEmbedWorkflow) {
            for (const node of normalizedWorkflowWithStableKeys.nodes) {
              syncedEmbedWorkflow = updateEmbedWorkflowFromExpandedNode(
                syncedEmbedWorkflow,
                node,
              );
            }
          }
          set({
            workflowSource: source,
            workflow: normalizedWorkflowWithStableKeys,
            embedWorkflow: syncedEmbedWorkflow,
            originalWorkflow: JSON.parse(
              JSON.stringify(normalizedWorkflowWithStableKeys),
            ),
            currentFilename: filename || null,
            currentWorkflowKey: workflowKey,
            collapsedItems: {
              ...defaultCollapsedItems,
              ...carriedCollapsedItems,
            },
            mobileLayout: nextLayout,
            stableKeyByPointer: reconciled.layoutToStable,
            pointerByStableKey: reconciled.stableToLayout,
            hiddenItems: normalizedHiddenNodesStable,
            runCount: 1,
            followQueue: false,
            workflowLoadedAt: Date.now(),
          });
          useSeedStore.getState().setSeedModes(seedModes);
          useSeedStore.getState().setSeedLastValues({});
          useNavigationStore.getState().setCurrentPanel("workflow");
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
      };

      const unloadWorkflow: WorkflowState["unloadWorkflow"] = () => {
        const { currentWorkflowKey, savedWorkflowStates } = get();

        // Clear saved state for this workflow
        if (currentWorkflowKey) {
          const newSavedStates = { ...savedWorkflowStates };
          delete newSavedStates[currentWorkflowKey];
          set({ savedWorkflowStates: newSavedStates });
        }

        // Always clear all workflow errors so node error popovers cannot carry over.
        useWorkflowErrorsStore.getState().clearNodeErrors();
        set({
          workflowSource: null,
          workflow: null,
          embedWorkflow: null,
          originalWorkflow: null,
          currentFilename: null,
          currentWorkflowKey: null,
          collapsedItems: {},
          hiddenItems: {},
          mobileLayout: createEmptyMobileLayout(),
          stableKeyByPointer: {},
          pointerByStableKey: {},
          runCount: 1,
          nodeOutputs: {},
          nodeTextOutputs: {},
          promptOutputs: {},
          followQueue: false,
          workflowLoadedAt: Date.now(),
          connectionHighlightModes: {},
        });
        useSeedStore.getState().clearSeedState();
        usePinnedWidgetStore.getState().clearCurrentPin();
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
        const workflowKey = buildWorkflowCacheKey(workflow, get().nodeTypes);
        const nextLayout = buildLayoutForWorkflow(
          workflow,
          layoutRecordFromStableRecord(
            get().hiddenItems,
            get().pointerByStableKey,
          ),
        );
        const reconciled = reconcileStableRegistry(
          nextLayout,
          get().stableKeyByPointer,
          get().pointerByStableKey,
        );
        const workflowWithStableKeys = annotateWorkflowWithStableKeys(
          workflow,
          reconciled.layoutToStable,
        );
        set({
          workflow: workflowWithStableKeys,
          embedWorkflow: normalizeWorkflowForEmbed(workflowWithStableKeys),
          originalWorkflow: JSON.parse(JSON.stringify(workflowWithStableKeys)),
          currentFilename: filename,
          currentWorkflowKey: workflowKey,
          mobileLayout: nextLayout,
          stableKeyByPointer: reconciled.layoutToStable,
          pointerByStableKey: reconciled.stableToLayout,
        });
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
        set({ nodeOutputs: {}, nodeTextOutputs: {} });
      };

      const addPromptOutputs: WorkflowState["addPromptOutputs"] = (
        promptId,
        images,
      ) => {
        if (!promptId || images.length === 0) return;
        set((state) => ({
          promptOutputs: {
            ...state.promptOutputs,
            [promptId]: [...(state.promptOutputs[promptId] ?? []), ...images],
          },
        }));
      };

      const clearPromptOutputs: WorkflowState["clearPromptOutputs"] = (
        promptId,
      ) => {
        if (!promptId) {
          set({ promptOutputs: {} });
          return;
        }
        set((state) => {
          if (!state.promptOutputs[promptId]) return state;
          const next = { ...state.promptOutputs };
          delete next[promptId];
          return { promptOutputs: next };
        });
      };

      const setRunCount: WorkflowState["setRunCount"] = (count) => {
        set({ runCount: Math.max(1, Math.floor(count)) });
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
        stableKey,
        collapsed,
      ) => {
        set((state) => {
          const nextCollapsed = { ...state.collapsedItems };
          if (collapsed) nextCollapsed[stableKey] = true;
          else delete nextCollapsed[stableKey];
          return { collapsedItems: nextCollapsed };
        });
      };

      const bypassAllInContainer: WorkflowState["bypassAllInContainer"] = (
        stableKey,
        bypass,
      ) => {
        const { workflow, pointerByStableKey } = get();
        if (!workflow) return;
        const resolved = resolveContainerIdentityFromStableKey(
          workflow,
          stableKey,
          pointerByStableKey,
        );
        if (!resolved) return;
        if (resolved.type === "group") {
          const targetNodeIds = collectBypassGroupTargetNodeIds(
            workflow,
            resolved.groupId,
            resolved.subgraphId,
          );
          if (targetNodeIds.size === 0) return;
          const mode = bypass ? 4 : 0;
          const newNodes = (workflow.nodes ?? []).map((node) =>
            targetNodeIds.has(node.id) ? { ...node, mode } : node,
          );
          set({ workflow: { ...workflow, nodes: newNodes } });
          return;
        }
        if (resolved.type !== "subgraph") return;
        const targetNodeIds = collectBypassSubgraphTargetNodeIds(
          workflow,
          resolved.subgraphId,
        );
        if (targetNodeIds.size === 0) return;
        const mode = bypass ? 4 : 0;
        const newNodes = (workflow.nodes ?? []).map((node) =>
          targetNodeIds.has(node.id) ? { ...node, mode } : node,
        );
        set({ workflow: { ...workflow, nodes: newNodes } });
      };

      const deleteContainer: WorkflowState["deleteContainer"] = (
        stableKey,
        options,
      ) => {
        const { workflow, stableKeyByPointer, pointerByStableKey } = get();
        if (!workflow) return;
        const resolved = resolveContainerIdentityFromStableKey(
          workflow,
          stableKey,
          pointerByStableKey,
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
          const groupStableKeys = collectGroupStableKeys(
            mobileLayout,
            groupId,
            subgraphId,
          );
          const keysToRemoveSet = new Set<string>(groupStableKeys);
          keysToRemoveSet.add(resolved.stableKey);
          const keysToRemove =
            keysToRemoveSet.size > 0
              ? [...keysToRemoveSet]
              : [resolved.stableKey];
          const deleteNodes = options?.deleteNodes ?? false;
          const targetNodeIds = deleteNodes
            ? collectBypassGroupTargetNodeIds(workflow, groupId, subgraphId)
            : new Set<number>();

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
            let nextExtra = workflow.extra;
            const rawSubgraphGroupMap = (
              workflow.extra as Record<string, unknown> | undefined
            )?.[MOBILE_SUBGRAPH_GROUP_MAP_KEY];
            if (
              rawSubgraphGroupMap &&
              typeof rawSubgraphGroupMap === "object"
            ) {
              let changed = false;
              const nextMap: Record<string, unknown> = {};
              for (const [key, value] of Object.entries(
                rawSubgraphGroupMap as Record<string, unknown>,
              )) {
                if (value === groupId) {
                  nextMap[key] = null;
                  changed = true;
                } else {
                  nextMap[key] = value;
                }
              }
              if (changed) {
                nextExtra = {
                  ...(workflow.extra ?? {}),
                  [MOBILE_SUBGRAPH_GROUP_MAP_KEY]: nextMap,
                };
              }
            }

            nextWorkflow = {
              ...workflow,
              groups: (workflow.groups ?? []).filter(
                (group) => group.id !== groupId,
              ),
              extra: nextExtra,
            };
          }

          if (targetNodeIds.size > 0) {
            nextWorkflow = removeNodeIdsFromWorkflow(
              nextWorkflow,
              targetNodeIds,
            );
          }

          const nextHiddenItems = { ...hiddenItems };
          const nextHighlightModes = { ...connectionHighlightModes };
          for (const nodeId of targetNodeIds) {
            for (const nodeStableKey of collectNodeStableKeys(
              workflow,
              stableKeyByPointer,
              nodeId,
            )) {
              delete nextHiddenItems[nodeStableKey];
            }
            for (const legacyPointer of collectNodeStateKeys(
              workflow,
              nodeId,
            )) {
              delete nextHiddenItems[legacyPointer];
            }
            delete nextHighlightModes[nodeId];
          }

          let nextMobileLayout = mobileLayout;
          for (const nodeId of targetNodeIds) {
            nextMobileLayout = removeNodeFromLayout(nextMobileLayout, nodeId);
          }
          for (const groupKey of keysToRemove) {
            nextMobileLayout = removeGroupFromLayoutByKey(
              nextMobileLayout,
              groupKey,
            );
          }

          const nextCollapsedItems = { ...collapsedItems };
          for (const groupKey of keysToRemove) {
            delete nextCollapsedItems[groupKey];
            delete nextHiddenItems[groupKey];
          }
          const reconciled = reconcileStableRegistry(
            nextMobileLayout,
            stableKeyByPointer,
            pointerByStableKey,
          );
          const nextWorkflowWithStableKeys = annotateWorkflowWithStableKeys(
            nextWorkflow,
            reconciled.layoutToStable,
          );

          set({
            workflow: nextWorkflowWithStableKeys,
            hiddenItems: nextHiddenItems,
            connectionHighlightModes: nextHighlightModes,
            mobileLayout: nextMobileLayout,
            stableKeyByPointer: reconciled.layoutToStable,
            pointerByStableKey: reconciled.stableToLayout,
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
          const targetNodeIds = collectBypassSubgraphTargetNodeIds(
            workflow,
            subgraphId,
          );
          const nextHiddenItems = { ...hiddenItems };
          const nextHighlightModes = { ...connectionHighlightModes };
          for (const nodeId of targetNodeIds) {
            for (const key of collectNodeStableKeys(
              workflow,
              stableKeyByPointer,
              nodeId,
            )) {
              delete nextHiddenItems[key];
            }
            for (const legacyPointer of collectNodeStateKeys(
              workflow,
              nodeId,
            )) {
              delete nextHiddenItems[legacyPointer];
            }
            delete nextHighlightModes[nodeId];
          }

          const nextSubgraphs = subgraphDefs.filter(
            (sg) => !removedSubgraphIds.has(sg.id),
          );
          let nextExtra = workflow.extra;
          const rawSubgraphGroupMap = (
            workflow.extra as Record<string, unknown> | undefined
          )?.[MOBILE_SUBGRAPH_GROUP_MAP_KEY];
          if (rawSubgraphGroupMap && typeof rawSubgraphGroupMap === "object") {
            const nextMap: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(
              rawSubgraphGroupMap as Record<string, unknown>,
            )) {
              if (removedSubgraphIds.has(key)) continue;
              nextMap[key] = value;
            }
            nextExtra = {
              ...(workflow.extra ?? {}),
              [MOBILE_SUBGRAPH_GROUP_MAP_KEY]: nextMap,
            };
          }

          let nextWorkflow = removeNodeIdsFromWorkflow(workflow, targetNodeIds);
          nextWorkflow = {
            ...nextWorkflow,
            definitions: {
              ...(nextWorkflow.definitions ?? {}),
              subgraphs: nextSubgraphs,
            },
            extra: nextExtra,
          };

          const nextLayout = buildLayoutForWorkflow(
            nextWorkflow,
            layoutRecordFromStableRecord(nextHiddenItems, pointerByStableKey),
          );
          const reconciled = reconcileStableRegistry(
            nextLayout,
            stableKeyByPointer,
            pointerByStableKey,
          );
          const nextWorkflowWithStableKeys = annotateWorkflowWithStableKeys(
            nextWorkflow,
            reconciled.layoutToStable,
          );
          const nextCollapsedItems = { ...collapsedItems };
          const nextHiddenSubgraphs = { ...nextHiddenItems };
          const removedSubgraphStableKeys = new Set(
            subgraphDefs
              .filter((sg) => removedSubgraphIds.has(sg.id))
              .map((sg) => sg.stableKey)
              .filter((key): key is string => typeof key === "string"),
          );
          for (const removedStableKey of removedSubgraphStableKeys) {
            delete nextCollapsedItems[removedStableKey];
            delete nextHiddenSubgraphs[removedStableKey];
          }

          set({
            workflow: nextWorkflowWithStableKeys,
            hiddenItems: nextHiddenSubgraphs,
            connectionHighlightModes: nextHighlightModes,
            mobileLayout: nextLayout,
            stableKeyByPointer: reconciled.layoutToStable,
            pointerByStableKey: reconciled.stableToLayout,
            collapsedItems: nextCollapsedItems,
          });
          return;
        }

        // Delete container only: promote direct contents and remap direct groups into parent scope.
        const parentScopeGroups =
          parentSubgraphId == null
            ? (workflow.groups ?? [])
            : (subgraphDefs.find((sg) => sg.id === parentSubgraphId)?.groups ??
              []);
        const { idMap, promotedGroups } = remapPromotedGroups(
          targetSubgraph.groups ?? [],
          parentScopeGroups,
        );

        const nextNodes = (workflow.nodes ?? []).map((node) => {
          const origin = getMobileOrigin(node);
          if (origin?.scope !== "subgraph" || origin.subgraphId !== subgraphId)
            return node;
          const props = { ...(node.properties ?? {}) } as Record<
            string,
            unknown
          >;
          props[MOBILE_ORIGIN_KEY] =
            parentSubgraphId == null
              ? { scope: "root", nodeId: origin.nodeId }
              : {
                  scope: "subgraph",
                  subgraphId: parentSubgraphId,
                  nodeId: origin.nodeId,
                };
          return { ...node, properties: props };
        });

        const nextSubgraphs = subgraphDefs
          .filter((sg) => sg.id !== subgraphId)
          .map((sg) => {
            if (parentSubgraphId != null && sg.id === parentSubgraphId) {
              return {
                ...sg,
                groups: [...(sg.groups ?? []), ...promotedGroups],
              };
            }
            return sg;
          });

        let nextRootGroups = workflow.groups ?? [];
        if (parentSubgraphId == null && promotedGroups.length > 0) {
          nextRootGroups = [...nextRootGroups, ...promotedGroups];
        }

        let nextExtra = workflow.extra;
        const rawSubgraphGroupMap = (
          workflow.extra as Record<string, unknown> | undefined
        )?.[MOBILE_SUBGRAPH_GROUP_MAP_KEY];
        if (rawSubgraphGroupMap && typeof rawSubgraphGroupMap === "object") {
          const nextMap: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(
            rawSubgraphGroupMap as Record<string, unknown>,
          )) {
            if (key === subgraphId) continue;
            nextMap[key] = value;
          }
          nextExtra = {
            ...(workflow.extra ?? {}),
            [MOBILE_SUBGRAPH_GROUP_MAP_KEY]: nextMap,
          };
        }

        const nextWorkflow: Workflow = {
          ...workflow,
          nodes: nextNodes,
          groups: nextRootGroups,
          definitions: {
            ...(workflow.definitions ?? {}),
            subgraphs: nextSubgraphs,
          },
          extra: nextExtra,
        };

        const nextLayout = buildLayoutForWorkflow(
          nextWorkflow,
          layoutRecordFromStableRecord(
            hiddenItems,
            pointerByStableKey,
          ),
        );
        const reconciled = reconcileStableRegistry(
          nextLayout,
          stableKeyByPointer,
          pointerByStableKey,
        );
        const nextCollapsedItems = { ...collapsedItems };
        const nextHiddenSubgraphs = { ...hiddenItems };
        const deletedSubgraphStableKey =
          targetSubgraph.stableKey ?? findSubgraphStableKey(workflow, subgraphId);
        if (deletedSubgraphStableKey) {
          delete nextCollapsedItems[deletedSubgraphStableKey];
          delete nextHiddenSubgraphs[deletedSubgraphStableKey];
        }

        // Remap any persisted group state that referenced promoted group ids from the deleted subgraph scope.
        const remapGroupState = (
          state: Record<string, boolean>,
        ): Record<string, boolean> => {
          const nextState: Record<string, boolean> = {};
          for (const [stableKey, value] of Object.entries(state)) {
            if (!value) continue;
            const identity = resolveContainerIdentityFromStableKey(
              workflow,
              stableKey,
              pointerByStableKey,
            );
            if (identity?.type === "group" && identity.subgraphId === subgraphId) {
              const mappedId = idMap.get(identity.groupId);
              if (mappedId == null) continue;
              const mappedKeys = collectGroupStableKeys(
                nextLayout,
                mappedId,
                parentSubgraphId,
              );
              for (const mappedKey of mappedKeys) {
                nextState[mappedKey] = true;
              }
              continue;
            }
            nextState[stableKey] = true;
          }
          return nextState;
        };

        const nextWorkflowWithStableKeys = annotateWorkflowWithStableKeys(
          nextWorkflow,
          reconciled.layoutToStable,
        );
        set(() => ({
          workflow: nextWorkflowWithStableKeys,
          mobileLayout: nextLayout,
          stableKeyByPointer: reconciled.layoutToStable,
          pointerByStableKey: reconciled.stableToLayout,
          collapsedItems: remapGroupState(nextCollapsedItems),
          hiddenItems: nextHiddenSubgraphs,
        }));
      };

      const updateContainerTitle: WorkflowState["updateContainerTitle"] = (
        stableKey,
        title,
      ) => {
        const { workflow, pointerByStableKey } = get();
        if (!workflow) return;
        const resolved = resolveContainerIdentityFromStableKey(
          workflow,
          stableKey,
          pointerByStableKey,
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
            set({
              workflow: {
                ...workflow,
                definitions: {
                  ...(workflow.definitions ?? {}),
                  subgraphs: nextSubgraphs,
                },
              },
            });
            return;
          }
          const nextGroups = (workflow.groups ?? []).map((group) =>
            group.id === groupId ? { ...group, title: nextTitle } : group,
          );
          set({ workflow: { ...workflow, groups: nextGroups } });
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
          set({
            workflow: {
              ...workflow,
              definitions: {
                ...(workflow.definitions ?? {}),
                subgraphs: nextSubgraphs,
              },
            },
          });
        }
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
                ? findSubgraphStableKey(state.workflow, subgraphId)
                : null;
              if (!key) continue;
              delete nextCollapsedItems[key];
            }
            if (target.type === "group") {
              for (const key of collectGroupStableKeys(
                state.mobileLayout,
                target.id,
                target.subgraphId ?? null,
              )) {
                nextCollapsedItems[key] = true;
              }
            } else if (target.type === "subgraph") {
              const key = state.workflow
                ? findSubgraphStableKey(state.workflow, target.id)
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

        const seedModes: Record<number, SeedMode> = {};
        if (nodeTypes) {
          for (const node of originalWorkflow.nodes) {
            const seedWidgetIndex = findSeedWidgetIndex(
              originalWorkflow,
              nodeTypes,
              node,
            );
            if (seedWidgetIndex !== null) {
              seedModes[node.id] = inferSeedMode(
                originalWorkflow,
                nodeTypes,
                node,
              );
            }
          }
        }

        const restoredWorkflow = JSON.parse(
          JSON.stringify(originalWorkflow),
        ) as Workflow;
        useSeedStore.getState().setSeedModes(seedModes);
        useSeedStore.getState().setSeedLastValues({});
        useWorkflowErrorsStore.getState().setError(null);
        set({
          savedWorkflowStates: nextSavedStates,
          ...(() => {
            const nextLayout = buildLayoutForWorkflow(
              restoredWorkflow,
              layoutRecordFromStableRecord(
                get().hiddenItems,
                get().pointerByStableKey,
              ),
            );
            const reconciled = reconcileStableRegistry(nextLayout, {}, {});
            const restoredWorkflowWithStableKeys =
              annotateWorkflowWithStableKeys(
                restoredWorkflow,
                reconciled.layoutToStable,
              );
            return {
              workflow: restoredWorkflowWithStableKeys,
              mobileLayout: nextLayout,
              stableKeyByPointer: reconciled.layoutToStable,
              pointerByStableKey: reconciled.stableToLayout,
            };
          })(),
          runCount: 1,
          workflowLoadedAt: Date.now(),
        });
      };

      // updates PrimitiveNode widget values after a generation completes, based on that node's control_after_generate mode
      const applyControlAfterGenerate: WorkflowState["applyControlAfterGenerate"] =
        () => {
          const { workflow } = get();
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
                // For INT, generate a large random number (like seed)
                // For FLOAT, generate between 0 and 1
                newValue =
                  normalizedType === "INT"
                    ? Math.floor(Math.random() * 0xffffffffffff)
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
            set({ workflow: { ...workflow, nodes: newNodes } });
          }
        };

      const queueWorkflow: WorkflowState["queueWorkflow"] = async (count) => {
        const seedStore = useSeedStore.getState();
        const seedModes = seedStore.seedModes;
        const seedLastValues = seedStore.seedLastValues;
        const { workflow, nodeTypes, embedWorkflow } = get();
        if (!workflow || !nodeTypes) {
          useWorkflowErrorsStore
            .getState()
            .setError("Node types are still loading. Try again in a moment.");
          return;
        }

        useWorkflowErrorsStore.getState().setError(null);
        set({ isLoading: true });

        try {
          let currentWorkflow = workflow;
          let currentEmbedWorkflow = embedWorkflow;
          let nextSeedLastValues: SeedLastValues = { ...seedLastValues };

          for (let i = 0; i < count; i++) {
            const seedOverrides: Record<number, number> = {};
            // Handle seed modes for each node
            const updatedNodes = currentWorkflow.nodes.map((node) => {
              const seedIndex = findSeedWidgetIndex(
                currentWorkflow,
                nodeTypes,
                node,
              );
              if (seedIndex === null) return node;
              if (!Array.isArray(node.widgets_values)) return node;

              // Check seed mode - use stored mode, or infer from workflow if not set
              const mode =
                seedModes[node.id] ??
                inferSeedMode(currentWorkflow, nodeTypes, node);
              const controlWidgetIndex = seedIndex + 1;
              const controlValue = node.widgets_values[controlWidgetIndex];
              const hasControlWidget = typeof controlValue === "string";

              if (hasControlWidget) {
                // Fixed mode or no mode set - don't change the seed
                if (!mode || mode === "fixed") {
                  return node;
                }

                const currentSeed = Number(node.widgets_values[seedIndex]) || 0;
                let nextSeed: number;

                switch (mode) {
                  case "randomize":
                    nextSeed = generateSeedFromNode(nodeTypes, node);
                    break;
                  case "increment":
                    nextSeed = currentSeed + 1;
                    break;
                  case "decrement":
                    nextSeed = currentSeed - 1;
                    break;
                  default:
                    return node;
                }

                const newWidgetValues = [...node.widgets_values];
                newWidgetValues[seedIndex] = nextSeed;
                return { ...node, widgets_values: newWidgetValues };
              }

              const rawSeed = Number(node.widgets_values[seedIndex]);
              const lastSeed = nextSeedLastValues[node.id] ?? null;
              let seedToUse: number | null = null;
              if (isSpecialSeedValue(rawSeed)) {
                seedToUse = resolveSpecialSeedToUse(
                  rawSeed,
                  lastSeed,
                  nodeTypes,
                  node,
                );
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
              if (seedToUse === null) {
                return node;
              }
              seedOverrides[node.id] = seedToUse;
              nextSeedLastValues = {
                ...nextSeedLastValues,
                [node.id]: seedToUse,
              };
              return node;
            });

            // Update current workflow with new seeds for this iteration
            currentWorkflow = { ...currentWorkflow, nodes: updatedNodes };
            if (currentEmbedWorkflow) {
              let nextEmbedWorkflow = currentEmbedWorkflow;
              for (const node of updatedNodes) {
                nextEmbedWorkflow = updateEmbedWorkflowFromExpandedNode(
                  nextEmbedWorkflow,
                  node,
                );
              }
              currentEmbedWorkflow = nextEmbedWorkflow;
            }
            seedStore.setSeedLastValues(nextSeedLastValues);
            set({
              workflow: currentWorkflow,
              embedWorkflow: currentEmbedWorkflow,
            });

            const prompt: Record<string, unknown> = {};
            const allowedNodeIds = new Set<number>();
            const classTypeById = new Map<number, string>();

            for (const node of currentWorkflow.nodes) {
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

            for (const node of currentWorkflow.nodes) {
              if (node.mode === 4) continue;
              const classType = classTypeById.get(node.id);
              if (!classType) continue;
              const inputs = buildWorkflowPromptInputs(
                currentWorkflow,
                nodeTypes,
                node,
                classType,
                allowedNodeIds,
                getWorkflowWidgetIndexMap(currentWorkflow, node.id),
                seedOverrides,
              );
              prompt[String(node.id)] = { class_type: classType, inputs };
            }

            const response = await fetch(`${api.API_BASE}/api/prompt`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt,
                client_id: api.clientId,
                extra_data: {
                  extra_pnginfo: {
                    workflow: stripWorkflowClientMetadata(
                      currentEmbedWorkflow ?? currentWorkflow,
                    ),
                  },
                },
              }),
            });

            if (!response.ok) {
              const errorData = await response.json();

              // Parse node-specific errors if present
              const nodeErrors: Record<string, NodeError[]> = {};
              if (errorData.node_errors) {
                for (const [nodeId, nodeError] of Object.entries(
                  errorData.node_errors,
                )) {
                  const errorsArray = (
                    nodeError as {
                      errors?: Array<{
                        type: string;
                        message: string;
                        details: string;
                        extra_info?: { input_name?: string };
                      }>;
                    }
                  ).errors;
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
                errorData.error?.message || "Failed to queue prompt",
              );
            }

            // Clear any previous node errors on successful queue
            useWorkflowErrorsStore.getState().clearNodeErrors();
          }
        } catch (err) {
          useWorkflowErrorsStore
            .getState()
            .setError(
              err instanceof Error ? err.message : "Failed to queue workflow",
            );
        } finally {
          useQueueStore.getState().fetchQueue();
          set({ isLoading: false });
        }
      };

      return {
        workflowSource: null,
        workflow: null,
        embedWorkflow: null,
        originalWorkflow: null,
        currentFilename: null,
        currentWorkflowKey: null,
        nodeTypes: null,
        isLoading: false,
        savedWorkflowStates: {},
        isExecuting: false,
        executingNodeId: null,
        executingPromptId: null,
        progress: 0,
        executionStartTime: null,
        currentNodeStartTime: null,
        nodeDurationStats: {},
        workflowDurationStats: {},
        nodeOutputs: {},
        nodeTextOutputs: {},
        promptOutputs: {},
        runCount: 1,
        followQueue: false,
        workflowLoadedAt: 0,
        connectionHighlightModes: {},
        connectionButtonsVisible: true,
        searchQuery: "",
        searchOpen: false,
        addNodeModalRequest: null,
        collapsedItems: {},
        hiddenItems: {},

        // Layout related
        stableKeyByPointer: {},
        pointerByStableKey: {},
        mobileLayout: createEmptyMobileLayout(),
        setMobileLayout,

        // Workflow editing related
        addNode,
        addNodeAndConnect,
        deleteNode,
        deleteContainer,
        connectNodes,
        disconnectInput,
        setNodeOutput,
        setNodeTextOutput,
        clearNodeOutputs,
        requestAddNodeModal,
        clearAddNodeModalRequest,
        toggleBypass,
        bypassAllInContainer,
        updateNodeWidget,
        updateNodeWidgets,

        // Cosmetic workflow editing
        updateNodeTitle,
        updateContainerTitle,

        // Execution related
        setExecutionState,
        addPromptOutputs,
        clearPromptOutputs,
        queueWorkflow,
        applyControlAfterGenerate,

        // bottom bar button related
        setRunCount,
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
        loadWorkflow,
        unloadWorkflow,
        setSavedWorkflow,
        clearWorkflowCache,
        updateWorkflowDuration,
        saveCurrentWorkflowState,
      };
    },
    {
      name: "workflow-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        workflow: state.workflow,
        embedWorkflow: state.embedWorkflow,
        originalWorkflow: state.originalWorkflow,
        currentFilename: state.currentFilename,
        currentWorkflowKey: state.currentWorkflowKey,
        savedWorkflowStates: state.savedWorkflowStates,
        runCount: state.runCount,
        hiddenItems: state.hiddenItems,
        collapsedItems: state.collapsedItems,
        stableKeyByPointer: state.stableKeyByPointer,
        pointerByStableKey: state.pointerByStableKey,
        connectionButtonsVisible: state.connectionButtonsVisible,
        mobileLayout: state.mobileLayout,
        isExecuting: state.isExecuting,
        executingNodeId: state.executingNodeId,
        executingPromptId: state.executingPromptId,
        progress: state.progress,
        executionStartTime: state.executionStartTime,
        currentNodeStartTime: state.currentNodeStartTime,
        nodeDurationStats: state.nodeDurationStats,
        workflowDurationStats: state.workflowDurationStats,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.workflow) {
          const normalizedLayout = state.mobileLayout
            ? normalizeMobileLayoutGroupKeys(state.mobileLayout)
            : null;
          const hiddenNodesLayout = normalizeManuallyHiddenNodeKeys(
            state.workflow,
            state.hiddenItems ?? {},
          );
          state.mobileLayout =
            normalizedLayout &&
            layoutMatchesWorkflowNodes(normalizedLayout, state.workflow)
              ? normalizedLayout
              : buildLayoutForWorkflow(state.workflow, hiddenNodesLayout);
          const reconciled = reconcileStableRegistry(
            state.mobileLayout,
            state.stableKeyByPointer ?? {},
            state.pointerByStableKey ?? {},
          );
          state.workflow = annotateWorkflowWithStableKeys(
            state.workflow,
            reconciled.layoutToStable,
          );
          if (state.originalWorkflow) {
            state.originalWorkflow = annotateWorkflowWithStableKeys(
              state.originalWorkflow,
              reconciled.layoutToStable,
            );
          }
          state.stableKeyByPointer = reconciled.layoutToStable;
          state.pointerByStableKey = reconciled.stableToLayout;
          state.hiddenItems = normalizeStableBooleanRecord(
            state.hiddenItems,
            reconciled.layoutToStable,
            reconciled.stableToLayout,
          );
          state.collapsedItems = normalizeStableCollapsedRecord(
            state.collapsedItems,
            reconciled.layoutToStable,
            reconciled.stableToLayout,
          );
          state.hiddenItems = normalizeStableBooleanRecord(
            state.hiddenItems,
            reconciled.layoutToStable,
            reconciled.stableToLayout,
          );
          state.hiddenItems = normalizeStableBooleanRecord(
            state.hiddenItems,
            reconciled.layoutToStable,
            reconciled.stableToLayout,
          );
        } else {
          state.mobileLayout = createEmptyMobileLayout();
          state.stableKeyByPointer = {};
          state.pointerByStableKey = {};
        }
        // Errors are managed by useWorkflowErrors.
      },
    },
  ),
);

export function getWorkflowSignature(workflow: Workflow): string {
  const nodes = [...workflow.nodes]
    .sort((a, b) => a.id - b.id)
    .map((node) => ({
      id: node.id,
      type: node.type,
      mode: node.mode,
      inputs: node.inputs?.map((input) => input.link ?? null) ?? [],
      outputs: node.outputs?.map((output) => output.links ?? []) ?? [],
    }));
  return JSON.stringify({
    nodes,
    links: workflow.links ?? [],
  });
}

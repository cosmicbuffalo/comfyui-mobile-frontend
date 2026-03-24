import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  HistoryOutputImage,
  Workflow,
  WorkflowGroup,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphLink,
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
import { useRecentWorkflowsStore } from "@/hooks/useRecentWorkflows";
import { useSeedStore } from "@/hooks/useSeed";
import { useGenerationSettingsStore } from "@/hooks/useGenerationSettings";
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
  flattenLayoutToNodeOrder,
  getGroupKey,
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
  getBottomPlacementForScope,
  getPositionNearNode,
} from "@/utils/nodePositioning";
import { syncWorkflowGeometryFromLayoutChange } from "@/utils/graphSync";
import {
  type ScopeFrame,
  resolveCurrentScope,
  resolveNodeByHierarchicalKey,
  getLinkId,
  getLinkOriginId,
  getLinkOriginSlot,
  getLinkTargetId,
  getLinkTargetSlot,
  getLinkType,
  makeScopeLink,
} from "@/utils/canonicalWorkflowOps";
import { computeNodeGroupsFor } from "@/utils/nodeGroups";
import { findLayoutPath } from "@/utils/layoutTraversal";
import { resolveWorkflowColor, themeColors } from "@/theme/colors";
import { validateAndNormalizeWorkflow } from "@/utils/workflowValidator";

// ScopeFrame is defined in canonicalWorkflowOps.ts and re-exported here.
export type { ScopeFrame };

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
  resolveSubgraphPlaceholderWidgetDefs,
  resolveSubgraphPlaceholderInputWidgetDefs,
  resolveSubgraphProxyWidgetDefs,
  resolveSubgraphProxyInputWidgetDefs,
};

// Internal type alias
type SeedModeType = SeedMode;
type SeedLastValues = Record<number, number | null>;
type HierarchicalKey = string;
type ScopedNodeIdentity = { nodeId: number; subgraphId: string | null };
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
        keys.push(getGroupKey(ref.id, ref.subgraphId));
        if (visitedGroups.has(getGroupKey(ref.id, ref.subgraphId))) continue;
        visitedGroups.add(getGroupKey(ref.id, ref.subgraphId));
        visit(layout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? [], currentSubgraphId);
        continue;
      }
      if (ref.type === "subgraph") {
        // Each placeholder instance gets a unique pointer keyed by its node ID.
        // This ensures two instances of the same definition occupy separate pointer-keyed
        // slots in collapsedItems / pointerByHierarchicalKey rather than colliding on the
        // definition UUID.
        const instanceId = ref.nodeId !== undefined ? String(ref.nodeId) : ref.id;
        const sgKey = makeLocationPointer({ type: "subgraph", subgraphId: instanceId });
        keys.push(sgKey);
        // Inner nodes are shared across all instances of the same definition —
        // only traverse once per definition UUID.
        if (visitedSubgraphs.has(ref.id)) continue;
        visitedSubgraphs.add(ref.id);
        visit(layout.subgraphs[ref.id] ?? [], ref.id);
      }
    }
  };
  visit(layout.root, null);
  return keys;
}

function reconcilePointerRegistry(
  layout: MobileLayout,
  _prevLayoutToStable: Record<string, HierarchicalKey>,
  _prevStableToLayout: Record<HierarchicalKey, string>,
): {
  layoutToStable: Record<string, HierarchicalKey>;
  stableToLayout: Record<HierarchicalKey, string>;
} {
  void _prevLayoutToStable;
  void _prevStableToLayout;
  const nextPointers = collectLayoutObjectKeys(layout);
  const layoutToStable: Record<string, HierarchicalKey> = {};
  const stableToLayout: Record<HierarchicalKey, string> = {};

  for (const pointer of nextPointers) {
    layoutToStable[pointer] = pointer;
    stableToLayout[pointer] = pointer;
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
  // Under the canonical model, workflow.nodes only contains root-scope nodes.
  return nodeStateKey(node.id, null);
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

function collectGroupHierarchicalKeys(
  layout: MobileLayout,
  groupId: number,
  subgraphId: string | null = null,
): string[] {
  const keys = new Set<string>();
  const visit = (refs: ItemRef[], currentSubgraphId: string | null) => {
    for (const ref of refs) {
      if (ref.type === "group") {
        if (ref.id === groupId && currentSubgraphId === subgraphId) {
          keys.add(getGroupKey(ref.id, ref.subgraphId));
        }
        visit(layout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? [], currentSubgraphId);
      } else if (ref.type === "subgraph") {
        visit(layout.subgraphs[ref.id] ?? [], ref.id);
      }
    }
  };
  visit(layout.root, null);
  return [...keys];
}

function scopedNodeIdentityKey(identity: ScopedNodeIdentity): string {
  return `${identity.subgraphId ?? "root"}:${identity.nodeId}`;
}

function dedupeScopedNodeIdentities(
  identities: Iterable<ScopedNodeIdentity>,
): ScopedNodeIdentity[] {
  const keyed = new Map<string, ScopedNodeIdentity>();
  for (const identity of identities) {
    keyed.set(scopedNodeIdentityKey(identity), identity);
  }
  return [...keyed.values()];
}

function collectScopedNodeIdentitiesFromLayoutRefs(
  layout: MobileLayout,
  refs: ItemRef[],
  currentSubgraphId: string | null = null,
  visitedGroups = new Set<string>(),
  visitedSubgraphs = new Set<string>(),
): ScopedNodeIdentity[] {
  const identities: ScopedNodeIdentity[] = [];
  for (const ref of refs) {
    if (ref.type === "node") {
      identities.push({ nodeId: ref.id, subgraphId: currentSubgraphId });
      continue;
    }
    if (ref.type === "hiddenBlock") {
      for (const nodeId of layout.hiddenBlocks[ref.blockId] ?? []) {
        identities.push({ nodeId, subgraphId: currentSubgraphId });
      }
      continue;
    }
    if (ref.type === "group") {
      if (visitedGroups.has(getGroupKey(ref.id, ref.subgraphId))) continue;
      visitedGroups.add(getGroupKey(ref.id, ref.subgraphId));
      const nestedNodeIds = collectScopedNodeIdentitiesFromLayoutRefs(
        layout,
        layout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? [],
        currentSubgraphId,
        visitedGroups,
        visitedSubgraphs,
      );
      identities.push(...nestedNodeIds);
      visitedGroups.delete(getGroupKey(ref.id, ref.subgraphId));
      continue;
    }
    if (visitedSubgraphs.has(ref.id)) continue;
    visitedSubgraphs.add(ref.id);
    const nestedNodeIds = collectScopedNodeIdentitiesFromLayoutRefs(
      layout,
      layout.subgraphs[ref.id] ?? [],
      ref.id,
      visitedGroups,
      visitedSubgraphs,
    );
    identities.push(...nestedNodeIds);
    visitedSubgraphs.delete(ref.id);
  }
  return dedupeScopedNodeIdentities(identities);
}

function toHierarchicalKey(
  pointer: string,
  itemKeyByPointer: Record<string, HierarchicalKey>,
): HierarchicalKey | null {
  return itemKeyByPointer[pointer] ?? null;
}

function toHierarchicalKeys(
  pointers: string[],
  itemKeyByPointer: Record<string, HierarchicalKey>,
): HierarchicalKey[] {
  const seen = new Set<HierarchicalKey>();
  const keys: HierarchicalKey[] = [];
  for (const pointer of pointers) {
    const itemKey = toHierarchicalKey(pointer, itemKeyByPointer);
    if (!itemKey || seen.has(itemKey)) continue;
    seen.add(itemKey);
    keys.push(itemKey);
  }
  return keys;
}

function collectNodeHierarchicalKeysFromRegistry(
  itemKeyByPointer: Record<string, HierarchicalKey>,
  nodeId: number,
  subgraphId: string | null = null,
): HierarchicalKey[] {
  const keys: HierarchicalKey[] = [];
  const seen = new Set<HierarchicalKey>();
  for (const [pointer, itemKey] of Object.entries(itemKeyByPointer)) {
    if (seen.has(itemKey)) continue;
    const parsed = parseLocationPointer(pointer);
    if (parsed?.type !== "node") continue;
    if (parsed.nodeId !== nodeId) continue;
    if (subgraphId !== null && parsed.subgraphId !== subgraphId) continue;
    seen.add(itemKey);
    keys.push(itemKey);
  }
  return keys;
}

function collectNodeHierarchicalKeys(
  workflow: Workflow,
  itemKeyByPointer: Record<string, HierarchicalKey>,
  nodeId: number,
  subgraphId: string | null = null,
): HierarchicalKey[] {
  const keys = collectNodeHierarchicalKeysFromRegistry(
    itemKeyByPointer,
    nodeId,
    subgraphId,
  );
  if (keys.length > 0) return keys;
  return toHierarchicalKeys(
    collectNodeStateKeys(workflow, nodeId, subgraphId),
    itemKeyByPointer,
  );
}

function clearNodeUiStateForTargets(
  workflow: Workflow,
  itemKeyByPointer: Record<string, HierarchicalKey>,
  hiddenItems: Record<string, boolean>,
  connectionHighlightModes: Record<HierarchicalKey, "off" | "inputs" | "outputs" | "both">,
  targets: ScopedNodeIdentity[],
): {
  hiddenItems: Record<string, boolean>;
  connectionHighlightModes: Record<HierarchicalKey, "off" | "inputs" | "outputs" | "both">;
} {
  const nextHiddenItems = { ...hiddenItems };
  const nextHighlightModes = { ...connectionHighlightModes };
  for (const { nodeId, subgraphId } of targets) {
    const nodeHierarchicalKeys = collectNodeHierarchicalKeys(
      workflow,
      itemKeyByPointer,
      nodeId,
      subgraphId,
    );
    for (const nodeHierarchicalKey of nodeHierarchicalKeys) {
      delete nextHiddenItems[nodeHierarchicalKey];
      delete nextHighlightModes[nodeHierarchicalKey];
    }
    for (const legacyPointer of collectNodeStateKeys(
      workflow,
      nodeId,
      subgraphId,
    )) {
      delete nextHiddenItems[legacyPointer];
    }
  }
  return {
    hiddenItems: nextHiddenItems,
    connectionHighlightModes: nextHighlightModes,
  };
}

function resolveNodeIdentityFromHierarchicalKey(
  workflow: Workflow,
  itemKey: HierarchicalKey,
  _pointerByHierarchicalKey?: Record<string, string>,
): { nodeId: number; subgraphId: string | null } | null {
  void _pointerByHierarchicalKey;
  // Search root canonical nodes first
  const rootNode = workflow.nodes.find((entry) => entry.itemKey === itemKey);
  if (rootNode) {
    return { nodeId: rootNode.id, subgraphId: null };
  }
  // Search subgraph inner nodes
  for (const sg of workflow.definitions?.subgraphs ?? []) {
    const innerNode = (sg.nodes ?? []).find((n) => n.itemKey === itemKey);
    if (innerNode) {
      return { nodeId: innerNode.id, subgraphId: sg.id };
    }
  }
  return null;
}

type ContainerIdentity =
  | { type: "group"; groupId: number; subgraphId: string | null; itemKey: HierarchicalKey }
  | { type: "subgraph"; subgraphId: string; itemKey: HierarchicalKey };

function resolveLayoutPointerForStateKey(
  key: string,
  stableToLayout: Record<string, string>,
): string | null {
  const mappedPointer = stableToLayout[key];
  if (mappedPointer) return mappedPointer;
  if (parseLocationPointer(key)) return key;
  return null;
}

function resolveContainerIdentityFromHierarchicalKey(
  workflow: Workflow,
  itemKey: HierarchicalKey,
  _pointerByHierarchicalKey?: Record<string, string>,
): ContainerIdentity | null {
  void _pointerByHierarchicalKey;
  const rootGroup = (workflow.groups ?? []).find((group) => group.itemKey === itemKey);
  if (rootGroup) {
    return {
      type: "group",
      groupId: rootGroup.id,
      subgraphId: null,
      itemKey,
    };
  }

  for (const subgraph of workflow.definitions?.subgraphs ?? []) {
    if (subgraph.itemKey === itemKey) {
      return {
        type: "subgraph",
        subgraphId: subgraph.id,
        itemKey,
      };
    }
    const nestedGroup = (subgraph.groups ?? []).find((group) => group.itemKey === itemKey);
    if (nestedGroup) {
      return {
        type: "group",
        groupId: nestedGroup.id,
        subgraphId: subgraph.id,
        itemKey,
      };
    }
  }

  return null;
}

function findSubgraphHierarchicalKey(
  workflow: Workflow,
  subgraphId: string,
): HierarchicalKey | null {
  const subgraph = (workflow.definitions?.subgraphs ?? []).find(
    (entry) => entry.id === subgraphId,
  );
  return subgraph?.itemKey ?? null;
}

function findGroupSubgraphIdByHierarchicalKey(
  layout: MobileLayout,
  groupHierarchicalKey: string,
): string | null {
  const parent = layout.groupParents?.[groupHierarchicalKey];
  if (!parent) return null;
  if (parent.scope === "subgraph") return parent.subgraphId;
  if (parent.scope === "root") return null;
  return findGroupSubgraphIdByHierarchicalKey(layout, parent.groupKey);
}

function pointerRecordFromLayoutRecord(
  layoutState: Record<string, boolean> | undefined,
  itemKeyByPointer: Record<string, HierarchicalKey>,
): Record<string, boolean> {
  if (!layoutState) return {};
  const next: Record<string, boolean> = {};
  for (const [pointer, value] of Object.entries(layoutState)) {
    if (!value) continue;
    const itemKey = toHierarchicalKey(pointer, itemKeyByPointer);
    if (!itemKey) continue;
    next[itemKey] = true;
  }
  return next;
}

function pointerCollapsedRecordFromLayoutRecord(
  layoutState: Record<string, boolean> | undefined,
  itemKeyByPointer: Record<string, HierarchicalKey>,
): Record<string, boolean> {
  if (!layoutState) return {};
  const next: Record<string, boolean> = {};
  for (const [pointer, value] of Object.entries(layoutState)) {
    if (value !== true) continue;
    const itemKey = toHierarchicalKey(pointer, itemKeyByPointer);
    if (!itemKey) continue;
    next[itemKey] = true;
  }
  return next;
}

function normalizePointerBooleanRecord(
  state: Record<string, boolean> | undefined,
  itemKeyByPointer: Record<string, HierarchicalKey>,
  pointerByHierarchicalKey: Record<string, string>,
): Record<string, boolean> {
  if (!state) return {};
  const next: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(state)) {
    if (!value) continue;
    const pointer = resolveLayoutPointerForStateKey(key, pointerByHierarchicalKey);
    const itemKey = pointer ? itemKeyByPointer[pointer] : itemKeyByPointer[key];
    if (!itemKey) continue;
    next[itemKey] = true;
  }
  return next;
}

function normalizePointerCollapsedRecord(
  state: Record<string, boolean> | undefined,
  itemKeyByPointer: Record<string, HierarchicalKey>,
  pointerByHierarchicalKey: Record<string, string>,
): Record<string, boolean> {
  if (!state) return {};
  const next: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(state)) {
    if (value !== true) continue;
    const pointer = resolveLayoutPointerForStateKey(key, pointerByHierarchicalKey);
    const itemKey = pointer ? itemKeyByPointer[pointer] : itemKeyByPointer[key];
    if (!itemKey) continue;
    next[itemKey] = true;
  }
  return next;
}

function normalizePointerBookmarkList(
  bookmarks: string[] | undefined,
  itemKeyByPointer: Record<string, HierarchicalKey>,
  pointerByHierarchicalKey: Record<string, string>,
): string[] {
  if (!bookmarks || bookmarks.length === 0) return [];
  const next: string[] = [];
  const seen = new Set<string>();
  for (const key of bookmarks) {
    if (!key) continue;
    const pointer = resolveLayoutPointerForStateKey(key, pointerByHierarchicalKey);
    const itemKey = pointer ? itemKeyByPointer[pointer] : itemKeyByPointer[key];
    if (!itemKey || seen.has(itemKey)) continue;
    seen.add(itemKey);
    next.push(itemKey);
  }
  return next;
}

function layoutRecordFromPointerRecord(
  state: Record<string, boolean> | undefined,
  pointerByHierarchicalKey: Record<string, string>,
): Record<string, boolean> {
  if (!state) return {};
  const next: Record<string, boolean> = {};
  for (const [itemKey, value] of Object.entries(state)) {
    if (!value) continue;
    const pointer = pointerByHierarchicalKey[itemKey];
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
  | { type: "file"; filePath: string; assetSource: "output" | "input" | "temp" }
  | { type: "other" };

interface WorkflowState {
  // Workflow source tracking for reload functionality
  workflowSource: WorkflowSource | null;

  // Workflow data
  workflow: Workflow | null;
  originalWorkflow: Workflow | null; // For dirty check

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
  // Node text output previews (keyed by node ID)
  nodeTextOutputs: Record<string, string>;
  // Prompt output images (keyed by prompt ID)
  promptOutputs: Record<string, HistoryOutputImage[]>;
  runCount: number;
  followQueue: boolean;
  workflowLoadedAt: number;
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
    options?: { fresh?: boolean; source?: WorkflowSource },
  ) => void;
  unloadWorkflow: () => void;
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
  updateNodeTitle: (itemKey: HierarchicalKey, title: string | null) => void;
  toggleBypass: (itemKey: HierarchicalKey) => void;
  scrollToNode: (itemKey: HierarchicalKey, label?: string) => void;
  setNodeTypes: (types: NodeTypes) => void;
  setExecutionState: (
    executing: boolean,
    itemKey: HierarchicalKey | null,
    promptId: string | null,
    progress: number,
    executingNodePath?: string | null,
  ) => void;
  queueWorkflow: (count: number) => Promise<void>;
  saveCurrentWorkflowState: () => void;
  setNodeOutput: (itemKey: HierarchicalKey, images: NodeOutputImage[]) => void;
  setNodeTextOutput: (itemKey: HierarchicalKey, text: string) => void;
  clearNodeOutputs: () => void;
  latentPreviews: Record<string, string>;
  setLatentPreview: (url: string, itemKey: string | null) => void;
  clearAllLatentPreviews: () => void;
  addPromptOutputs: (promptId: string, images: HistoryOutputImage[]) => void;
  clearPromptOutputs: (promptId?: string) => void;
  setRunCount: (count: number) => void;
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
  applyControlAfterGenerate: () => void;

  // Scope navigation
  enterSubgraph: (placeholderNodeId: number) => void;
  exitSubgraph: () => void;
  exitToRoot: () => void;
  /** Pop the scope stack to exactly `depth` frames (1 = root). No-op if already at or above target. */
  exitToDepth: (depth: number) => void;
  navigateToSubgraphTrail: (subgraphIds: string[]) => boolean;
}

function normalizeWorkflowNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node) => {
    const normalized = {
      ...node,
      inputs: node.inputs ?? [],
      outputs: node.outputs ?? [],
      flags: node.flags ?? {},
      properties: node.properties ?? {},
      mode: node.mode ?? 0,
      order: node.order ?? 0,
    };

    if (
      normalized.type === "Fast Groups Bypasser (rgthree)" &&
      Array.isArray(normalized.widgets_values) &&
      normalized.widgets_values.length === 0
    ) {
      const withoutWidgetsValues = { ...normalized } as Partial<WorkflowNode>;
      delete withoutWidgetsValues.widgets_values;
      return withoutWidgetsValues as WorkflowNode;
    }

    return normalized;
  });
}


function stripNodeClientMetadata(node: WorkflowNode): WorkflowNode {
  if (!("itemKey" in node)) return node;
  const { itemKey, ...rest } = node;
  void itemKey;
  return rest as WorkflowNode;
}

function stripGroupClientMetadata(group: WorkflowGroup): WorkflowGroup {
  if (!("itemKey" in group)) return group;
  const { itemKey, ...rest } = group;
  void itemKey;
  return rest as WorkflowGroup;
}

export function stripWorkflowClientMetadata(workflow: Workflow): Workflow {
  const nextNodes = workflow.nodes.map(stripNodeClientMetadata);
  const nextGroups = (workflow.groups ?? []).map(stripGroupClientMetadata);
  const hadRootHierarchicalKeys =
    nextNodes.some((node, index) => node !== workflow.nodes[index]) ||
    nextGroups.some((group, index) => group !== (workflow.groups ?? [])[index]);
  const subgraphs = workflow.definitions?.subgraphs;
  if (!subgraphs) {
    return hadRootHierarchicalKeys
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
    if (subgraph.itemKey != null) changed = true;
    if (!changed) return subgraph;
    subgraphChanged = true;
    const { itemKey, ...subgraphRest } = subgraph;
    void itemKey;
    return { ...subgraphRest, nodes: cleanedNodes, groups: cleanedGroups };
  });

  if (!hadRootHierarchicalKeys && !subgraphChanged) return workflow;

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


function getNodePointerFromWorkflowNode(node: WorkflowNode): string {
  // Under the canonical model, this is only called for root-scope nodes.
  return makeLocationPointer({ type: "node", nodeId: node.id, subgraphId: null });
}

function buildScopeStackForSubgraphTrail(
  workflow: Workflow,
  subgraphIds: string[],
): ScopeFrame[] | null {
  const subgraphById = new Map(
    (workflow.definitions?.subgraphs ?? []).map((subgraph) => [subgraph.id, subgraph]),
  );
  const scopeStack: ScopeFrame[] = [{ type: "root" }];
  let currentNodes = workflow.nodes;

  for (const subgraphId of subgraphIds) {
    const placeholderNode = currentNodes.find((node) => node.type === subgraphId);
    const subgraph = subgraphById.get(subgraphId);
    if (!placeholderNode || !subgraph) return null;
    scopeStack.push({
      type: "subgraph",
      id: subgraphId,
      placeholderNodeId: placeholderNode.id,
    });
    currentNodes = subgraph.nodes ?? [];
  }

  return scopeStack;
}

function withHierarchicalKeysForNodes(
  nodes: WorkflowNode[],
  itemKeyByPointer: Record<string, HierarchicalKey>,
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
    const itemKey = itemKeyByPointer[pointer];
    if (!itemKey) return node;
    if (node.itemKey === itemKey) return node;
    return { ...node, itemKey };
  });
}

function withHierarchicalKeysForGroups(
  groups: WorkflowGroup[],
  itemKeyByPointer: Record<string, HierarchicalKey>,
  subgraphId: string | null,
): WorkflowGroup[] {
  return groups.map((group) => {
    const pointer = makeLocationPointer({
      type: "group",
      groupId: group.id,
      subgraphId,
    });
    const itemKey = itemKeyByPointer[pointer];
    if (!itemKey) return group;
    if (group.itemKey === itemKey) return group;
    return { ...group, itemKey };
  });
}

function hasMissingHierarchicalKeys(workflow: Workflow): boolean {
  if (workflow.nodes.some((node) => !node.itemKey)) return true;
  if ((workflow.groups ?? []).some((group) => !group.itemKey)) return true;
  for (const subgraph of workflow.definitions?.subgraphs ?? []) {
    if (!subgraph.itemKey) return true;
    if ((subgraph.nodes ?? []).some((node) => !node.itemKey)) return true;
    if ((subgraph.groups ?? []).some((group) => !group.itemKey)) return true;
  }
  return false;
}

function hasLayoutGroupKeyMismatch(workflow: Workflow, layout: MobileLayout): boolean {
  for (const group of workflow.groups ?? []) {
    if (group.itemKey && !(group.itemKey in layout.groups)) return true;
  }
  for (const subgraph of workflow.definitions?.subgraphs ?? []) {
    for (const group of subgraph.groups ?? []) {
      if (group.itemKey && !(group.itemKey in layout.groups)) return true;
    }
  }
  return false;
}

function ensureWorkflowHasHierarchicalKeys(workflow: Workflow): Workflow {
  const nextNodes = (workflow.nodes ?? []).map((node) => {
    const itemKey = makeLocationPointer({
      type: "node",
      nodeId: node.id,
      subgraphId: null,
    });
    return node.itemKey === itemKey ? node : { ...node, itemKey };
  });
  const nextGroups = (workflow.groups ?? []).map((group) => {
    const itemKey = makeLocationPointer({
      type: "group",
      groupId: group.id,
      subgraphId: null,
    });
    return group.itemKey === itemKey ? group : { ...group, itemKey };
  });
  const nextSubgraphs = (workflow.definitions?.subgraphs ?? []).map((subgraph) => {
    const itemKey = makeLocationPointer({
      type: "subgraph",
      subgraphId: subgraph.id,
    });
    const nodes = (subgraph.nodes ?? []).map((n) => {
      const nodeKey = makeLocationPointer({
        type: "node",
        nodeId: n.id,
        subgraphId: subgraph.id,
      });
      return n.itemKey === nodeKey ? n : { ...n, itemKey: nodeKey };
    });
    const groups = (subgraph.groups ?? []).map((g) => {
      const groupKey = makeLocationPointer({
        type: "group",
        groupId: g.id,
        subgraphId: subgraph.id,
      });
      return g.itemKey === groupKey ? g : { ...g, itemKey: groupKey };
    });
    return { ...subgraph, itemKey, nodes, groups };
  });

  if (
    nextNodes.every((node, index) => node === workflow.nodes[index]) &&
    nextGroups.every((group, index) => group === (workflow.groups ?? [])[index]) &&
    nextSubgraphs.every(
      (subgraph, index) => subgraph === (workflow.definitions?.subgraphs ?? [])[index],
    )
  ) {
    return workflow;
  }

  return {
    ...workflow,
    nodes: nextNodes,
    groups: nextGroups,
    definitions: workflow.definitions
      ? {
          ...workflow.definitions,
          subgraphs: nextSubgraphs,
        }
      : workflow.definitions,
  };
}

function canonicalizeWorkflowHierarchicalKeys(
  workflow: Workflow,
  itemKeyByPointer: Record<string, HierarchicalKey>,
): Workflow {
  return annotateWorkflowWithHierarchicalKeys(workflow, itemKeyByPointer);
}

function annotateWorkflowWithHierarchicalKeys(
  workflow: Workflow,
  itemKeyByPointer: Record<string, HierarchicalKey>,
): Workflow {
  const workflowWithStableFallbacks = ensureWorkflowHasHierarchicalKeys(workflow);
  const nextNodes = withHierarchicalKeysForNodes(
    workflowWithStableFallbacks.nodes,
    itemKeyByPointer,
  );
  const nextGroups = withHierarchicalKeysForGroups(
    workflowWithStableFallbacks.groups ?? [],
    itemKeyByPointer,
    null,
  );
  const rootNodesChanged = nextNodes.some(
    (node, index) => node !== workflowWithStableFallbacks.nodes[index],
  );
  const rootGroupsChanged = nextGroups.some(
    (group, index) => group !== (workflowWithStableFallbacks.groups ?? [])[index],
  );

  const subgraphs = workflowWithStableFallbacks.definitions?.subgraphs;
  if (!subgraphs) {
    return rootNodesChanged || rootGroupsChanged
      ? { ...workflowWithStableFallbacks, nodes: nextNodes, groups: nextGroups }
      : workflowWithStableFallbacks;
  }

  let subgraphsChanged = false;
  const nextSubgraphs = subgraphs.map((subgraph) => {
    const nextSubgraphNodes = withHierarchicalKeysForNodes(
      subgraph.nodes ?? [],
      itemKeyByPointer,
      subgraph.id,
    );
    const nextSubgraphGroups = withHierarchicalKeysForGroups(
      subgraph.groups ?? [],
      itemKeyByPointer,
      subgraph.id,
    );
    const subgraphPointer = makeLocationPointer({
      type: "subgraph",
      subgraphId: subgraph.id,
    });
    const subgraphHierarchicalKey = itemKeyByPointer[subgraphPointer];
    const changed =
      nextSubgraphNodes.some(
        (node, index) => node !== (subgraph.nodes ?? [])[index],
      ) ||
      nextSubgraphGroups.some(
        (group, index) => group !== (subgraph.groups ?? [])[index],
      ) ||
      (subgraphHierarchicalKey != null && subgraph.itemKey !== subgraphHierarchicalKey);
    if (!changed) return subgraph;
    subgraphsChanged = true;
    return {
      ...subgraph,
      itemKey: subgraphHierarchicalKey ?? subgraph.itemKey,
      nodes: nextSubgraphNodes,
      groups: nextSubgraphGroups,
    };
  });

  if (!rootNodesChanged && !rootGroupsChanged && !subgraphsChanged)
    return workflowWithStableFallbacks;

  return {
    ...workflowWithStableFallbacks,
    nodes: nextNodes,
    groups: nextGroups,
    definitions: {
      ...(workflowWithStableFallbacks.definitions ?? {}),
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

export function collectBypassGroupTargetNodes(
  workflow: Workflow,
  groupId: number,
  subgraphId: string | null = null,
): ScopedNodeIdentity[] {
  const groups = workflow.groups ?? [];
  const subgraphs = workflow.definitions?.subgraphs ?? [];

  const subgraphById = new Map(subgraphs.map((sg) => [sg.id, sg]));
  const subgraphIds = new Set(subgraphs.map((sg) => sg.id));
  // Under the canonical model, workflow.nodes contains only root nodes (+ placeholders).
  // Inner subgraph nodes live in sg.nodes, not in workflow.nodes.
  const rootNodes: WorkflowNode[] = workflow.nodes ?? [];

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

  const targetNodes: ScopedNodeIdentity[] = [];

  if (subgraphId) {
    const subgraph = subgraphById.get(subgraphId);
    if (!subgraph) return [];
    const subgraphGroups = subgraph.groups ?? [];
    const group = subgraphGroups.find((g) => g.id === groupId);
    if (!group) return [];

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

    // Canonical model: directNodeOriginIds contains inner node IDs directly
    for (const nodeId of directNodeOriginIds) {
      targetNodes.push({ nodeId, subgraphId });
    }

    // Include nodes in descendant subgraphs (nested placeholders)
    const descendantSubgraphs = collectDescendantSubgraphs(
      nestedSubgraphIds,
      subgraphChildMap,
    );
    for (const nestedId of descendantSubgraphs) {
      const nestedSubgraph = subgraphById.get(nestedId);
      for (const node of nestedSubgraph?.nodes ?? []) {
        targetNodes.push({ nodeId: node.id, subgraphId: nestedId });
      }
    }
  } else {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return [];

    const nodeToGroup = computeNodeGroupsFor(rootNodes, groups);
    for (const node of rootNodes) {
      if (nodeToGroup.get(node.id) === groupId) {
        targetNodes.push({ nodeId: node.id, subgraphId: null });
      }
    }

    // Under the canonical model, placeholder nodes whose type is a subgraph UUID
    // identify which subgraphs are directly contained in this group.
    const directSubgraphIds = new Set<string>();
    for (const node of rootNodes) {
      if (nodeToGroup.get(node.id) === groupId && subgraphIds.has(node.type)) {
        directSubgraphIds.add(node.type);
      }
    }

    const descendantSubgraphs = collectDescendantSubgraphs(
      directSubgraphIds,
      subgraphChildMap,
    );
    // Under the canonical model, inner nodes of descendant subgraphs are in sg.nodes.
    // Placeholder nodes (already in targetNodeIds) serve as the delete/bypass targets.
    // Additionally collect all inner nodes of descendant subgraphs so callers can
    // clean up subgraph definitions and hidden-item state.
    for (const sgId of descendantSubgraphs) {
      const sg = subgraphById.get(sgId);
      for (const node of sg?.nodes ?? []) {
        targetNodes.push({ nodeId: node.id, subgraphId: sgId });
      }
    }
  }

  return dedupeScopedNodeIdentities(targetNodes);
}

function collectBypassContainerTargetNodesFromLayout(
  workflow: Workflow,
  layout: MobileLayout,
  itemKey: HierarchicalKey,
): ScopedNodeIdentity[] {
  const identity = resolveContainerIdentityFromHierarchicalKey(workflow, itemKey);
  if (!identity) return [];

  if (identity.type === "group") {
    const groupHierarchicalKeys = collectGroupHierarchicalKeys(
      layout,
      identity.groupId,
      identity.subgraphId,
    );
    const nodeIdentities: ScopedNodeIdentity[] = [];
    for (const groupHierarchicalKey of groupHierarchicalKeys) {
      const nestedNodeIds = collectScopedNodeIdentitiesFromLayoutRefs(
        layout,
        layout.groups[groupHierarchicalKey] ?? [],
        identity.subgraphId,
      );
      nodeIdentities.push(...nestedNodeIds);
    }
    return dedupeScopedNodeIdentities(nodeIdentities);
  }

  const subgraphRefs = layout.subgraphs[identity.subgraphId] ?? [];
  return collectScopedNodeIdentitiesFromLayoutRefs(
    layout,
    subgraphRefs,
    identity.subgraphId,
  );
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

function collectBypassSubgraphTargetNodes(
  workflow: Workflow,
  subgraphId: string,
): ScopedNodeIdentity[] {
  const subgraphs = workflow.definitions?.subgraphs ?? [];
  const subgraphIds = new Set(subgraphs.map((sg) => sg.id));
  const subgraphById = new Map(subgraphs.map((sg) => [sg.id, sg]));
  const subgraphChildMap = getSubgraphChildMap(workflow);
  const descendantSubgraphs = collectDescendantSubgraphs(
    [subgraphId],
    subgraphChildMap,
  );
  const targetNodes: ScopedNodeIdentity[] = [];
  for (const sgId of descendantSubgraphs) {
    const sg = subgraphById.get(sgId);
    for (const node of sg?.nodes ?? []) {
      // Exclude nested placeholder nodes (they are subgraph containers, not real nodes)
      if (!subgraphIds.has(node.type)) {
        targetNodes.push({ nodeId: node.id, subgraphId: sgId });
      }
    }
  }
  return dedupeScopedNodeIdentities(targetNodes);
}

function getParentSubgraphIdFromContainer(
  containerId: ContainerId,
  layout: MobileLayout,
): string | null {
  if (containerId.scope === "subgraph") return containerId.subgraphId;
  if (containerId.scope === "root") return null;
  return findGroupSubgraphIdByHierarchicalKey(layout, containerId.groupKey);
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
          scopeStack,
        } = get();
        if (!workflow) return;

        const scope = resolveCurrentScope(scopeStack, workflow);
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

        let nextLastLinkId = workflow.last_link_id;
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
        const { workflow, scopeStack } = get();
        if (!workflow) return;
        const scope = resolveCurrentScope(scopeStack, workflow);

        const srcNode = resolveNodeByHierarchicalKey(scope.nodes, srcHierarchicalKey);
        const tgtNode = resolveNodeByHierarchicalKey(scope.nodes, tgtHierarchicalKey);
        if (!srcNode || !tgtNode) return;
        const srcNodeId = srcNode.id;
        const tgtNodeId = tgtNode.id;

        let newLinks = [...scope.links];
        let nextLastLinkId = workflow.last_link_id;

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
        const { workflow, scopeStack } = get();
        if (!workflow) return;
        const scope = resolveCurrentScope(scopeStack, workflow);
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
          nearNodeHierarchicalKey: targetHierarchicalKey,
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

      const setNodeOutput: WorkflowState["setNodeOutput"] = (
        itemKey,
        images,
      ) => {
        set((state) => ({
          ...(() => {
            const identity = state.workflow
              ? resolveNodeIdentityFromHierarchicalKey(
                  state.workflow,
                  itemKey,
                  state.pointerByHierarchicalKey,
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
        itemKey,
        text,
      ) => {
        set((state) => ({
          ...(() => {
            const identity = state.workflow
              ? resolveNodeIdentityFromHierarchicalKey(
                  state.workflow,
                  itemKey,
                  state.pointerByHierarchicalKey,
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
            return {
              connectionHighlightModes: {
                ...state.connectionHighlightModes,
                [canonicalHierarchicalKey]: next,
              },
            };
          });
        };

      const setConnectionHighlightMode: WorkflowState["setConnectionHighlightMode"] =
        (itemKey, mode) => {
          set((state) => ({
            connectionHighlightModes: {
              ...state.connectionHighlightModes,
              [state.itemKeyByPointer[itemKey] ?? itemKey]: mode,
            },
          }));
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
        const { workflow, scopeStack } = get();
        if (!workflow) return;
        const scope = resolveCurrentScope(scopeStack, workflow);
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
        const { workflow, scopeStack } = get();
        if (!workflow) return;
        const scope = resolveCurrentScope(scopeStack, workflow);
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

      const updateNodeTitle: WorkflowState["updateNodeTitle"] = (
        itemKey,
        title,
      ) => {
        const { workflow, scopeStack } = get();
        if (!workflow) return;
        const scope = resolveCurrentScope(scopeStack, workflow);
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
          if (normalized) {
            nextNode.title = normalized;
            nextProps.title = normalized;
          } else {
            delete nextNode.title;
            delete nextProps.title;
          }
          return nextNode as WorkflowNode;
        });
        const nextWorkflow = scope.applyPatch(workflow, { nodes: nextNodes });
        set({ workflow: nextWorkflow });
      };

      const toggleBypass: WorkflowState["toggleBypass"] = (itemKey) => {
        const { workflow, scopeStack } = get();
        if (!workflow) return;
        const scope = resolveCurrentScope(scopeStack, workflow);
        const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
        if (!node) return;
        const nextNodes = scope.nodes.map((n) => {
          if (n.id !== node.id) return n;
          const currentMode = n.mode || 0;
          const newMode = currentMode === 4 ? 0 : 4;
          return { ...n, mode: newMode };
        });
        const nextWorkflow = scope.applyPatch(workflow, { nodes: nextNodes });
        set({ workflow: nextWorkflow });
      };

      const scrollToNode: WorkflowState["scrollToNode"] = (
        itemKey,
        label,
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
        executingNodeHierarchicalKey,
        executingPromptId,
        progress,
        executingNodePath,
      ) => {
        set((state) => {
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

      const loadWorkflow: WorkflowState["loadWorkflow"] = (
        workflow,
        filename,
        options,
      ) => {
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
            Math.max(0, ...normalizedNodes.map((n) => n.id)),
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
        const seedModes: Record<number, SeedMode> = {};
        if (nodeTypes) {
          const allNodesForSeed: WorkflowNode[] = [
            ...canonicalWorkflow.nodes,
            ...(canonicalWorkflow.definitions?.subgraphs ?? []).flatMap((sg) => sg.nodes ?? []),
          ];
          for (const node of allNodesForSeed) {
            const seedWidgetIndex = findSeedWidgetIndex(
              canonicalWorkflow,
              nodeTypes,
              node,
            );
            if (seedWidgetIndex !== null) {
              seedModes[node.id] = inferSeedMode(
                canonicalWorkflow,
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
            originalWorkflow: JSON.parse(
              JSON.stringify(restoredWorkflowWithHierarchicalKeys),
            ), // Keep original for dirty check
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
            followQueue: false,
            workflowLoadedAt: Date.now(),
          });
          // Intentional: always derive seed modes from the loaded workflow.
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
            originalWorkflow: JSON.parse(
              JSON.stringify(normalizedWorkflowWithHierarchicalKeys),
            ),
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
            followQueue: false,
            workflowLoadedAt: Date.now(),
          });
          // Intentional: always derive seed modes from the loaded workflow.
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

        // Track in recent workflows
        if (filename) {
          useRecentWorkflowsStore.getState().addEntry(filename, source);
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
          originalWorkflow: null,
          scopeStack: [{ type: "root" as const }],
          currentFilename: null,
          currentWorkflowKey: null,
          collapsedItems: {},
          hiddenItems: {},
          mobileLayout: createEmptyMobileLayout(),
          itemKeyByPointer: {},
          pointerByHierarchicalKey: {},
          runCount: 1,
          nodeOutputs: {},
          nodeTextOutputs: {},
          latentPreviews: {},
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
          originalWorkflow: JSON.parse(JSON.stringify(workflowWithHierarchicalKeys)),
          currentFilename: filename,
          currentWorkflowKey: workflowKey,
          workflowSource: { type: 'user', filename },
          mobileLayout: nextLayout,
          itemKeyByPointer: reconciled.layoutToStable,
          pointerByHierarchicalKey: reconciled.stableToLayout,
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

        // Under the canonical model, inner nodes live in targetSubgraph.nodes.
        // Promote them into the parent scope (root or parent subgraph).
        const innerNodes = targetSubgraph.nodes ?? [];
        const nextNodes =
          parentSubgraphId == null
            ? [
                // Remove placeholder for this subgraph, then append inner nodes.
                ...(workflow.nodes ?? []).filter((n) => n.type !== subgraphId),
                ...innerNodes,
              ]
            : (workflow.nodes ?? []);

        const nextSubgraphs = subgraphDefs
          .filter((sg) => sg.id !== subgraphId)
          .map((sg) => {
            if (parentSubgraphId != null && sg.id === parentSubgraphId) {
              return {
                ...sg,
                // Remove placeholder for this subgraph from parent, append inner nodes.
                nodes: [
                  ...(sg.nodes ?? []).filter((n) => n.type !== subgraphId),
                  ...innerNodes,
                ],
                groups: [...(sg.groups ?? []), ...promotedGroups],
              };
            }
            return sg;
          });

        let nextRootGroups = workflow.groups ?? [];
        if (parentSubgraphId == null && promotedGroups.length > 0) {
          nextRootGroups = [...nextRootGroups, ...promotedGroups];
        }

        const nextWorkflow: Workflow = {
          ...workflow,
          nodes: nextNodes,
          groups: nextRootGroups,
          definitions: {
            ...(workflow.definitions ?? {}),
            subgraphs: nextSubgraphs,
          },
        };

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
        const { workflow, pointerByHierarchicalKey, scopeStack } = get();
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

        const scope = resolveCurrentScope(scopeStack, workflow);
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

        const seedModes: Record<number, SeedMode> = {};
        if (nodeTypes) {
          const allNodesForSeed: WorkflowNode[] = [
            ...originalWorkflow.nodes,
            ...(originalWorkflow.definitions?.subgraphs ?? []).flatMap((sg) => sg.nodes ?? []),
          ];
          for (const node of allNodesForSeed) {
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
            const nextWorkflow = { ...workflow, nodes: newNodes };
            set({
              workflow: nextWorkflow,
            });
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

      const queueWorkflow: WorkflowState["queueWorkflow"] = async (count) => {
        const seedStore = useSeedStore.getState();
        const seedModes = seedStore.seedModes;
        const seedLastValues = seedStore.seedLastValues;
        const { workflow, nodeTypes } = get();
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
          let nextSeedLastValues: SeedLastValues = { ...seedLastValues };

          // Process seed mode for a single node; mutates seedOverrides and nextSeedLastValues in-place.
          const processSeedNode = (
            node: WorkflowNode,
            seedOverrides: Record<number, number>,
          ): WorkflowNode => {
            const seedIndex = findSeedWidgetIndex(currentWorkflow, nodeTypes, node);
            if (seedIndex === null) return node;
            if (!Array.isArray(node.widgets_values)) return node;

            const mode =
              seedModes[node.id] ??
              inferSeedMode(currentWorkflow, nodeTypes, node);
            const controlWidgetIndex = seedIndex + 1;
            const controlValue = node.widgets_values[controlWidgetIndex];
            const hasControlWidget = typeof controlValue === "string";

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
              newWidgetValues[seedIndex] = nextSeed;
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
            seedOverrides[node.id] = seedToUse;
            nextSeedLastValues = { ...nextSeedLastValues, [node.id]: seedToUse };
            return node;
          };

          for (let i = 0; i < count; i++) {
            const seedOverrides: Record<number, number> = {};
            // Handle seed modes for root nodes and inner subgraph nodes.
            const updatedNodes = currentWorkflow.nodes.map((node) =>
              processSeedNode(node, seedOverrides),
            );
            const subgraphDefsForSeed = currentWorkflow.definitions?.subgraphs ?? [];
            const updatedSubgraphDefs = subgraphDefsForSeed.map((sg) => {
              const updatedSgNodes = (sg.nodes ?? []).map((node) =>
                processSeedNode(node, seedOverrides),
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
            seedStore.setSeedLastValues(nextSeedLastValues);
            set({
              workflow: currentWorkflow,
            });

            // Expand JIT for prompt building (one-way, ephemeral — no sync-back needed).
            // promptKeyMap maps each expanded node's numeric ID to its hierarchical
            // execution ID (e.g. "50:7" for inner node 7 inside placeholder 50),
            // matching the ID scheme used by the main ComfyUI frontend.
            const { workflow: expandedForQueue, promptKeyMap } = expandWorkflowSubgraphs(currentWorkflow);

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
              set({ expandedNodeIdMap: idMap, expandedNodePathMap: pathMap });
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
                getWorkflowWidgetIndexMap(expandedForQueue, node.id),
                seedOverrides,
                promptKeyMap,
              );
              const promptKey = promptKeyMap.get(node.id) ?? String(node.id);
              prompt[promptKey] = { class_type: classType, inputs };
            }

            // Embed the canonical workflow (not expanded) so desktop ComfyUI can reload it correctly.
            // Run validateAndNormalizeWorkflow to repair any stale SubgraphIO.linkIds before embedding.
            const queuedWorkflow = validateAndNormalizeWorkflow(stripWorkflowClientMetadata(currentWorkflow));
            const previewMethod = useGenerationSettingsStore.getState().previewMethod;
            const response = await fetch('/api/prompt', {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt,
                client_id: api.clientId,
                extra_data: {
                  extra_pnginfo: {
                    workflow: queuedWorkflow,
                  },
                  ...(previewMethod !== 'none' ? { preview_method: previewMethod } : {}),
                },
              }),
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
          useQueueStore.getState().fetchQueue();
          set({ isLoading: false });
        }
      };

      return {
        workflowSource: null,
        workflow: null,
        originalWorkflow: null,
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
        nodeTextOutputs: {},
        latentPreviews: {},
        promptOutputs: {},
        runCount: 1,
        followQueue: false,
        workflowLoadedAt: 0,
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
        deleteContainer,
        connectNodes,
        disconnectInput,
        setNodeOutput,
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
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
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
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.workflow) {
          const normalizedWorkflow = canonicalizeWorkflowHierarchicalKeys(
            state.workflow,
            state.itemKeyByPointer ?? {},
          );
          const normalizedLayout = state.mobileLayout
            ? normalizeMobileLayoutGroupKeys(state.mobileLayout)
            : null;
          const hiddenNodesLayout = normalizeManuallyHiddenNodeKeys(
            normalizedWorkflow,
            state.hiddenItems ?? {},
          );
          state.mobileLayout =
            normalizedLayout &&
            layoutMatchesWorkflowNodes(normalizedLayout, normalizedWorkflow)
              ? normalizedLayout
              : buildLayoutForWorkflow(normalizedWorkflow, hiddenNodesLayout);
          const reconciled = reconcilePointerRegistry(
            state.mobileLayout,
            state.itemKeyByPointer ?? {},
            state.pointerByHierarchicalKey ?? {},
          );
          state.workflow = annotateWorkflowWithHierarchicalKeys(
            normalizedWorkflow,
            reconciled.layoutToStable,
          );
          if (state.originalWorkflow) {
            const normalizedOriginalWorkflow = canonicalizeWorkflowHierarchicalKeys(
              state.originalWorkflow,
              state.itemKeyByPointer ?? {},
            );
            state.originalWorkflow = annotateWorkflowWithHierarchicalKeys(
              normalizedOriginalWorkflow,
              reconciled.layoutToStable,
            );
          }
          state.itemKeyByPointer = reconciled.layoutToStable;
          state.pointerByHierarchicalKey = reconciled.stableToLayout;
          state.hiddenItems = normalizePointerBooleanRecord(
            state.hiddenItems,
            reconciled.layoutToStable,
            reconciled.stableToLayout,
          );
          state.collapsedItems = normalizePointerCollapsedRecord(
            state.collapsedItems,
            reconciled.layoutToStable,
            reconciled.stableToLayout,
          );
          const activeWorkflowKey = state.currentWorkflowKey;
          if (
            activeWorkflowKey &&
            state.savedWorkflowStates &&
            state.savedWorkflowStates[activeWorkflowKey]
          ) {
            const savedState = state.savedWorkflowStates[activeWorkflowKey];
            const nextCollapsed = normalizePointerCollapsedRecord(
              savedState.collapsedItems,
              reconciled.layoutToStable,
              reconciled.stableToLayout,
            );
            const nextHidden = normalizePointerBooleanRecord(
              savedState.hiddenItems,
              reconciled.layoutToStable,
              reconciled.stableToLayout,
            );
            const nextBookmarks = normalizePointerBookmarkList(
              savedState.bookmarkedItems,
              reconciled.layoutToStable,
              reconciled.stableToLayout,
            );
            state.savedWorkflowStates = {
              ...state.savedWorkflowStates,
              [activeWorkflowKey]: {
                ...savedState,
                collapsedItems: nextCollapsed,
                hiddenItems: nextHidden,
                bookmarkedItems: nextBookmarks,
              },
            };
          }
        } else {
          state.mobileLayout = createEmptyMobileLayout();
          state.itemKeyByPointer = {};
          state.pointerByHierarchicalKey = {};
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

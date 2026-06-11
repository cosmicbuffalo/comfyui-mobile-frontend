/**
 * Hierarchical-key / layout pointer-registry / scoped-node-identity / subgraph-
 * hierarchy helpers for the canonical workflow model.
 *
 * These are pure functions extracted from useWorkflow.ts. They map between the
 * MobileLayout's location pointers, stable per-node hierarchical keys, and the
 * workflow's nodes/groups/subgraph definitions. None of them touch the Zustand
 * store; the store imports what it needs from here.
 */
import type {
  Workflow,
  WorkflowNode,
  WorkflowGroup,
  WorkflowSubgraphDefinition,
} from "@/api/types";
import type { ItemRef, MobileLayout, ContainerId } from "@/utils/mobileLayout";
import {
  flattenLayoutToNodeOrder,
  getGroupKey,
  makeLocationPointer,
  parseLocationPointer,
} from "@/utils/mobileLayout";
import { computeNodeGroupsFor } from "@/utils/nodeGroups";
import type { ScopeFrame } from "@/utils/canonicalWorkflowOps";

export type HierarchicalKey = string;
export type ScopedNodeIdentity = { nodeId: number; subgraphId: string | null };

export function collectLayoutObjectKeys(layout: MobileLayout): string[] {
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
        if (ref.nodeId !== undefined) {
          keys.push(
            makeLocationPointer({
              type: "node",
              nodeId: ref.nodeId,
              subgraphId: currentSubgraphId,
            }),
          );
        }
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

export function reconcilePointerRegistry(
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

export function layoutMatchesWorkflowNodes(
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

export function nodeStateKey(
  nodeId: number,
  subgraphId: string | null = null,
): string {
  return makeLocationPointer({ type: "node", nodeId, subgraphId });
}

export function getNodeStateKeyForNode(node: WorkflowNode): string {
  // Under the canonical model, workflow.nodes only contains root-scope nodes.
  return nodeStateKey(node.id, null);
}

const nodeStateKeyIndexCache = new WeakMap<Workflow, Map<number, string[]>>();

export function getNodeStateKeyIndex(workflow: Workflow): Map<number, string[]> {
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

export function collectNodeStateKeys(
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

export function normalizeManuallyHiddenNodeKeys(
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

export function normalizeMobileLayoutGroupKeys(layout: MobileLayout): MobileLayout {
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

export function collectGroupHierarchicalKeys(
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

export function scopedNodeIdentityKey(identity: ScopedNodeIdentity): string {
  return `${identity.subgraphId ?? "root"}:${identity.nodeId}`;
}

export function dedupeScopedNodeIdentities(
  identities: Iterable<ScopedNodeIdentity>,
): ScopedNodeIdentity[] {
  const keyed = new Map<string, ScopedNodeIdentity>();
  for (const identity of identities) {
    keyed.set(scopedNodeIdentityKey(identity), identity);
  }
  return [...keyed.values()];
}

export function collectScopedNodeIdentitiesFromLayoutRefs(
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

export function toHierarchicalKey(
  pointer: string,
  itemKeyByPointer: Record<string, HierarchicalKey>,
): HierarchicalKey | null {
  return itemKeyByPointer[pointer] ?? null;
}

export function toHierarchicalKeys(
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

export function collectNodeHierarchicalKeysFromRegistry(
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

export function collectNodeHierarchicalKeys(
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

export function clearNodeUiStateForTargets(
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

export function resolveNodeIdentityFromHierarchicalKey(
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

export type ContainerIdentity =
  | { type: "group"; groupId: number; subgraphId: string | null; itemKey: HierarchicalKey }
  | { type: "subgraph"; subgraphId: string; itemKey: HierarchicalKey };

export function resolveLayoutPointerForStateKey(
  key: string,
  stableToLayout: Record<string, string>,
): string | null {
  const mappedPointer = stableToLayout[key];
  if (mappedPointer) return mappedPointer;
  if (parseLocationPointer(key)) return key;
  return null;
}

export function resolveContainerIdentityFromHierarchicalKey(
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

export function findSubgraphHierarchicalKey(
  workflow: Workflow,
  subgraphId: string,
): HierarchicalKey | null {
  const subgraph = (workflow.definitions?.subgraphs ?? []).find(
    (entry) => entry.id === subgraphId,
  );
  return subgraph?.itemKey ?? null;
}

export function findGroupSubgraphIdByHierarchicalKey(
  layout: MobileLayout,
  groupHierarchicalKey: string,
): string | null {
  const parent = layout.groupParents?.[groupHierarchicalKey];
  if (!parent) return null;
  if (parent.scope === "subgraph") return parent.subgraphId;
  if (parent.scope === "root") return null;
  return findGroupSubgraphIdByHierarchicalKey(layout, parent.groupKey);
}

export function pointerRecordFromLayoutRecord(
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

export function pointerCollapsedRecordFromLayoutRecord(
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

export function normalizePointerBooleanRecord(
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

export function normalizePointerCollapsedRecord(
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

export function normalizePointerBookmarkList(
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

export function layoutRecordFromPointerRecord(
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

export function getNodePointerFromWorkflowNode(node: WorkflowNode): string {
  // Under the canonical model, this is only called for root-scope nodes.
  return makeLocationPointer({ type: "node", nodeId: node.id, subgraphId: null });
}

export function buildScopeStackForSubgraphTrail(
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

export function withHierarchicalKeysForNodes(
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

export function withHierarchicalKeysForGroups(
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

export function hasMissingHierarchicalKeys(workflow: Workflow): boolean {
  if (workflow.nodes.some((node) => !node.itemKey)) return true;
  if ((workflow.groups ?? []).some((group) => !group.itemKey)) return true;
  for (const subgraph of workflow.definitions?.subgraphs ?? []) {
    if (!subgraph.itemKey) return true;
    if ((subgraph.nodes ?? []).some((node) => !node.itemKey)) return true;
    if ((subgraph.groups ?? []).some((group) => !group.itemKey)) return true;
  }
  return false;
}

export function hasLayoutGroupKeyMismatch(workflow: Workflow, layout: MobileLayout): boolean {
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

export function ensureWorkflowHasHierarchicalKeys(workflow: Workflow): Workflow {
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

export function canonicalizeWorkflowHierarchicalKeys(
  workflow: Workflow,
  itemKeyByPointer: Record<string, HierarchicalKey>,
): Workflow {
  return annotateWorkflowWithHierarchicalKeys(workflow, itemKeyByPointer);
}

export function annotateWorkflowWithHierarchicalKeys(
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

export function collectDescendantSubgraphs(
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

export function buildSubgraphParentMap(
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

export function getGroupIdForNode(
  targetNodeId: number,
  nodes: WorkflowNode[],
  groups: Workflow["groups"],
): number | null {
  if (!groups || groups.length === 0) return null;
  const nodeToGroup = computeNodeGroupsFor(nodes, groups);
  return nodeToGroup.get(targetNodeId) ?? null;
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

export function collectBypassContainerTargetNodesFromLayout(
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

export function getSubgraphChildMap(workflow: Workflow): Map<string, Set<string>> {
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

export function collectBypassSubgraphTargetNodes(
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

export function getParentSubgraphIdFromContainer(
  containerId: ContainerId,
  layout: MobileLayout,
): string | null {
  if (containerId.scope === "subgraph") return containerId.subgraphId;
  if (containerId.scope === "root") return null;
  return findGroupSubgraphIdByHierarchicalKey(layout, containerId.groupKey);
}


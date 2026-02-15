import type { Workflow, WorkflowNode } from '@/api/types';
import { computeNodeGroupsFor } from '@/utils/nodeGroups';

// --- Types ---

export type ItemRef =
  | { type: 'node'; id: number }
  | { type: 'group'; id: number; subgraphId: string | null; stableKey: string }
  | { type: 'subgraph'; id: string }
  | { type: 'hiddenBlock'; blockId: string };

export interface MobileLayout {
  root: ItemRef[];
  groups: Record<string, ItemRef[]>;
  groupParents?: Record<string, GroupParentRef>;
  subgraphs: Record<string, ItemRef[]>;
  hiddenBlocks: Record<string, number[]>; // blockId -> nodeIds
}

export type GroupParentRef =
  | { scope: 'root' }
  | { scope: 'group'; groupKey: string }
  | { scope: 'subgraph'; subgraphId: string };

export type LocationPointer =
  | { type: 'node'; nodeId: number; subgraphId: string | null }
  | { type: 'group'; groupId: number; subgraphId: string | null; groupKey?: string }
  | { type: 'subgraph'; subgraphId: string };

export function createEmptyMobileLayout(): MobileLayout {
  return {
    root: [],
    groups: {},
    groupParents: {},
    subgraphs: {},
    hiddenBlocks: {}
  };
}

export type ContainerId =
  | { scope: 'root' }
  | { scope: 'group'; groupKey: string }
  | { scope: 'subgraph'; subgraphId: string };

export function parseLocationPointer(pointer: string): LocationPointer | null {
  const rawSegments = pointer.split('/').filter(Boolean);
  if (rawSegments.length === 0) return null;
  if (rawSegments[0] !== 'root') return null;
  const segments = rawSegments.slice(1);
  if (segments.length === 0) return null;

  const parseSegment = (segment: string): { type: 'node' | 'group' | 'subgraph'; rawId: string } | null => {
    const idx = segment.indexOf(':');
    if (idx <= 0) return null;
    const type = segment.slice(0, idx);
    const rawId = segment.slice(idx + 1);
    if ((type !== 'node' && type !== 'group' && type !== 'subgraph') || rawId.length === 0) {
      return null;
    }
    return { type, rawId };
  };

  let lastSubgraphId: string | null = null;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const parsed = parseSegment(segments[i]);
    if (!parsed) return null;
    if (parsed.type === 'node') return null;
    if (parsed.type === 'subgraph') lastSubgraphId = parsed.rawId;
  }

  const terminal = parseSegment(segments[segments.length - 1]);
  if (!terminal) return null;

  if (terminal.type === 'subgraph') {
    return { type: 'subgraph', subgraphId: terminal.rawId };
  }

  const numericId = Number(terminal.rawId);
  if (!Number.isFinite(numericId)) return null;
  if (terminal.type === 'group') {
    return { type: 'group', groupId: numericId, subgraphId: lastSubgraphId };
  }
  return { type: 'node', nodeId: numericId, subgraphId: lastSubgraphId };
}

export function makeLocationPointer(pointer: LocationPointer): string {
  if (pointer.type === 'group' && pointer.groupKey) {
    return pointer.groupKey;
  }
  const base = pointer.subgraphId == null ? 'root' : `root/subgraph:${pointer.subgraphId}`;
  if (pointer.type === 'group') {
    return `${base}/group:${pointer.groupId}`;
  }
  if (pointer.type === 'node') {
    return `${base}/node:${pointer.nodeId}`;
  }
  return `root/subgraph:${pointer.subgraphId}`;
}

// --- Helpers ---

function itemRefEquals(a: ItemRef, b: ItemRef): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'node' && b.type === 'node') return a.id === b.id;
  if (a.type === 'group' && b.type === 'group') return a.stableKey === b.stableKey;
  if (a.type === 'subgraph' && b.type === 'subgraph') return a.id === b.id;
  if (a.type === 'hiddenBlock' && b.type === 'hiddenBlock') return a.blockId === b.blockId;
  return false;
}

function getMobileOrigin(node: WorkflowNode): { scope: 'root' | 'subgraph'; subgraphId?: string } | null {
  const props = node.properties as Record<string, unknown> | undefined;
  const origin = props?.['__mobile_origin'];
  if (!origin || typeof origin !== 'object') return null;
  const scope = (origin as { scope?: string }).scope;
  if (scope === 'root') return { scope: 'root' };
  if (scope === 'subgraph') {
    const subgraphId = (origin as { subgraphId?: string }).subgraphId;
    if (typeof subgraphId === 'string') return { scope: 'subgraph', subgraphId };
  }
  return null;
}

export function getNodeSubgraphId(node: WorkflowNode): string | null {
  const origin = getMobileOrigin(node);
  return origin?.scope === 'subgraph' ? origin.subgraphId ?? null : null;
}

// --- Builders ---

/**
 * Build a default MobileLayout from ordered nodes, grouping hidden nodes into blocks.
 */
export function buildDefaultLayout(
  orderedNodes: WorkflowNode[],
  workflow: Workflow,
  hiddenItems: Record<string, boolean>
): MobileLayout {
  const groups = workflow.groups ?? [];
  const subgraphs = workflow.definitions?.subgraphs ?? [];

  // Determine which container each node belongs to
  const nodeToSubgraph = new Map<number, string>();
  for (const node of orderedNodes) {
    const origin = getMobileOrigin(node);
    if (origin?.scope === 'subgraph' && origin.subgraphId) {
      nodeToSubgraph.set(node.id, origin.subgraphId);
    }
  }

  const topLevelNodes = orderedNodes.filter((n) => !nodeToSubgraph.has(n.id));
  const nodeToGroup = computeNodeGroupsFor(topLevelNodes, groups);

  // Build subgraph group maps
  const subgraphNodeToGroup = new Map<string, Map<number, number>>();
  for (const sg of subgraphs) {
    const sgNodes = orderedNodes.filter((n) => nodeToSubgraph.get(n.id) === sg.id);
    const sgGroups = sg.groups ?? [];
    if (sgGroups.length > 0) {
      subgraphNodeToGroup.set(sg.id, computeNodeGroupsFor(sgNodes, sgGroups));
    }
  }

  // Subgraph-to-group mapping from workflow.extra
  const rawSubgraphGroupMap =
    (workflow.extra as Record<string, unknown> | undefined)?.['__mobile_subgraph_group_map'];
  const subgraphGroupMap = new Map<string, number | null>();
  if (rawSubgraphGroupMap && typeof rawSubgraphGroupMap === 'object') {
    for (const [key, value] of Object.entries(rawSubgraphGroupMap as Record<string, unknown>)) {
      if (typeof value === 'number' || value === null) {
        subgraphGroupMap.set(key, value);
      }
    }
  }

  const layout: MobileLayout = createEmptyMobileLayout();

  // Initialize subgraph containers.
  for (const sg of subgraphs) {
    layout.subgraphs[sg.id] = [];
  }

  const getGroupParentMap = (
    scopeGroups: Array<{ id: number; bounding: [number, number, number, number] }>
  ): Map<number, number | null> => {
    const parentMap = new Map<number, number | null>();
    for (const child of scopeGroups) {
      const [cx, cy, cw, ch] = child.bounding;
      const centerX = cx + cw / 2;
      const centerY = cy + ch / 2;
      const childArea = cw * ch;
      let parentId: number | null = null;
      let parentArea = Number.POSITIVE_INFINITY;
      for (const candidate of scopeGroups) {
        if (candidate.id === child.id) continue;
        const [px, py, pw, ph] = candidate.bounding;
        const candidateArea = pw * ph;
        if (candidateArea <= childArea) continue;
        const fullyContainsChild =
          cx >= px &&
          cy >= py &&
          cx + cw <= px + pw &&
          cy + ch <= py + ph;
        const containsChildCenter =
          centerX >= px &&
          centerX <= px + pw &&
          centerY >= py &&
          centerY <= py + ph;
        if (!fullyContainsChild && !containsChildCenter) {
          continue;
        }
        if (candidateArea < parentArea) {
          parentArea = candidateArea;
          parentId = candidate.id;
        }
      }
      parentMap.set(child.id, parentId);
    }
    return parentMap;
  };

  // Helper to group consecutive hidden nodes into blocks within a list
  function groupHiddenNodes(
    items: ItemRef[],
    containerId: string,
    subgraphId: string | null
  ): ItemRef[] {
    const result: ItemRef[] = [];
    let hiddenRun: number[] = [];
    let blockIndex = 0;

    const flushHidden = () => {
      if (hiddenRun.length === 0) return;
      const blockId = `hidden-${containerId}-${blockIndex}`;
      blockIndex++;
      layout.hiddenBlocks[blockId] = [...hiddenRun];
      result.push({ type: 'hiddenBlock', blockId });
      hiddenRun = [];
    };

    for (const item of items) {
      if (
        item.type === 'node' &&
        hiddenItems[
          makeLocationPointer({ type: 'node', nodeId: item.id, subgraphId })
        ]
      ) {
        hiddenRun.push(item.id);
      } else {
        flushHidden();
        result.push(item);
      }
    }
    flushHidden();
    return result;
  }

  // Build subgraph contents with nested group hierarchy.
  for (const sg of subgraphs) {
    const sgNodes = orderedNodes.filter((n) => nodeToSubgraph.get(n.id) === sg.id);
    const sgNodeToGroup = subgraphNodeToGroup.get(sg.id);
    const sgGroups = sg.groups ?? [];
    const sgGroupParentMap = getGroupParentMap(sgGroups);
    const sgGroupKeyById = new Map<number, string>();
    const sgGroupById = new Map((sg.groups ?? []).map((group) => [group.id, group]));
    const sgEmittedGroups = new Set<number>();
    const sgRootItems: ItemRef[] = [];
    const groupKey = (groupId: number) =>
      sgGroupKeyById.get(groupId) ??
      `legacy-group-${sg.id}-${groupId}`;
    const emitGroupChain = (groupId: number) => {
      const chain: number[] = [];
      const seen = new Set<number>();
      let current: number | null | undefined = groupId;
      while (current != null && !seen.has(current)) {
        chain.push(current);
        seen.add(current);
        current = sgGroupParentMap.get(current) ?? null;
      }
      chain.reverse();
      for (const id of chain) {
        if (sgEmittedGroups.has(id)) continue;
        const parentId = sgGroupParentMap.get(id) ?? null;
        const stableKey =
          sgGroupById.get(id)?.stableKey ??
          `legacy-group-${sg.id}-${id}`;
        sgGroupKeyById.set(id, stableKey);
        const ref: ItemRef = { type: 'group', id, subgraphId: sg.id, stableKey };
        if (parentId == null) {
          sgRootItems.push(ref);
          layout.groupParents![stableKey] = { scope: 'subgraph', subgraphId: sg.id };
        } else {
          const parentStableKey = groupKey(parentId);
          layout.groups[parentStableKey] ??= [];
          layout.groups[parentStableKey].push(ref);
          layout.groupParents![stableKey] = { scope: 'group', groupKey: parentStableKey };
        }
        sgEmittedGroups.add(id);
      }
    };

    for (const node of sgNodes) {
      const assignedGroupId = sgNodeToGroup?.get(node.id);
      if (assignedGroupId === undefined) {
        sgRootItems.push({ type: 'node', id: node.id });
        continue;
      }
      emitGroupChain(assignedGroupId);
      layout.groups[groupKey(assignedGroupId)] ??= [];
      layout.groups[groupKey(assignedGroupId)].push({ type: 'node', id: node.id });
    }

    for (const g of sgGroups) {
      emitGroupChain(g.id);
    }

    for (const g of sgGroups) {
      const key = groupKey(g.id);
      layout.groups[key] = groupHiddenNodes(layout.groups[key] ?? [], `group-${key}`, sg.id);
    }

    layout.subgraphs[sg.id] = groupHiddenNodes(sgRootItems, `subgraph-${sg.id}`, sg.id);
  }

  // Build root contents with nested group hierarchy.
  const rootGroupParentMap = getGroupParentMap(groups);
  const rootEmittedGroups = new Set<number>();
  const emittedSubgraphs = new Set<string>();
  const rootItems: ItemRef[] = [];
    const rootGroupKeyById = new Map<number, string>();
    const rootGroupById = new Map(groups.map((group) => [group.id, group]));
  const rootGroupKey = (groupId: number) =>
    rootGroupKeyById.get(groupId) ??
    `legacy-group-root-${groupId}`;
  const emitRootGroupChain = (groupId: number) => {
    const chain: number[] = [];
    const seen = new Set<number>();
    let current: number | null | undefined = groupId;
    while (current != null && !seen.has(current)) {
      chain.push(current);
      seen.add(current);
      current = rootGroupParentMap.get(current) ?? null;
    }
    chain.reverse();
    for (const id of chain) {
      if (rootEmittedGroups.has(id)) continue;
      const parentId = rootGroupParentMap.get(id) ?? null;
      const stableKey =
        rootGroupById.get(id)?.stableKey ??
        `legacy-group-root-${id}`;
      rootGroupKeyById.set(id, stableKey);
      const ref: ItemRef = { type: 'group', id, subgraphId: null, stableKey };
      if (parentId == null) {
        rootItems.push(ref);
        layout.groupParents![stableKey] = { scope: 'root' };
      } else {
        const parentStableKey = rootGroupKey(parentId);
        layout.groups[parentStableKey] ??= [];
        layout.groups[parentStableKey].push(ref);
        layout.groupParents![stableKey] = { scope: 'group', groupKey: parentStableKey };
      }
      rootEmittedGroups.add(id);
    }
  };

  for (const node of topLevelNodes) {
    const assignedGroupId = nodeToGroup.get(node.id);
    if (assignedGroupId === undefined) {
      rootItems.push({ type: 'node', id: node.id });
      continue;
    }
    emitRootGroupChain(assignedGroupId);
    layout.groups[rootGroupKey(assignedGroupId)] ??= [];
    layout.groups[rootGroupKey(assignedGroupId)].push({ type: 'node', id: node.id });
  }

  for (const sg of subgraphs) {
    if (emittedSubgraphs.has(sg.id)) continue;
    const assignedGroupId = subgraphGroupMap.get(sg.id);
    if (assignedGroupId != null) {
      emitRootGroupChain(assignedGroupId);
      layout.groups[rootGroupKey(assignedGroupId)] ??= [];
      layout.groups[rootGroupKey(assignedGroupId)].push({ type: 'subgraph', id: sg.id });
    } else {
      rootItems.push({ type: 'subgraph', id: sg.id });
    }
    emittedSubgraphs.add(sg.id);
  }

  for (const g of groups) {
    emitRootGroupChain(g.id);
  }

  for (const g of groups) {
    const key = rootGroupKey(g.id);
    layout.groups[key] = groupHiddenNodes(layout.groups[key] ?? [], `group-${key}`, null);
  }

  layout.root = groupHiddenNodes(rootItems, 'root', null);

  return layout;
}

/**
 * Migrate old flat mobileNodeOrder + mobileNodeGroupOverrides to MobileLayout.
 */
export function migrateFlatToLayout(
  mobileNodeOrder: number[],
  mobileNodeGroupOverrides: Record<number, number | null>,
  workflow: Workflow,
  hiddenItems: Record<string, boolean>
): MobileLayout {
  const groups = workflow.groups ?? [];
  const subgraphs = workflow.definitions?.subgraphs ?? [];
  const makeLegacyGroupStableKey = (groupId: number, subgraphId: string | null): string =>
    subgraphId == null ? `legacy-group-root-${groupId}` : `legacy-group-${subgraphId}-${groupId}`;
  const resolveGroupStableKey = (groupId: number, subgraphId: string | null): string => {
    if (subgraphId == null) {
      const rootGroup = groups.find((group) => group.id === groupId);
      return rootGroup?.stableKey ?? makeLegacyGroupStableKey(groupId, null);
    }
    const subgraph = subgraphs.find((sg) => sg.id === subgraphId);
    const scopedGroup = subgraph?.groups?.find((group) => group.id === groupId);
    return scopedGroup?.stableKey ?? makeLegacyGroupStableKey(groupId, subgraphId);
  };

  const layout: MobileLayout = createEmptyMobileLayout();

  // Initialize containers
  for (const g of groups) {
    const stableKey = g.stableKey ?? makeLegacyGroupStableKey(g.id, null);
    layout.groups[stableKey] = [];
    layout.groupParents![stableKey] = { scope: 'root' };
  }
  for (const sg of subgraphs) {
    layout.subgraphs[sg.id] = [];
    for (const g of (sg.groups ?? [])) {
      const stableKey = g.stableKey ?? makeLegacyGroupStableKey(g.id, sg.id);
      layout.groups[stableKey] = [];
      layout.groupParents![stableKey] = { scope: 'subgraph', subgraphId: sg.id };
    }
  }

  // Determine node-to-subgraph mapping
  const nodeToSubgraph = new Map<number, string>();
  for (const node of workflow.nodes) {
    const origin = getMobileOrigin(node);
    if (origin?.scope === 'subgraph' && origin.subgraphId) {
      nodeToSubgraph.set(node.id, origin.subgraphId);
    }
  }

  // Use the flat order to build the layout
  const topLevelNodes = workflow.nodes.filter((n) => !nodeToSubgraph.has(n.id));
  const nodeToGroup = computeNodeGroupsFor(topLevelNodes, groups);

  // Apply overrides
  for (const [nodeIdStr, groupId] of Object.entries(mobileNodeGroupOverrides)) {
    const nodeId = Number(nodeIdStr);
    if (!Number.isFinite(nodeId)) continue;
    if (groupId === null) {
      nodeToGroup.delete(nodeId);
    } else {
      nodeToGroup.set(nodeId, groupId);
    }
  }

  const emittedGroups = new Set<number>();
  const emittedSubgraphs = new Set<string>();
  let blockIndex = 0;

  for (const nodeId of mobileNodeOrder) {
    const subgraphId = nodeToSubgraph.get(nodeId);
    if (subgraphId) {
      if (!emittedSubgraphs.has(subgraphId)) {
        layout.root.push({ type: 'subgraph', id: subgraphId });
        emittedSubgraphs.add(subgraphId);
        // Add all subgraph nodes in order
        const sgNodeIds = mobileNodeOrder.filter((id) => nodeToSubgraph.get(id) === subgraphId);
        layout.subgraphs[subgraphId] = sgNodeIds.map((id) => ({ type: 'node', id }));
      }
      continue;
    }

    const groupId = nodeToGroup.get(nodeId);
    if (groupId !== undefined) {
      if (!emittedGroups.has(groupId)) {
        const stableKey = resolveGroupStableKey(groupId, null);
        layout.root.push({ type: 'group', id: groupId, subgraphId: null, stableKey });
        layout.groupParents![stableKey] = { scope: 'root' };
        emittedGroups.add(groupId);
        // Add all group nodes in order
        const groupNodeIds = mobileNodeOrder.filter(
          (id) => !nodeToSubgraph.has(id) && nodeToGroup.get(id) === groupId
        );
        layout.groups[stableKey] = groupNodeIds.map((id) => ({ type: 'node', id }));
      }
    } else {
      if (
        hiddenItems[
          makeLocationPointer({ type: 'node', nodeId, subgraphId: null })
        ]
      ) {
        // Hidden ungrouped node - create a block
        const blockId = `hidden-root-${blockIndex}`;
        blockIndex++;
        layout.hiddenBlocks[blockId] = [nodeId];
        layout.root.push({ type: 'hiddenBlock', blockId });
      } else {
        layout.root.push({ type: 'node', id: nodeId });
      }
    }
  }

  return layout;
}

/**
 * Remove a node from the layout (e.g., on delete).
 */
export function removeNodeFromLayout(layout: MobileLayout, nodeId: number): MobileLayout {
  const removeFromList = (items: ItemRef[]): ItemRef[] => {
    const result: ItemRef[] = [];
    for (const item of items) {
      if (item.type === 'node' && item.id === nodeId) continue;
      if (item.type === 'hiddenBlock') {
        const blockNodes = layout.hiddenBlocks[item.blockId];
        if (blockNodes) {
          const filtered = blockNodes.filter((id) => id !== nodeId);
          if (filtered.length === 0) continue; // Remove empty block
          // Update will be done in hiddenBlocks below
        }
      }
      result.push(item);
    }
    return result;
  };

  const nextHiddenBlocks: Record<string, number[]> = {};
  for (const [blockId, nodeIds] of Object.entries(layout.hiddenBlocks)) {
    const filtered = nodeIds.filter((id) => id !== nodeId);
    if (filtered.length > 0) {
      nextHiddenBlocks[blockId] = filtered;
    }
  }

  const nextGroups: Record<string, ItemRef[]> = {};
  for (const [groupId, items] of Object.entries(layout.groups)) {
    nextGroups[groupId] = removeFromList(items);
  }

  const nextSubgraphs: Record<string, ItemRef[]> = {};
  for (const [subgraphId, items] of Object.entries(layout.subgraphs)) {
    nextSubgraphs[subgraphId] = removeFromList(items);
  }

  return {
    root: removeFromList(layout.root),
    groups: nextGroups,
    groupParents: layout.groupParents ?? {},
    subgraphs: nextSubgraphs,
    hiddenBlocks: nextHiddenBlocks
  };
}

/**
 * Add a node to the layout (e.g., on add node).
 */
export function addNodeToLayout(
  layout: MobileLayout,
  nodeId: number,
  container?: { groupId?: number; subgraphId?: string | null }
): MobileLayout {
  const ref: ItemRef = { type: 'node', id: nodeId };
  const findGroupStableKey = (
    groupId: number,
    subgraphId: string | null
  ): string | null => {
    const scan = (
      refs: ItemRef[],
      currentSubgraphId: string | null
    ): string | null => {
      for (const item of refs) {
        if (item.type === 'group' && item.id === groupId && currentSubgraphId === subgraphId) {
          return item.stableKey;
        }
        if (item.type === 'group') {
          const nested = scan(layout.groups[item.stableKey] ?? [], currentSubgraphId);
          if (nested) return nested;
          continue;
        }
        if (item.type === 'subgraph') {
          const nested = scan(layout.subgraphs[item.id] ?? [], item.id);
          if (nested) return nested;
        }
      }
      return null;
    };
    return scan(layout.root, null);
  };

  if (container?.subgraphId) {
    const subgraphItems = layout.subgraphs[container.subgraphId] ?? [];
    if (container.groupId != null) {
      const groupStableKey = findGroupStableKey(container.groupId, container.subgraphId);
      if (!groupStableKey) {
        return {
          ...layout,
          subgraphs: { ...layout.subgraphs, [container.subgraphId]: [...subgraphItems, ref] }
        };
      }
      const groupItems = layout.groups[groupStableKey] ?? [];
      return {
        ...layout,
        groups: { ...layout.groups, [groupStableKey]: [...groupItems, ref] }
      };
    }
    return {
      ...layout,
      subgraphs: { ...layout.subgraphs, [container.subgraphId]: [...subgraphItems, ref] }
    };
  }

  if (container?.groupId != null) {
    const groupStableKey = findGroupStableKey(container.groupId, container.subgraphId ?? null);
    if (!groupStableKey) {
      return {
        ...layout,
        root: [...layout.root, ref]
      };
    }
    const groupItems = layout.groups[groupStableKey] ?? [];
    return {
      ...layout,
      groups: { ...layout.groups, [groupStableKey]: [...groupItems, ref] }
    };
  }

  return {
    ...layout,
    root: [...layout.root, ref]
  };
}

/**
 * Remove a group from the layout, promoting its children to the parent container.
 */
export function removeGroupFromLayout(
  layout: MobileLayout,
  groupId: number,
  subgraphId: string | null = null
): MobileLayout {
  const findGroupStableKey = (
    refs: ItemRef[],
    currentSubgraphId: string | null
  ): string | null => {
    for (const ref of refs) {
      if (ref.type === 'group') {
        if (ref.id === groupId && currentSubgraphId === subgraphId) {
          return ref.stableKey;
        }
        const nested = findGroupStableKey(layout.groups[ref.stableKey] ?? [], currentSubgraphId);
        if (nested) return nested;
        continue;
      }
      if (ref.type === 'subgraph') {
        const nested = findGroupStableKey(layout.subgraphs[ref.id] ?? [], ref.id);
        if (nested) return nested;
      }
    }
    return null;
  };
  const stableKey = findGroupStableKey(layout.root, null);
  if (!stableKey) return layout;
  return removeGroupFromLayoutByKey(layout, stableKey);
}

export function removeGroupFromLayoutByKey(
  layout: MobileLayout,
  groupStableKey: string
): MobileLayout {
  const groupChildren = layout.groups[groupStableKey] ?? [];

  // Find where the group ref is and replace it with children
  const replaceGroupRef = (items: ItemRef[]): ItemRef[] => {
    const result: ItemRef[] = [];
    for (const item of items) {
      if (item.type === 'group' && item.stableKey === groupStableKey) {
        result.push(...groupChildren);
      } else {
        result.push(item);
      }
    }
    return result;
  };

  const nextGroups = { ...layout.groups };
  const nextGroupParents = { ...(layout.groupParents ?? {}) };
  const removedParent = nextGroupParents[groupStableKey];
  delete nextGroups[groupStableKey];
  delete nextGroupParents[groupStableKey];

  // Check root
  let nextRoot = layout.root;
  if (layout.root.some((item) => item.type === 'group' && item.stableKey === groupStableKey)) {
    nextRoot = replaceGroupRef(layout.root);
  }

  // Check other groups
  for (const [gId, items] of Object.entries(nextGroups)) {
    if (items.some((item) => item.type === 'group' && item.stableKey === groupStableKey)) {
      nextGroups[gId] = replaceGroupRef(items);
    }
  }

  // Check subgraphs
  const nextSubgraphs = { ...layout.subgraphs };
  for (const [sgId, items] of Object.entries(nextSubgraphs)) {
    if (items.some((item) => item.type === 'group' && item.stableKey === groupStableKey)) {
      nextSubgraphs[sgId] = replaceGroupRef(items);
    }
  }

  for (const child of groupChildren) {
    if (child.type !== 'group') continue;
    if (removedParent) {
      nextGroupParents[child.stableKey] = removedParent;
    } else {
      delete nextGroupParents[child.stableKey];
    }
  }

  return {
    root: nextRoot,
    groups: nextGroups,
    groupParents: nextGroupParents,
    subgraphs: nextSubgraphs,
    hiddenBlocks: layout.hiddenBlocks
  };
}

/**
 * Move an item within the layout. Used for reposition commit.
 */
export function moveItemInLayout(
  layout: MobileLayout,
  item: ItemRef,
  fromContainerId: ContainerId,
  fromIndex: number,
  toContainerId: ContainerId,
  toIndex: number
): MobileLayout {
  const currentGroupParents = layout.groupParents ?? {};
  const getList = (l: MobileLayout, c: ContainerId): ItemRef[] => {
    if (c.scope === 'root') return l.root;
    if (c.scope === 'group') return l.groups[c.groupKey] ?? [];
    return l.subgraphs[c.subgraphId] ?? [];
  };

  const setList = (l: MobileLayout, c: ContainerId, items: ItemRef[]): MobileLayout => {
    if (c.scope === 'root') return { ...l, root: items };
    if (c.scope === 'group') return { ...l, groups: { ...l.groups, [c.groupKey]: items } };
    return { ...l, subgraphs: { ...l.subgraphs, [c.subgraphId]: items } };
  };
  const parentRefFromContainer = (c: ContainerId): GroupParentRef => {
    if (c.scope === 'root') return { scope: 'root' };
    if (c.scope === 'group') return { scope: 'group', groupKey: c.groupKey };
    return { scope: 'subgraph', subgraphId: c.subgraphId };
  };

  const sameContainer =
    fromContainerId.scope === toContainerId.scope &&
    (fromContainerId.scope === 'root' ||
      (fromContainerId.scope === 'group' && toContainerId.scope === 'group' && fromContainerId.groupKey === toContainerId.groupKey) ||
      (fromContainerId.scope === 'subgraph' && toContainerId.scope === 'subgraph' && fromContainerId.subgraphId === toContainerId.subgraphId));

  if (sameContainer) {
    const list = [...getList(layout, fromContainerId)];
    const [removed] = list.splice(fromIndex, 1);
    if (!removed) return layout;
    const adjustedTo = toIndex > fromIndex ? toIndex - 1 : toIndex;
    list.splice(adjustedTo, 0, removed);
    return setList(layout, fromContainerId, list);
  }

  // Cross-container move
  const fromList = [...getList(layout, fromContainerId)];
  fromList.splice(fromIndex, 1);
  let next = setList(layout, fromContainerId, fromList);

  const toList = [...getList(next, toContainerId)];
  toList.splice(toIndex, 0, item);
  next = setList(next, toContainerId, toList);

  if (item.type === 'group') {
    next = {
      ...next,
      groupParents: {
        ...(next.groupParents ?? currentGroupParents),
        [item.stableKey]: parentRefFromContainer(toContainerId)
      }
    };
  }

  return next;
}

/**
 * Get flat node ID list from layout for rendering (preserving hierarchical order).
 */
export function flattenLayoutToNodeOrder(layout: MobileLayout): number[] {
  const result: number[] = [];

  const collectFromList = (items: ItemRef[]) => {
    for (const item of items) {
      if (item.type === 'node') {
        result.push(item.id);
      } else if (item.type === 'group') {
        const groupItems = layout.groups[item.stableKey];
        if (groupItems) collectFromList(groupItems);
      } else if (item.type === 'subgraph') {
        const sgItems = layout.subgraphs[item.id];
        if (sgItems) collectFromList(sgItems);
      } else if (item.type === 'hiddenBlock') {
        const blockNodes = layout.hiddenBlocks[item.blockId];
        if (blockNodes) result.push(...blockNodes);
      }
    }
  };

  collectFromList(layout.root);
  return result;
}

/**
 * Get items in a specific container.
 */
export function getContainerItems(layout: MobileLayout, containerId: ContainerId): ItemRef[] {
  if (containerId.scope === 'root') return layout.root;
  if (containerId.scope === 'group') return layout.groups[containerId.groupKey] ?? [];
  return layout.subgraphs[containerId.subgraphId] ?? [];
}

/**
 * Find which container an item is in and at what index.
 */
export function findItemInLayout(
  layout: MobileLayout,
  item: ItemRef
): { containerId: ContainerId; index: number } | null {
  const findInList = (items: ItemRef[], containerId: ContainerId) => {
    const index = items.findIndex((i) => itemRefEquals(i, item));
    if (index >= 0) return { containerId, index };
    return null;
  };

  const rootResult = findInList(layout.root, { scope: 'root' });
  if (rootResult) return rootResult;

  for (const [groupKey, items] of Object.entries(layout.groups)) {
    const result = findInList(items, { scope: 'group', groupKey });
    if (result) return result;
  }

  for (const [subgraphId, items] of Object.entries(layout.subgraphs)) {
    const result = findInList(items, { scope: 'subgraph', subgraphId });
    if (result) return result;
  }

  return null;
}

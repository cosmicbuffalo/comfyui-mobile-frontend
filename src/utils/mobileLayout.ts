import type { Workflow, WorkflowNode } from '@/api/types';
import { computeNodeGroupsFor } from '@/utils/nodeGroups';

// --- Types ---

export type ItemRef =
  | { type: 'node'; id: number }
  | { type: 'group'; id: number; subgraphId: string | null; itemKey: string }
  | { type: 'subgraph'; id: string; nodeId?: number }
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
  | { type: 'group'; groupId: number; subgraphId: string | null }
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

export interface NodeLayoutMembership {
  scope: 'root' | 'subgraph';
  subgraphId: string | null;
  groupKey: string | null;
}

export function scopedNodeKey(nodeId: number, subgraphId: string | null): string {
  return `${subgraphId ?? 'root'}:${nodeId}`;
}

export function collectScopedMembership(
  layout: MobileLayout
): Map<string, NodeLayoutMembership> {
  const membership = new Map<string, NodeLayoutMembership>();
  const visitingGroups = new Set<string>();
  const visitingSubgraphs = new Set<string>();

  const visit = (
    refs: ItemRef[],
    subgraphId: string | null,
    currentGroupKey: string | null
  ) => {
    const scope: 'root' | 'subgraph' = subgraphId != null ? 'subgraph' : 'root';
    for (const ref of refs) {
      if (ref.type === 'node') {
        membership.set(scopedNodeKey(ref.id, subgraphId), { scope, subgraphId, groupKey: currentGroupKey });
        continue;
      }
      if (ref.type === 'hiddenBlock') {
        for (const nodeId of layout.hiddenBlocks[ref.blockId] ?? []) {
          membership.set(scopedNodeKey(nodeId, subgraphId), { scope, subgraphId, groupKey: currentGroupKey });
        }
        continue;
      }
      if (ref.type === 'group') {
        const groupKey = getGroupKey(ref.id, ref.subgraphId);
        if (visitingGroups.has(groupKey)) continue;
        visitingGroups.add(groupKey);
        visit(layout.groups[groupKey] ?? [], subgraphId, groupKey);
        visitingGroups.delete(groupKey);
        continue;
      }
      if (visitingSubgraphs.has(ref.id)) continue;
      visitingSubgraphs.add(ref.id);
      visit(layout.subgraphs[ref.id] ?? [], ref.id, null);
      visitingSubgraphs.delete(ref.id);
    }
  };

  visit(layout.root, null, null);
  return membership;
}

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
  const base = pointer.subgraphId == null ? 'root' : `root/subgraph:${pointer.subgraphId}`;
  if (pointer.type === 'group') {
    return `${base}/group:${pointer.groupId}`;
  }
  if (pointer.type === 'node') {
    return `${base}/node:${pointer.nodeId}`;
  }
  return `root/subgraph:${pointer.subgraphId}`;
}

export function getGroupKey(groupId: number, subgraphId: string | null): string {
  return makeLocationPointer({ type: 'group', groupId, subgraphId });
}

export function extractLayoutNodeMembership(layout: MobileLayout): Map<number, string> {
  const membership = collectScopedMembership(layout);
  const result = new Map<number, string>();
  for (const [key, member] of membership.entries()) {
    if (member.subgraphId !== null) continue;
    if (!member.groupKey) continue;
    const nodeId = Number(key.split(':').pop() ?? NaN);
    if (!Number.isFinite(nodeId)) continue;
    result.set(nodeId, member.groupKey);
  }
  return result;
}

export function extractLayoutSubgraphNodeMembership(layout: MobileLayout): Map<number, string> {
  const membership = collectScopedMembership(layout);
  const result = new Map<number, string>();
  for (const [key, member] of membership.entries()) {
    if (member.subgraphId === null) continue;
    if (!member.groupKey) continue;
    const nodeId = Number(key.split(':').pop() ?? NaN);
    if (!Number.isFinite(nodeId)) continue;
    result.set(nodeId, member.groupKey);
  }
  return result;
}

// --- Helpers ---

function itemRefEquals(a: ItemRef, b: ItemRef): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'node' && b.type === 'node') return a.id === b.id;
  if (a.type === 'group' && b.type === 'group') return a.id === b.id && a.subgraphId === b.subgraphId;
  if (a.type === 'subgraph' && b.type === 'subgraph') {
    // If both refs carry an instance nodeId, compare by that — two placeholder
    // nodes for the same definition are distinct layout items.
    if (a.nodeId !== undefined && b.nodeId !== undefined) return a.nodeId === b.nodeId;
    return a.id === b.id;
  }
  if (a.type === 'hiddenBlock' && b.type === 'hiddenBlock') return a.blockId === b.blockId;
  return false;
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

  const subgraphIds = new Set(subgraphs.map((sg) => sg.id));
  const nodeToGroup = computeNodeGroupsFor(orderedNodes, groups);

  // Build subgraph inner node group maps (inner nodes live in sg.nodes, not orderedNodes)
  const subgraphNodeToGroup = new Map<string, Map<number, number>>();
  for (const sg of subgraphs) {
    const sgNodes = sg.nodes ?? [];
    const sgGroups = sg.groups ?? [];
    if (sgGroups.length > 0) {
      subgraphNodeToGroup.set(sg.id, computeNodeGroupsFor(sgNodes, sgGroups));
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
  // Inner nodes come from sg.nodes (canonical model — not from orderedNodes).
  for (const sg of subgraphs) {
    const sgNodes = sg.nodes ?? [];
    const sgGroups = sg.groups ?? [];
    const sgGroupParentMap = getGroupParentMap(sgGroups);
    const sgEmittedGroups = new Set<number>();
    const sgRootItems: ItemRef[] = [];
    const groupKey = (groupId: number) => getGroupKey(groupId, sg.id);
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
        const currentGroupKey = groupKey(id);
        const ref: ItemRef = { type: 'group', id, subgraphId: sg.id, itemKey: currentGroupKey };
        if (parentId == null) {
          sgRootItems.push(ref);
          layout.groupParents![currentGroupKey] = { scope: 'subgraph', subgraphId: sg.id };
        } else {
          const parentGroupKey = groupKey(parentId);
          layout.groups[parentGroupKey] ??= [];
          layout.groups[parentGroupKey].push(ref);
          layout.groupParents![currentGroupKey] = { scope: 'group', groupKey: parentGroupKey };
        }
        sgEmittedGroups.add(id);
      }
    };

    const sgNodeToGroupForSg = subgraphNodeToGroup.get(sg.id);
    for (const node of sgNodes) {
      const assignedGroupId = sgNodeToGroupForSg?.get(node.id);
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
  // orderedNodes = root-level nodes; placeholder nodes (subgraphIds.has(node.type)) become
  // { type: 'subgraph' } items at the position the placeholder occupies in the root order.
  const rootGroupParentMap = getGroupParentMap(groups);
  const rootEmittedGroups = new Set<number>();
  const rootItems: ItemRef[] = [];
  const rootGroupKey = (groupId: number) => getGroupKey(groupId, null);
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
      const currentGroupKey = rootGroupKey(id);
      const ref: ItemRef = { type: 'group', id, subgraphId: null, itemKey: currentGroupKey };
      if (parentId == null) {
        rootItems.push(ref);
        layout.groupParents![currentGroupKey] = { scope: 'root' };
      } else {
        const parentGroupKey = rootGroupKey(parentId);
        layout.groups[parentGroupKey] ??= [];
        layout.groups[parentGroupKey].push(ref);
        layout.groupParents![currentGroupKey] = { scope: 'group', groupKey: parentGroupKey };
      }
      rootEmittedGroups.add(id);
    }
  };

  for (const node of orderedNodes) {
    const assignedGroupId = nodeToGroup.get(node.id);
    // Placeholder nodes (type matches a subgraph UUID) become { type: 'subgraph' } items.
    const item: ItemRef = subgraphIds.has(node.type)
      ? { type: 'subgraph', id: node.type, nodeId: node.id }
      : { type: 'node', id: node.id };
    if (assignedGroupId === undefined) {
      rootItems.push(item);
      continue;
    }
    emitRootGroupChain(assignedGroupId);
    layout.groups[rootGroupKey(assignedGroupId)] ??= [];
    layout.groups[rootGroupKey(assignedGroupId)].push(item);
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
 * Remove a node from the layout (e.g., on delete).
 */
export function removeNodeFromLayout(
  layout: MobileLayout,
  nodeId: number,
  subgraphId: string | null = null
): MobileLayout {
  const touchedHiddenBlocks = new Set<string>();
  const resolveGroupScopeSubgraphId = (groupKey: string): string | null => {
    const visited = new Set<string>();
    let current = groupKey;
    while (!visited.has(current)) {
      visited.add(current);
      const parent = layout.groupParents?.[current];
      if (!parent) return null;
      if (parent.scope === 'root') return null;
      if (parent.scope === 'subgraph') return parent.subgraphId;
      current = parent.groupKey;
    }
    return null;
  };

  const removeFromList = (items: ItemRef[], currentSubgraphId: string | null): ItemRef[] => {
    const result: ItemRef[] = [];
    for (const item of items) {
      if (item.type === 'node' && item.id === nodeId && currentSubgraphId === subgraphId) continue;
      if (item.type === 'hiddenBlock') {
        const blockNodes = layout.hiddenBlocks[item.blockId];
        if (blockNodes && currentSubgraphId === subgraphId) {
          touchedHiddenBlocks.add(item.blockId);
          const filtered = blockNodes.filter((id) => id !== nodeId);
          if (filtered.length === 0) continue; // Remove empty block
          // Update will be done in hiddenBlocks below
        }
      }
      result.push(item);
    }
    return result;
  };

  const nextGroups: Record<string, ItemRef[]> = {};
  for (const [groupId, items] of Object.entries(layout.groups)) {
    const scopeSubgraphId = resolveGroupScopeSubgraphId(groupId);
    nextGroups[groupId] = removeFromList(items, scopeSubgraphId);
  }

  const nextSubgraphs: Record<string, ItemRef[]> = {};
  for (const [subgraphId, items] of Object.entries(layout.subgraphs)) {
    nextSubgraphs[subgraphId] = removeFromList(items, subgraphId);
  }

  const nextRoot = removeFromList(layout.root, null);

  const nextHiddenBlocks: Record<string, number[]> = {};
  for (const [blockId, nodeIds] of Object.entries(layout.hiddenBlocks)) {
    if (!touchedHiddenBlocks.has(blockId)) {
      nextHiddenBlocks[blockId] = nodeIds;
      continue;
    }
    const filtered = nodeIds.filter((id) => id !== nodeId);
    if (filtered.length > 0) {
      nextHiddenBlocks[blockId] = filtered;
    }
  }

  return {
    root: nextRoot,
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
  const findGroupKey = (
    groupId: number,
    subgraphId: string | null
  ): string | null => {
    const scan = (
      refs: ItemRef[],
      currentSubgraphId: string | null
    ): string | null => {
      for (const item of refs) {
        if (item.type === 'group' && item.id === groupId && currentSubgraphId === subgraphId) {
          return getGroupKey(item.id, item.subgraphId);
        }
        if (item.type === 'group') {
          const nested = scan(layout.groups[getGroupKey(item.id, item.subgraphId)] ?? [], currentSubgraphId);
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
      const groupKey = findGroupKey(container.groupId, container.subgraphId);
      if (!groupKey) {
        return {
          ...layout,
          subgraphs: { ...layout.subgraphs, [container.subgraphId]: [...subgraphItems, ref] }
        };
      }
      const groupItems = layout.groups[groupKey] ?? [];
      return {
        ...layout,
        groups: { ...layout.groups, [groupKey]: [...groupItems, ref] }
      };
    }
    return {
      ...layout,
      subgraphs: { ...layout.subgraphs, [container.subgraphId]: [...subgraphItems, ref] }
    };
  }

  if (container?.groupId != null) {
    const groupKey = findGroupKey(container.groupId, container.subgraphId ?? null);
    if (!groupKey) {
      return {
        ...layout,
        root: [...layout.root, ref]
      };
    }
    const groupItems = layout.groups[groupKey] ?? [];
    return {
      ...layout,
      groups: { ...layout.groups, [groupKey]: [...groupItems, ref] }
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
  const findGroupKey = (
    refs: ItemRef[],
    currentSubgraphId: string | null
  ): string | null => {
    for (const ref of refs) {
      if (ref.type === 'group') {
        if (ref.id === groupId && currentSubgraphId === subgraphId) {
          return getGroupKey(ref.id, ref.subgraphId);
        }
        const nested = findGroupKey(layout.groups[getGroupKey(ref.id, ref.subgraphId)] ?? [], currentSubgraphId);
        if (nested) return nested;
        continue;
      }
      if (ref.type === 'subgraph') {
        const nested = findGroupKey(layout.subgraphs[ref.id] ?? [], ref.id);
        if (nested) return nested;
      }
    }
    return null;
  };
  const groupKey = findGroupKey(layout.root, null);
  if (!groupKey) return layout;
  return removeGroupFromLayoutByKey(layout, groupKey);
}

export function removeGroupFromLayoutByKey(
  layout: MobileLayout,
  groupKey: string
): MobileLayout {
  const groupChildren = layout.groups[groupKey] ?? [];

  // Find where the group ref is and replace it with children
  const replaceGroupRef = (items: ItemRef[]): ItemRef[] => {
    const result: ItemRef[] = [];
    for (const item of items) {
      if (item.type === 'group' && getGroupKey(item.id, item.subgraphId) === groupKey) {
        result.push(...groupChildren);
      } else {
        result.push(item);
      }
    }
    return result;
  };

  const nextGroups = { ...layout.groups };
  const nextGroupParents = { ...(layout.groupParents ?? {}) };
  const removedParent = nextGroupParents[groupKey];
  delete nextGroups[groupKey];
  delete nextGroupParents[groupKey];

  // Check root
  let nextRoot = layout.root;
  if (layout.root.some((item) => item.type === 'group' && getGroupKey(item.id, item.subgraphId) === groupKey)) {
    nextRoot = replaceGroupRef(layout.root);
  }

  // Check other groups
  for (const [gId, items] of Object.entries(nextGroups)) {
    if (items.some((item) => item.type === 'group' && getGroupKey(item.id, item.subgraphId) === groupKey)) {
      nextGroups[gId] = replaceGroupRef(items);
    }
  }

  // Check subgraphs
  const nextSubgraphs = { ...layout.subgraphs };
  for (const [sgId, items] of Object.entries(nextSubgraphs)) {
    if (items.some((item) => item.type === 'group' && getGroupKey(item.id, item.subgraphId) === groupKey)) {
      nextSubgraphs[sgId] = replaceGroupRef(items);
    }
  }

  for (const child of groupChildren) {
    if (child.type !== 'group') continue;
    const childGroupKey = getGroupKey(child.id, child.subgraphId);
    if (removedParent) {
      nextGroupParents[childGroupKey] = removedParent;
    } else {
      delete nextGroupParents[childGroupKey];
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
    const groupKey = getGroupKey(item.id, item.subgraphId);
    next = {
      ...next,
      groupParents: {
        ...(next.groupParents ?? currentGroupParents),
        [groupKey]: parentRefFromContainer(toContainerId)
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
        const groupItems = layout.groups[getGroupKey(item.id, item.subgraphId)];
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

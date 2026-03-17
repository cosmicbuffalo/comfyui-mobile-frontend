import type { Workflow, WorkflowGroup, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import type { ItemRef, MobileLayout } from '@/utils/mobileLayout';
import { getGroupKey, makeLocationPointer } from '@/utils/mobileLayout';
import { computeNodeGroupsFor } from '@/utils/nodeGroups';
import { normalizeHexColor } from '@/utils/colorUtils';
import { themeColors } from '@/theme/colors';

export type NestedItem =
  | {
      type: 'group';
      group: WorkflowGroup;
      nodeCount: number;
      bypassedNodeCount: number;
      isCollapsed: boolean;
      subgraphId: string | null;
      children: NestedItem[];
    }
  | {
      type: 'subgraph';
      subgraph: WorkflowSubgraphDefinition;
      nodeCount: number;
      bypassedNodeCount: number;
      isCollapsed: boolean;
      groupId: number | null;
      children: NestedItem[];
    }
  | {
      type: 'node';
      node: WorkflowNode;
      groupId: number | null;
      subgraphId: string | null;
    }
  | {
      type: 'hiddenBlock';
      blockId: string;
      nodeIds: number[];
      count: number;
    };

export function computeNodeGroups(
  workflow: Workflow,
  groupOverrides?: Record<number, number | null>
): Map<number, number> {
  const groups = workflow.groups ?? [];
  return applyGroupOverrides(computeNodeGroupsFor(workflow.nodes, groups), groupOverrides);
}

export function computeNodeGroupsIncludingSubgraphs(
  workflow: Workflow,
  groupOverrides?: Record<number, number | null>
): Map<number, number> {
  const groups = workflow.groups ?? [];
  const subgraphs = workflow.definitions?.subgraphs ?? [];

  // Canonical model: workflow.nodes contains only root-level nodes (+ placeholders).
  // Inner subgraph nodes live in definitions.subgraphs[*].nodes.
  const combined = new Map<number, number>();

  const topLevelMap = computeNodeGroupsFor(workflow.nodes, groups);
  for (const [nodeId, groupId] of topLevelMap.entries()) {
    combined.set(nodeId, groupId);
  }

  for (const subgraph of subgraphs) {
    const subgraphGroups = subgraph.groups ?? [];
    if (subgraphGroups.length === 0) continue;
    const subgraphNodes = subgraph.nodes ?? [];
    const subgraphMap = computeNodeGroupsFor(subgraphNodes, subgraphGroups);
    for (const [nodeId, groupId] of subgraphMap.entries()) {
      combined.set(nodeId, groupId);
    }
  }

  return applyGroupOverrides(combined, groupOverrides);
}

function applyGroupOverrides(
  nodeToGroup: Map<number, number>,
  overrides: Record<number, number | null> | undefined
): Map<number, number> {
  if (!overrides) return nodeToGroup;
  const next = new Map(nodeToGroup);
  for (const [nodeIdText, groupId] of Object.entries(overrides)) {
    const nodeId = Number(nodeIdText);
    if (!Number.isFinite(nodeId)) continue;
    if (groupId == null) {
      next.delete(nodeId);
      continue;
    }
    next.set(nodeId, groupId);
  }
  return next;
}

/**
 * Builds a list of items to render, including group headers, footers, placeholders,
 * subgraph headers/footers, and nodes.
 *
 * Key behavior:
 * - Subgraphs are positioned by their earliest-dependency node
 * - When we encounter the first node of a subgraph, we emit the entire subgraph
 * - Groups within subgraphs are handled when the subgraph is expanded
 * - Groups are positioned by their earliest-dependency node in the ordered list
 * - When we encounter the first node of a group, we emit the ENTIRE group
 *   (header + all nodes in that group + footer) before continuing
 */
export function buildNestedList(
  orderedNodes: WorkflowNode[],
  workflow: Workflow,
  collapsedItems: Record<string, boolean>,
  hiddenItems: Record<string, boolean> = {},
  groupOverrides?: Record<number, number | null>
): NestedItem[] {
  const hasFlag = (state: Record<string, boolean>, key: string): boolean => Boolean(state[key]);
  const getFlag = (
    state: Record<string, boolean>,
    key: string,
    fallback: boolean
  ): boolean => state[key] ?? fallback;
  const groupStateKey = (subgraphId: string | null, groupId: number): string =>
    makeLocationPointer({ type: 'group', groupId, subgraphId });

  const groups = workflow.groups ?? [];
  const subgraphs = workflow.definitions?.subgraphs ?? [];
  const subgraphById = new Map(subgraphs.map((sg) => [sg.id, sg]));

  const rawSubgraphGroupMap =
    (workflow.extra as Record<string, unknown> | undefined)?.[
      '__mobile_subgraph_group_map'
    ];
  const subgraphGroupMap = new Map<string, number | null>();
  if (rawSubgraphGroupMap && typeof rawSubgraphGroupMap === 'object') {
    for (const [key, value] of Object.entries(
      rawSubgraphGroupMap as Record<string, unknown>
    )) {
      if (typeof value === 'number' || value === null) {
        subgraphGroupMap.set(key, value);
      }
    }
  }
  for (const subgraph of subgraphs) {
    if (!subgraphGroupMap.has(subgraph.id)) {
      subgraphGroupMap.set(subgraph.id, null);
    }
  }

  // Canonical model: orderedNodes only contains root-level nodes (+ placeholders).
  // Inner subgraph nodes live in definitions.subgraphs[*].nodes.
  const subgraphIds = new Set(subgraphs.map((sg) => sg.id));
  const nodesInSubgraph = new Map<string, WorkflowNode[]>();
  for (const sg of subgraphs) {
    nodesInSubgraph.set(sg.id, sg.nodes ?? []);
  }

  const topLevelNodes = orderedNodes;
  const nodeToGroup = applyGroupOverrides(
    computeNodeGroupsFor(topLevelNodes, groups),
    groupOverrides
  );
  const groupById = new Map(groups.map((g) => [g.id, g]));

  type NodeEntry = { kind: 'node'; node: WorkflowNode };
  type SubgraphEntry = { kind: 'subgraph'; subgraphId: string };
  type Entry = NodeEntry | SubgraphEntry;

  const entries: Entry[] = [];
  const subgraphEmitted = new Set<string>();
  for (const node of orderedNodes) {
    // Placeholder nodes (type matches a subgraph UUID) become subgraph entries.
    if (subgraphIds.has(node.type)) {
      if (!subgraphEmitted.has(node.type)) {
        entries.push({ kind: 'subgraph', subgraphId: node.type });
        subgraphEmitted.add(node.type);
      }
      continue;
    }
    entries.push({ kind: 'node', node });
  }

  const groupEntriesById = new Map<number, Entry[]>();
  for (const entry of entries) {
    const groupId =
      entry.kind === 'node'
        ? nodeToGroup.get(entry.node.id)
        : subgraphGroupMap.get(entry.subgraphId) ?? null;
    if (groupId === undefined || groupId === null) continue;
    const bucket = groupEntriesById.get(groupId);
    if (bucket) {
      bucket.push(entry);
    } else {
      groupEntriesById.set(groupId, [entry]);
    }
  }

  const countEntryNodes = (entry: Entry): number => {
    if (entry.kind === 'node') return 1;
    if (
      hasFlag(hiddenItems, makeLocationPointer({ type: 'subgraph', subgraphId: entry.subgraphId }))
    ) {
      return 0;
    }
    return 1;
  };

  const countBypassedEntryNodes = (entries: Entry[]): number => {
    let count = 0;
    for (const entry of entries) {
      if (entry.kind === 'node') {
        if (entry.node.mode === 4) count++;
      } else {
        if (hasFlag(hiddenItems, makeLocationPointer({ type: 'subgraph', subgraphId: entry.subgraphId }))) continue;
        const nodes = nodesInSubgraph.get(entry.subgraphId) ?? [];
        if (nodes.length > 0 && nodes.every((n) => n.mode === 4)) count += 1;
      }
    }
    return count;
  };

  const buildNodeItem = (
    node: WorkflowNode,
    groupId: number | null,
    subgraphId: string | null
  ): NestedItem => ({
    type: 'node',
    node,
    groupId,
    subgraphId
  });

  const buildSubgraphChildren = (subgraphId: string): NestedItem[] => {
    const subgraph = subgraphById.get(subgraphId);
    if (!subgraph) return [];
    const subgraphNodes = nodesInSubgraph.get(subgraphId) ?? [];
    const subgraphGroups = subgraph.groups ?? [];

    if (subgraphGroups.length === 0) {
      return subgraphNodes.map((node) =>
        buildNodeItem(node, null, subgraphId)
      );
    }

    const subgraphNodeToGroup = applyGroupOverrides(
      computeNodeGroupsFor(subgraphNodes, subgraphGroups),
      groupOverrides
    );
    const subgraphGroupById = new Map(
      subgraphGroups.map((group) => [group.id, group])
    );
    const subgraphEntries: NodeEntry[] = subgraphNodes.map((node) => ({
      kind: 'node',
      node
    }));

    const subgraphGroupEntries = new Map<number, NodeEntry[]>();
    for (const entry of subgraphEntries) {
      const groupId = subgraphNodeToGroup.get(entry.node.id);
      if (groupId === undefined) continue;
      const bucket = subgraphGroupEntries.get(groupId);
      if (bucket) {
        bucket.push(entry);
      } else {
        subgraphGroupEntries.set(groupId, [entry]);
      }
    }

    const children: NestedItem[] = [];
    const emittedSubgraphGroups = new Set<number>();
    for (const entry of subgraphEntries) {
      const groupId = subgraphNodeToGroup.get(entry.node.id);
      if (groupId !== undefined) {
        if (emittedSubgraphGroups.has(groupId)) continue;
        const group = subgraphGroupById.get(groupId);
        const groupEntries = subgraphGroupEntries.get(groupId) ?? [];
        if (group && !hasFlag(hiddenItems, groupStateKey(subgraphId, group.id))) {
          const nodeCount = groupEntries.reduce(
            (count, item) => count + countEntryNodes(item),
            0
          );
          const isCollapsed = getFlag(
            collapsedItems,
            groupStateKey(subgraphId, group.id),
            false
          );
          const childItems = isCollapsed
            ? []
            : groupEntries.map((item) =>
                buildNodeItem(item.node, group.id, subgraphId)
              );
          children.push({
            type: 'group',
            group,
            nodeCount,
            bypassedNodeCount: countBypassedEntryNodes(groupEntries),
            isCollapsed,
            subgraphId,
            children: childItems
          });
        }
        emittedSubgraphGroups.add(groupId);
        continue;
      }
      children.push(buildNodeItem(entry.node, null, subgraphId));
    }

    for (const group of subgraphGroups) {
      if (hasFlag(hiddenItems, groupStateKey(subgraphId, group.id))) continue;
      if (emittedSubgraphGroups.has(group.id)) continue;
      children.push({
        type: 'group',
        group,
        nodeCount: 0,
        bypassedNodeCount: 0,
        isCollapsed: getFlag(collapsedItems, groupStateKey(subgraphId, group.id), false),
        subgraphId,
        children: []
      });
    }

    return children;
  };

  const buildSubgraphItem = (
    subgraphId: string,
    groupId: number | null
  ): NestedItem | null => {
    if (hasFlag(hiddenItems, makeLocationPointer({ type: 'subgraph', subgraphId }))) return null;
    const subgraph = subgraphById.get(subgraphId);
    if (!subgraph) return null;
    const subgraphNodes = nodesInSubgraph.get(subgraphId) ?? [];
    const isCollapsed = getFlag(
      collapsedItems,
      makeLocationPointer({ type: 'subgraph', subgraphId }),
      false
    );
    const children = isCollapsed ? [] : buildSubgraphChildren(subgraphId);

    return {
      type: 'subgraph',
      subgraph,
      nodeCount: subgraphNodes.length,
      bypassedNodeCount: subgraphNodes.filter((n) => n.mode === 4).length,
      isCollapsed,
      groupId,
      children
    };
  };

  const buildGroupItem = (
    group: WorkflowGroup,
    entriesInGroup: Entry[],
    subgraphId: string | null
  ): NestedItem | null => {
    if (hasFlag(hiddenItems, groupStateKey(subgraphId, group.id))) return null;
    const nodeCount = entriesInGroup.reduce(
      (count, entry) => count + countEntryNodes(entry),
      0
    );
    const isCollapsed = getFlag(
      collapsedItems,
      groupStateKey(subgraphId, group.id),
      false
    );
    const children = isCollapsed
      ? []
      : entriesInGroup
          .map((entry) => {
            if (entry.kind === 'node') {
              return buildNodeItem(entry.node, group.id, subgraphId);
            }
            return buildSubgraphItem(entry.subgraphId, group.id);
          })
          .filter(Boolean) as NestedItem[];

    return {
      type: 'group',
      group,
      nodeCount,
      bypassedNodeCount: countBypassedEntryNodes(entriesInGroup),
      isCollapsed,
      subgraphId,
      children
    };
  };

  const result: NestedItem[] = [];
  const emittedGroups = new Set<number>();

  for (const entry of entries) {
    const groupId =
      entry.kind === 'node'
        ? nodeToGroup.get(entry.node.id)
        : subgraphGroupMap.get(entry.subgraphId) ?? null;
    if (groupId !== undefined && groupId !== null) {
      if (emittedGroups.has(groupId)) continue;
      const group = groupById.get(groupId);
      const groupEntries = groupEntriesById.get(groupId) ?? [];
      if (group) {
        const groupItem = buildGroupItem(group, groupEntries, null);
        if (groupItem) {
          result.push(groupItem);
        }
      } else {
        for (const item of groupEntries) {
          if (item.kind === 'node') {
            result.push(buildNodeItem(item.node, null, null));
          } else {
            const subgraphItem = buildSubgraphItem(item.subgraphId, null);
            if (subgraphItem) result.push(subgraphItem);
          }
        }
      }
      emittedGroups.add(groupId);
      continue;
    }

    if (entry.kind === 'node') {
      result.push(buildNodeItem(entry.node, null, null));
    } else {
      const subgraphItem = buildSubgraphItem(entry.subgraphId, null);
      if (subgraphItem) result.push(subgraphItem);
    }
  }

  for (const group of groups) {
    if (emittedGroups.has(group.id)) continue;
    const groupEntries = groupEntriesById.get(group.id) ?? [];
    const groupItem = buildGroupItem(group, groupEntries, null);
    if (groupItem) {
      result.push(groupItem);
    }
    emittedGroups.add(group.id);
  }

  return result;
}

/**
 * Build nested render items directly from the mobile layout structure.
 * This is the source of truth for user-driven reorder/reparent operations.
 */
export function buildNestedListFromLayout(
  layout: MobileLayout,
  workflow: Workflow,
  collapsedItems: Record<string, boolean>,
  hiddenItems: Record<string, boolean> = {},
  /** When navigated inside a subgraph, pass its ID so node/group lookups use the correct scope. */
  currentScopeSubgraphId: string | null = null
): NestedItem[] {
  const hasFlag = (state: Record<string, boolean>, key: string): boolean => Boolean(state[key]);
  const getFlag = (
    state: Record<string, boolean>,
    key: string,
    fallback: boolean
  ): boolean => state[key] ?? fallback;
  // Scope-aware node lookup: node IDs can collide between root and subgraph
  // scopes (e.g. root has MarkdownNote #961, subgraph has KSampler #961).
  // Each scope gets its own map; lookups fall back to root for placeholder nodes.
  const rootNodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const rootGroups = workflow.groups ?? [];
  const subgraphs = workflow.definitions?.subgraphs ?? [];
  const subgraphById = new Map(subgraphs.map((sg) => [sg.id, sg]));
  const rootGroupById = new Map(rootGroups.map((group) => [group.id, group]));
  const subgraphGroupBySubgraph = new Map<string, Map<number, WorkflowGroup>>();
  const subgraphNodeById = new Map<string, Map<number, WorkflowNode>>();
  for (const subgraph of subgraphs) {
    const groupMap = new Map<number, WorkflowGroup>();
    for (const group of subgraph.groups ?? []) {
      groupMap.set(group.id, group);
    }
    subgraphGroupBySubgraph.set(subgraph.id, groupMap);
    subgraphNodeById.set(
      subgraph.id,
      new Map((subgraph.nodes ?? []).map((node) => [node.id, node]))
    );
  }

  /** Resolve a node by ID within the correct scope. */
  const resolveNode = (nodeId: number, scopeSubgraphId: string | null): WorkflowNode | undefined => {
    if (scopeSubgraphId) {
      const sgMap = subgraphNodeById.get(scopeSubgraphId);
      if (sgMap?.has(nodeId)) return sgMap.get(nodeId);
      // Fall back to root for placeholder nodes that live in workflow.nodes
      return rootNodeById.get(nodeId);
    }
    return rootNodeById.get(nodeId);
  };

  const countNodesInRefs = (
    refs: ItemRef[],
    currentSubgraphId: string | null,
    visitedGroups = new Set<string>(),
    visitedSubgraphs = new Set<string>()
  ): number => {
    let count = 0;
    for (const ref of refs) {
      if (ref.type === 'node') {
        const nodePointer = makeLocationPointer({
          type: 'node',
          nodeId: ref.id,
          subgraphId: currentSubgraphId
        });
        if (!hasFlag(hiddenItems, nodePointer)) {
          count += 1;
        }
      } else if (ref.type === 'hiddenBlock') {
        const blockNodes = layout.hiddenBlocks[ref.blockId] ?? [];
        count += blockNodes.filter((nodeId) => {
          const nodePointer = makeLocationPointer({
            type: 'node',
            nodeId,
            subgraphId: currentSubgraphId
          });
          return !hasFlag(hiddenItems, nodePointer);
        }).length;
      } else if (ref.type === 'group') {
        const groupKey = getGroupKey(ref.id, ref.subgraphId);
        if (visitedGroups.has(groupKey)) continue;
        visitedGroups.add(groupKey);
        count += countNodesInRefs(
          layout.groups[groupKey] ?? [],
          currentSubgraphId,
          visitedGroups,
          visitedSubgraphs
        );
        visitedGroups.delete(groupKey);
      } else if (ref.type === 'subgraph') {
        if (visitedSubgraphs.has(ref.id)) continue;
        count += 1;
        visitedSubgraphs.add(ref.id);
      }
    }
    return count;
  };

  const countBypassedNodesInRefs = (
    refs: ItemRef[],
    currentSubgraphId: string | null,
    visitedGroups = new Set<string>(),
    visitedSubgraphs = new Set<string>()
  ): number => {
    let count = 0;
    for (const ref of refs) {
      if (ref.type === 'node') {
        const node = resolveNode(ref.id, currentSubgraphId);
        if (node && node.mode === 4) count++;
      } else if (ref.type === 'hiddenBlock') {
        const blockNodes = layout.hiddenBlocks[ref.blockId] ?? [];
        for (const nodeId of blockNodes) {
          const node = resolveNode(nodeId, currentSubgraphId);
          if (node && node.mode === 4) count++;
        }
      } else if (ref.type === 'group') {
        const groupKey = getGroupKey(ref.id, ref.subgraphId);
        if (visitedGroups.has(groupKey)) continue;
        visitedGroups.add(groupKey);
        count += countBypassedNodesInRefs(
          layout.groups[groupKey] ?? [],
          currentSubgraphId,
          visitedGroups,
          visitedSubgraphs
        );
        visitedGroups.delete(groupKey);
      } else if (ref.type === 'subgraph') {
        if (visitedSubgraphs.has(ref.id)) continue;
        visitedSubgraphs.add(ref.id);
        // Count subgraph as 1 bypassed if all its inner nodes are bypassed
        const subgraph = subgraphById.get(ref.id);
        const innerNodes = subgraph?.nodes ?? [];
        if (innerNodes.length > 0 && innerNodes.every((n) => n.mode === 4)) {
          count += 1;
        }
      }
    }
    return count;
  };

  const buildItems = (
    refs: ItemRef[],
    parentGroupId: number | null,
    parentSubgraphId: string | null,
    visitedGroups = new Set<string>(),
    visitedSubgraphs = new Set<string>()
  ): NestedItem[] => {
    const items: NestedItem[] = [];
    for (const ref of refs) {
      if (ref.type === 'hiddenBlock') {
        const nodeIds = layout.hiddenBlocks[ref.blockId] ?? [];
        if (nodeIds.length === 0) continue;
        items.push({
          type: 'hiddenBlock',
          blockId: ref.blockId,
          nodeIds,
          count: nodeIds.length
        });
        continue;
      }

      if (ref.type === 'node') {
        const nodePointer = makeLocationPointer({
          type: 'node',
          nodeId: ref.id,
          subgraphId: parentSubgraphId
        });
        if (hasFlag(hiddenItems, nodePointer)) {
          continue;
        }
        const node = resolveNode(ref.id, parentSubgraphId);
        if (!node) continue;
        items.push({
          type: 'node',
          node,
          groupId: parentGroupId,
          subgraphId: parentSubgraphId
        });
        continue;
      }

      if (ref.type === 'group') {
        const groupKey = getGroupKey(ref.id, ref.subgraphId);
        if (hasFlag(hiddenItems, groupKey)) continue;
        if (visitedGroups.has(groupKey)) continue;

        let group: WorkflowGroup | undefined;
        // Use the subgraph scope from the ref itself (set during layout build),
        // falling back to the runtime parentSubgraphId, then root.
        const groupScope = ref.subgraphId ?? parentSubgraphId;
        if (groupScope) {
          group = subgraphGroupBySubgraph.get(groupScope)?.get(ref.id);
        }
        group ??= rootGroupById.get(ref.id);
        if (!group) continue;

        const childRefs = layout.groups[groupKey] ?? [];
        const isCollapsed = getFlag(collapsedItems, groupKey, false);
        visitedGroups.add(groupKey);
        const children = isCollapsed
          ? []
          : buildItems(childRefs, ref.id, groupScope, visitedGroups, visitedSubgraphs);
        visitedGroups.delete(groupKey);

        items.push({
          type: 'group',
          group,
          nodeCount: countNodesInRefs(childRefs, groupScope),
          bypassedNodeCount: countBypassedNodesInRefs(childRefs, groupScope),
          isCollapsed,
          subgraphId: groupScope,
          children
        });
        continue;
      }

      if (hasFlag(hiddenItems, makeLocationPointer({ type: 'subgraph', subgraphId: ref.id }))) continue;
      if (visitedSubgraphs.has(ref.id)) continue;

      const subgraph = subgraphById.get(ref.id);
      if (!subgraph) continue;

      const childRefs = layout.subgraphs[ref.id] ?? [];
      const isCollapsed = getFlag(
        collapsedItems,
        makeLocationPointer({ type: 'subgraph', subgraphId: ref.id }),
        false
      );
      visitedSubgraphs.add(ref.id);
      const children = isCollapsed
        ? []
        : buildItems(childRefs, null, ref.id, visitedGroups, visitedSubgraphs);
      visitedSubgraphs.delete(ref.id);

      items.push({
        type: 'subgraph',
        subgraph,
        nodeCount: countNodesInRefs(childRefs, ref.id),
        bypassedNodeCount: countBypassedNodesInRefs(childRefs, ref.id),
        isCollapsed,
        groupId: parentGroupId,
        children
      });
    }
    return items;
  };

  return buildItems(layout.root, null, currentScopeSubgraphId);
}

/**
 * Parses a hex color string and returns an rgba version with the specified alpha.
 * Supports both #RGB and #RRGGBB formats.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return themeColors.transparentBlack;

  const cleanHex = normalized.slice(1);
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Gets the list item key for rendering.
 */

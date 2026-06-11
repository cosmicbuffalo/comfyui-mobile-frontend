import type { Workflow, WorkflowGroup, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import type { ItemRef, MobileLayout } from '@/utils/mobileLayout';
import { getGroupKey, makeLocationPointer } from '@/utils/mobileLayout';
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
      /** Placeholder node instance this item renders; null for legacy layouts without instance refs. */
      placeholderNodeId: number | null;
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
        // Key by instance so two placeholders of one definition both count.
        const instanceKey = ref.nodeId != null ? `${ref.id}#${ref.nodeId}` : ref.id;
        if (visitedSubgraphs.has(instanceKey)) continue;
        count += 1;
        visitedSubgraphs.add(instanceKey);
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
        const instanceKey = ref.nodeId != null ? `${ref.id}#${ref.nodeId}` : ref.id;
        if (visitedSubgraphs.has(instanceKey)) continue;
        visitedSubgraphs.add(instanceKey);
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
        placeholderNodeId: ref.nodeId ?? null,
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

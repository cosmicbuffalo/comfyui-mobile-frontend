import type { Workflow, WorkflowGroup, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';

export type NestedItem =
  | {
      type: 'group';
      group: WorkflowGroup;
      nodeCount: number;
      isCollapsed: boolean;
      subgraphId: string | null;
      children: NestedItem[];
    }
  | {
      type: 'subgraph';
      subgraph: WorkflowSubgraphDefinition;
      nodeCount: number;
      isCollapsed: boolean;
      groupId: number | null;
      children: NestedItem[];
    }
  | {
      type: 'node';
      node: WorkflowNode;
      groupId: number | null;
      subgraphId: string | null;
    };

/**
 * Computes which group each node belongs to.
 * A node is in a group if its center falls within the group's bounding box.
 * If a node falls within multiple groups, it's assigned to the first group by ID.
 */
function computeNodeGroupsFor(
  nodes: WorkflowNode[],
  groups: WorkflowGroup[]
): Map<number, number> {
  const nodeToGroup = new Map<number, number>();
  if (groups.length === 0) {
    return nodeToGroup;
  }

  // Sort groups by ID to ensure consistent assignment when overlapping
  const sortedGroups = [...groups].sort((a, b) => a.id - b.id);

  for (const node of nodes) {
    // Calculate node center
    const [nodeX, nodeY] = node.pos;
    const [nodeWidth, nodeHeight] = node.size;
    const centerX = nodeX + nodeWidth / 2;
    const centerY = nodeY + nodeHeight / 2;

    // Find first group that contains the node center
    for (const group of sortedGroups) {
      const [groupX, groupY, groupWidth, groupHeight] = group.bounding;

      if (
        centerX >= groupX &&
        centerX <= groupX + groupWidth &&
        centerY >= groupY &&
        centerY <= groupY + groupHeight
      ) {
        nodeToGroup.set(node.id, group.id);
        break; // Assign to first matching group
      }
    }
  }

  return nodeToGroup;
}

export function computeNodeGroups(workflow: Workflow): Map<number, number> {
  const groups = workflow.groups ?? [];
  return computeNodeGroupsFor(workflow.nodes, groups);
}

interface MobileOrigin {
  scope: 'root' | 'subgraph';
  subgraphId?: string;
  nodeId: number;
}

function getMobileOrigin(node: WorkflowNode): MobileOrigin | null {
  const props = node.properties as Record<string, unknown> | undefined;
  const origin = props?.['__mobile_origin'];
  if (!origin || typeof origin !== 'object') return null;
  const scope = (origin as { scope?: string }).scope;
  if (scope === 'root') {
    const nodeId = (origin as { nodeId?: number }).nodeId;
    return typeof nodeId === 'number' ? { scope: 'root', nodeId } : null;
  }
  if (scope === 'subgraph') {
    const nodeId = (origin as { nodeId?: number }).nodeId;
    const subgraphId = (origin as { subgraphId?: string }).subgraphId;
    if (typeof nodeId === 'number' && typeof subgraphId === 'string') {
      return { scope: 'subgraph', subgraphId, nodeId };
    }
  }
  return null;
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
  collapsedGroups: Record<number, boolean>,
  hiddenGroups: Record<number, boolean>,
  collapsedSubgraphs: Record<string, boolean> = {},
  hiddenSubgraphs: Record<string, boolean> = {}
): NestedItem[] {
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

  const nodeToSubgraph = new Map<number, string>();
  for (const node of orderedNodes) {
    const origin = getMobileOrigin(node);
    if (origin?.scope === 'subgraph' && origin.subgraphId) {
      nodeToSubgraph.set(node.id, origin.subgraphId);
    }
  }

  const nodesInSubgraph = new Map<string, WorkflowNode[]>();
  for (const sg of subgraphs) {
    nodesInSubgraph.set(sg.id, []);
  }
  for (const node of orderedNodes) {
    const subgraphId = nodeToSubgraph.get(node.id);
    if (subgraphId) {
      nodesInSubgraph.get(subgraphId)?.push(node);
    }
  }

  const topLevelNodes = orderedNodes.filter(
    (node) => !nodeToSubgraph.has(node.id)
  );
  const nodeToGroup = computeNodeGroupsFor(topLevelNodes, groups);
  const groupById = new Map(groups.map((g) => [g.id, g]));

  type NodeEntry = { kind: 'node'; node: WorkflowNode };
  type SubgraphEntry = { kind: 'subgraph'; subgraphId: string };
  type Entry = NodeEntry | SubgraphEntry;

  const entries: Entry[] = [];
  const subgraphEmitted = new Set<string>();
  for (const node of orderedNodes) {
    const subgraphId = nodeToSubgraph.get(node.id);
    if (subgraphId) {
      if (!subgraphEmitted.has(subgraphId)) {
        entries.push({ kind: 'subgraph', subgraphId });
        subgraphEmitted.add(subgraphId);
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
    if (hiddenSubgraphs[entry.subgraphId]) return 0;
    return nodesInSubgraph.get(entry.subgraphId)?.length ?? 0;
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

    const subgraphNodeToGroup = computeNodeGroupsFor(
      subgraphNodes,
      subgraphGroups
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
        if (group && !hiddenGroups[group.id]) {
          const nodeCount = groupEntries.reduce(
            (count, item) => count + countEntryNodes(item),
            0
          );
          const isCollapsed = collapsedGroups[group.id] ?? true;
          const childItems = isCollapsed
            ? []
            : groupEntries.map((item) =>
                buildNodeItem(item.node, group.id, subgraphId)
              );
          children.push({
            type: 'group',
            group,
            nodeCount,
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
      if (hiddenGroups[group.id]) continue;
      if (emittedSubgraphGroups.has(group.id)) continue;
      children.push({
        type: 'group',
        group,
        nodeCount: 0,
        isCollapsed: collapsedGroups[group.id] ?? true,
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
    if (hiddenSubgraphs[subgraphId]) return null;
    const subgraph = subgraphById.get(subgraphId);
    if (!subgraph) return null;
    const subgraphNodes = nodesInSubgraph.get(subgraphId) ?? [];
    const isCollapsed = collapsedSubgraphs[subgraphId] ?? true;
    const children = isCollapsed ? [] : buildSubgraphChildren(subgraphId);

    return {
      type: 'subgraph',
      subgraph,
      nodeCount: subgraphNodes.length,
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
    if (hiddenGroups[group.id]) return null;
    const nodeCount = entriesInGroup.reduce(
      (count, entry) => count + countEntryNodes(entry),
      0
    );
    const isCollapsed = collapsedGroups[group.id] ?? true;
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
 * Parses a hex color string and returns an rgba version with the specified alpha.
 * Supports both #RGB and #RRGGBB formats.
 */
export function hexToRgba(hex: string, alpha: number): string {
  // Remove # if present
  const cleanHex = hex.replace('#', '');

  let r: number, g: number, b: number;

  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
  } else if (cleanHex.length === 6) {
    r = parseInt(cleanHex.slice(0, 2), 16);
    g = parseInt(cleanHex.slice(2, 4), 16);
    b = parseInt(cleanHex.slice(4, 6), 16);
  } else {
    // Invalid hex, return transparent
    return 'rgba(0, 0, 0, 0)';
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Gets the list item key for rendering.
 */

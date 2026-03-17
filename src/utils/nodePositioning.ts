import type { Workflow, WorkflowGroup } from '@/api/types';

export function getPositionNearNode(
  workflow: Workflow,
  nearNodeId: number,
  xOffset = 250
): [number, number] | null {
  const node = workflow.nodes.find((item) => item.id === nearNodeId);
  if (!node) return null;
  return [node.pos[0] + xOffset, node.pos[1]];
}

/** @deprecated Use `getBottomPlacementForScope(workflow, { subgraphId: null })`. */
export function getBottomPlacement(workflow: Workflow): [number, number] {
  return getBottomPlacementForScope(workflow, { subgraphId: null });
}

export function getBottomPlacementForScope(
  workflow: Workflow,
  scope: { subgraphId: string | null }
): [number, number] {
  const scopedNodes =
    scope.subgraphId == null
      ? workflow.nodes
      : (workflow.definitions?.subgraphs?.find((entry) => entry.id === scope.subgraphId)?.nodes ?? []);

  if (scopedNodes.length > 0) {
    const maxBottom = Math.max(
      ...scopedNodes.map((node) => node.pos[1] + (node.size?.[1] ?? 100))
    );
    const minX = scope.subgraphId == null
      ? 0
      : Math.min(...scopedNodes.map((node) => node.pos[0]));
    return [minX, maxBottom + 80];
  }

  if (scope.subgraphId != null) {
    const scopedGroups = workflow.definitions?.subgraphs?.find(
      (entry) => entry.id === scope.subgraphId
    )?.groups ?? [];
    if (scopedGroups.length > 0) {
      const maxBottom = Math.max(
        ...scopedGroups.map((group) => group.bounding[1] + group.bounding[3])
      );
      const minX = Math.min(...scopedGroups.map((group) => group.bounding[0]));
      return [minX, maxBottom + 80];
    }
  }

  return [0, 0];
}

export function clampPositionToGroup(
  position: [number, number],
  group: WorkflowGroup,
  nodeSize: [number, number],
  padding = 24
): [number, number] {
  const [groupX, groupY, groupWidth, groupHeight] = group.bounding;
  const [nodeWidth, nodeHeight] = nodeSize;
  const minX = groupX + padding;
  const minY = groupY + 48;
  const maxX = Math.max(minX, groupX + groupWidth - nodeWidth - padding);
  const maxY = Math.max(minY, groupY + groupHeight - nodeHeight - padding);

  return [
    Math.min(Math.max(position[0], minX), maxX),
    Math.min(Math.max(position[1], minY), maxY)
  ];
}

export interface PositionedNode {
  id: number;
  pos: [number, number];
  size: [number, number];
}

export interface GroupPlacementNode {
  id: number;
  size: [number, number];
  pos?: [number, number];
}

function nodeIsInsideGroup(node: GroupPlacementNode, group: WorkflowGroup, padding = 24): boolean {
  const [x, y] = node.pos ?? [0, 0];
  const [w, h] = node.size;
  const [gx, gy, gw, gh] = group.bounding;
  const minX = gx + padding;
  const minY = gy + 48;
  const maxX = gx + gw - padding - w;
  const maxY = gy + gh - padding - h;
  return x >= minX && y >= minY && x <= maxX && y <= maxY;
}

export function assignPositionsInGroup(
  group: WorkflowGroup,
  nodes: GroupPlacementNode[],
  options?: { padding?: number; rowGap?: number; columnGap?: number }
): Map<number, [number, number]> {
  const padding = options?.padding ?? 24;
  const rowGap = options?.rowGap ?? 16;
  const columnGap = options?.columnGap ?? 16;
  const [groupX, groupY, groupWidth] = group.bounding;
  const left = groupX + padding;
  const right = groupX + groupWidth - padding;
  const top = groupY + 48;

  const result = new Map<number, [number, number]>();
  const fixed = nodes
    .filter((node) => node.pos && nodeIsInsideGroup(node, group, padding))
    .sort((a, b) => a.id - b.id);

  for (const node of fixed) {
    result.set(node.id, clampPositionToGroup(node.pos as [number, number], group, node.size, padding));
  }

  let cursorX = left;
  let cursorY = top;
  let rowHeight = 0;
  const movable = nodes.filter((node) => !result.has(node.id)).sort((a, b) => a.id - b.id);

  for (const node of movable) {
    const width = Math.max(32, node.size[0]);
    const height = Math.max(32, node.size[1]);
    const availableWidth = Math.max(1, right - left);
    const effectiveWidth = Math.min(width, availableWidth);
    if (cursorX > left && cursorX + effectiveWidth > right) {
      cursorX = left;
      cursorY += rowHeight + rowGap;
      rowHeight = 0;
    }
    const clamped = clampPositionToGroup([cursorX, cursorY], group, [width, height], padding);
    result.set(node.id, clamped);
    cursorX += effectiveWidth + columnGap;
    rowHeight = Math.max(rowHeight, height);
  }

  return result;
}

export function expandGroupToFitNodes(
  group: WorkflowGroup,
  nodes: PositionedNode[],
  options?: { padding?: number; minWidth?: number; minHeight?: number }
): WorkflowGroup {
  if (nodes.length === 0) return group;
  const padding = options?.padding ?? 24;
  const minWidth = options?.minWidth ?? 160;
  const minHeight = options?.minHeight ?? 120;
  const [groupX, groupY, groupWidth, groupHeight] = group.bounding;

  let minNodeX = Number.POSITIVE_INFINITY;
  let minNodeY = Number.POSITIVE_INFINITY;
  let maxNodeRight = Number.NEGATIVE_INFINITY;
  let maxNodeBottom = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    minNodeX = Math.min(minNodeX, node.pos[0]);
    minNodeY = Math.min(minNodeY, node.pos[1]);
    maxNodeRight = Math.max(maxNodeRight, node.pos[0] + node.size[0]);
    maxNodeBottom = Math.max(maxNodeBottom, node.pos[1] + node.size[1]);
  }

  const requiredLeft = minNodeX - padding;
  const requiredTop = minNodeY - 48;
  const requiredRight = maxNodeRight + padding;
  const requiredBottom = maxNodeBottom + padding;

  const nextX = Math.min(groupX, requiredLeft);
  const nextY = Math.min(groupY, requiredTop);
  const nextRight = Math.max(groupX + groupWidth, requiredRight);
  const nextBottom = Math.max(groupY + groupHeight, requiredBottom);
  const nextWidth = Math.max(minWidth, nextRight - nextX);
  const nextHeight = Math.max(minHeight, nextBottom - nextY);
  const nextBounding: [number, number, number, number] = [
    nextX,
    nextY,
    nextWidth,
    nextHeight
  ];

  const unchanged = group.bounding.every((value, index) => value === nextBounding[index]);
  if (unchanged) return group;
  return {
    ...group,
    bounding: nextBounding
  };
}

export function positionBelowAll(
  workflow: Workflow,
  scope: { subgraphId: string | null },
  indexOffset = 0,
  overrides?: {
    scopeNodes?: Array<{ pos: [number, number]; size?: [number, number] }>;
    scopeGroups?: Array<{ bounding: [number, number, number, number] }>;
  }
): [number, number] {
  const scopedNodes = overrides?.scopeNodes ??
    (scope.subgraphId == null
      ? workflow.nodes
      : workflow.definitions?.subgraphs?.find(
          (subgraph) => subgraph.id === scope.subgraphId
        )?.nodes ?? []);
  const scopeGroups = overrides?.scopeGroups ??
    (scope.subgraphId == null
      ? workflow.groups ?? []
      : workflow.definitions?.subgraphs?.find((subgraph) => subgraph.id === scope.subgraphId)?.groups ?? []);
  const maxGroupRight =
    scopeGroups.length > 0
      ? Math.max(...scopeGroups.map((group) => group.bounding[0] + group.bounding[2]))
      : 0;
  const xBase = scopeGroups.length > 0 ? maxGroupRight + 80 : 0;
  const x = xBase + indexOffset * 24;
  if (scopedNodes.length === 0) return [x, indexOffset * 24];
  const maxBottom = Math.max(
    ...scopedNodes.map((node) => node.pos[1] + (node.size?.[1] ?? 100))
  );
  return [x, maxBottom + 80 + indexOffset * 24];
}

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

export function getBottomPlacement(workflow: Workflow): [number, number] {
  if (workflow.nodes.length === 0) return [0, 0];
  const maxBottom = Math.max(
    ...workflow.nodes.map((node) => node.pos[1] + (node.size?.[1] ?? 100))
  );
  return [0, maxBottom + 80];
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

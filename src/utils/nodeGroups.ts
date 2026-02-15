import type { WorkflowGroup, WorkflowNode } from "@/api/types";

type GroupLike = Pick<WorkflowGroup, "id" | "bounding">;

export function computeNodeGroupsFor(
  nodes: WorkflowNode[],
  groups: GroupLike[] | null | undefined,
): Map<number, number> {
  const nodeToGroup = new Map<number, number>();
  if (!groups || groups.length === 0) return nodeToGroup;

  // Prefer the deepest (smallest-area) containing group so nested groups
  // resolve to the innermost container rather than whichever ID is first.
  const sortedGroups = [...groups].sort((a, b) => {
    const areaA = a.bounding[2] * a.bounding[3];
    const areaB = b.bounding[2] * b.bounding[3];
    if (areaA !== areaB) return areaA - areaB;
    return a.id - b.id;
  });
  for (const node of nodes) {
    const [nodeX, nodeY] = node.pos;
    const [nodeWidth, nodeHeight] = node.size;
    const centerX = nodeX + nodeWidth / 2;
    const centerY = nodeY + nodeHeight / 2;

    for (const group of sortedGroups) {
      const [groupX, groupY, groupWidth, groupHeight] = group.bounding;
      if (
        centerX >= groupX &&
        centerX <= groupX + groupWidth &&
        centerY >= groupY &&
        centerY <= groupY + groupHeight
      ) {
        nodeToGroup.set(node.id, group.id);
        break;
      }
    }
  }
  return nodeToGroup;
}

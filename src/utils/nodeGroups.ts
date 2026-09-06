import type { WorkflowGroup, WorkflowNode } from "@/api/types";

type GroupLike = Pick<WorkflowGroup, "id" | "bounding">;

// LiteGraph.NODE_TITLE_HEIGHT — used when computing node bounding boxes.
const NODE_TITLE_HEIGHT = 30;

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
    const isCollapsed = !!(node.flags as Record<string, unknown>)?.collapsed;

    // Match LiteGraph's node bounding calculation (LGraphNode.measure):
    // Non-collapsed: [x, y - titleHeight, width, height + titleHeight]
    // Collapsed:     [x, y - titleHeight, collapsedWidth, titleHeight]
    const boundingH = isCollapsed ? NODE_TITLE_HEIGHT : nodeHeight + NODE_TITLE_HEIGHT;
    const boundingY = nodeY - NODE_TITLE_HEIGHT;
    const centerX = nodeX + nodeWidth / 2;
    const centerY = boundingY + boundingH / 2;

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

/**
 * Resolve each group's immediate geometric parent in one graph scope.
 *
 * Prefer the smallest larger group that fully contains the child. The center
 * fallback matches ComfyUI's permissive group membership behavior for legacy
 * workflows whose child rectangle protrudes slightly outside its parent.
 */
export function computeGroupParentsFor(
  groups: GroupLike[] | null | undefined,
): Map<number, number | null> {
  const parentMap = new Map<number, number | null>();
  if (!groups) return parentMap;

  for (const child of groups) {
    const [cx, cy, cw, ch] = child.bounding;
    const centerX = cx + cw / 2;
    const centerY = cy + ch / 2;
    const childArea = cw * ch;
    let parentId: number | null = null;
    let parentArea = Number.POSITIVE_INFINITY;

    for (const candidate of groups) {
      if (candidate.id === child.id) continue;
      const [px, py, pw, ph] = candidate.bounding;
      const candidateArea = pw * ph;
      if (candidateArea <= childArea) continue;
      const fullyContainsChild =
        cx >= px
        && cy >= py
        && cx + cw <= px + pw
        && cy + ch <= py + ph;
      const containsChildCenter =
        centerX >= px
        && centerX <= px + pw
        && centerY >= py
        && centerY <= py + ph;
      if ((!fullyContainsChild && !containsChildCenter) || candidateArea >= parentArea) {
        continue;
      }
      parentArea = candidateArea;
      parentId = candidate.id;
    }

    parentMap.set(child.id, parentId);
  }

  return parentMap;
}

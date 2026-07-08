import type { NodeTypes, Workflow, WorkflowGroup, WorkflowNode } from "@/api/types";
import type { ItemRef, MobileLayout } from "@/utils/mobileLayout";
import { getInputWidgetDefinitions, getWidgetDefinitions } from "@/utils/widgetDefinitions";

// Deterministic "tidy" geometry pass: recompute every node position and group
// bounding from the MOBILE LAYOUT ORDERING so the desktop canvas mirrors the
// mobile list, with no overlaps. It's a single O(n) walk of the layout tree, run
// once per reposition commit (not per frame), so it's cheap on edge devices.
//
// Rules:
//  - Each scope (root + every subgraph definition) is an independent space.
//  - Top level of a scope: items progress LEFT -> RIGHT, top edges aligned.
//  - Inside a group, items STACK VERTICALLY in columns, where:
//      * a nested group is its own column (siblings after it start a new column);
//      * a preview/save/compare node is its own column (never under another node);
//      * all widgetless nodes collect into ONE column placed where the first
//        widgetless node appears, and are folded (collapsed);
//      * other ("regular") nodes stack in the current column.
//  - All preview/save/compare nodes are normalized to the largest such node's
//    size across the whole graph.
//  - Nothing overlaps; each group box encloses exactly its members so the
//    geometric membership pass round-trips this layout.

const COL_GAP = 80; // horizontal gap between columns / top-level items
const ROW_GAP = 12; // vertical gap between stacked node blocks in a column
const GROUP_PAD_BOTTOM = 16; // group interior bottom padding (no left/right padding)
const GROUP_TITLE = 40; // group interior headroom for its title bar
const NODE_TITLE = 30; // LiteGraph node title height (drawn above node.pos.y)
const MIN_GROUP_W = 200;
const MIN_GROUP_H = 120;
const DEFAULT_W = 200;
const DEFAULT_H = 100;

interface Block {
  width: number;
  height: number;
}

interface ScopeResult {
  nodePos: Map<number, [number, number]>;
  groupBounds: Map<number, [number, number, number, number]>;
  foldedNodeIds: Set<number>;
}

type NodeRole = "preview" | "widgetless" | "regular";

function nodeSize(node: WorkflowNode): [number, number] {
  const w = Array.isArray(node.size) ? node.size[0] : undefined;
  const h = Array.isArray(node.size) ? node.size[1] : undefined;
  return [
    typeof w === "number" && w > 0 ? w : DEFAULT_W,
    typeof h === "number" && h > 0 ? h : DEFAULT_H,
  ];
}

// Preview / save / compare display nodes — matched by type name so it covers
// SaveImage, PreviewImage, Save*/Preview* video/audio, and "Image Comparer".
export function isPreviewSaveCompareNode(node: WorkflowNode): boolean {
  const type = node.type.toLowerCase();
  return type.includes("preview") || type.includes("save") || type.includes("compar");
}

function nodeHasWidgets(node: WorkflowNode, nodeTypes: NodeTypes | null): boolean {
  // Without node definitions we can't tell — assume it has widgets so we don't
  // fold something that shouldn't be.
  if (!nodeTypes) return true;
  return (
    getWidgetDefinitions(nodeTypes, node).length > 0 ||
    getInputWidgetDefinitions(nodeTypes, node).length > 0
  );
}

// Largest size across all preview/save/compare nodes in the whole graph, so they
// can all be normalized to it. Null when there are none.
function computePreviewSize(workflow: Workflow): [number, number] | null {
  let width = 0;
  let height = 0;
  let found = false;
  const scan = (nodes: WorkflowNode[]) => {
    for (const node of nodes) {
      if (!isPreviewSaveCompareNode(node)) continue;
      const [w, h] = nodeSize(node);
      width = Math.max(width, w);
      height = Math.max(height, h);
      found = true;
    }
  };
  scan(workflow.nodes ?? []);
  for (const sg of workflow.definitions?.subgraphs ?? []) scan(sg.nodes ?? []);
  return found ? [width, height] : null;
}

interface NodeEntry {
  node: WorkflowNode;
  role: NodeRole;
}
type Column = { kind: "nodes"; entries: NodeEntry[] } | { kind: "group"; ref: Extract<ItemRef, { type: "group" }> };

function layoutScope(
  scopeNodes: WorkflowNode[],
  scopeGroups: WorkflowGroup[],
  orderedRefs: ItemRef[],
  layout: MobileLayout,
  nodeTypes: NodeTypes | null,
  previewSize: [number, number] | null,
): ScopeResult {
  const nodeById = new Map(scopeNodes.map((n) => [n.id, n]));
  const groupById = new Map(scopeGroups.map((g) => [g.id, g]));
  const out: ScopeResult = {
    nodePos: new Map(),
    groupBounds: new Map(),
    foldedNodeIds: new Set(),
  };

  // Anchor at the scope's current top-left so it doesn't jump to the origin.
  let originX = Infinity;
  let originY = Infinity;
  for (const node of scopeNodes) {
    originX = Math.min(originX, node.pos[0]);
    originY = Math.min(originY, node.pos[1] - NODE_TITLE);
  }
  for (const group of scopeGroups) {
    originX = Math.min(originX, group.bounding[0]);
    originY = Math.min(originY, group.bounding[1]);
  }
  if (!Number.isFinite(originX)) originX = 0;
  if (!Number.isFinite(originY)) originY = 0;

  const nodesForRef = (ref: ItemRef): WorkflowNode[] => {
    if (ref.type === "node") {
      const n = nodeById.get(ref.id);
      return n ? [n] : [];
    }
    if (ref.type === "subgraph") {
      const n = ref.nodeId != null ? nodeById.get(ref.nodeId) : undefined;
      return n ? [n] : [];
    }
    if (ref.type === "hiddenBlock") {
      return (layout.hiddenBlocks[ref.blockId] ?? [])
        .map((id) => nodeById.get(id))
        .filter((n): n is WorkflowNode => Boolean(n));
    }
    return [];
  };

  const classify = (node: WorkflowNode): NodeRole => {
    if (isPreviewSaveCompareNode(node)) return "preview";
    if (!nodeHasWidgets(node, nodeTypes)) return "widgetless";
    return "regular";
  };

  // Body (below-title) size of a node block given its role inside a group.
  const entryBodySize = (entry: NodeEntry): [number, number] => {
    if (entry.role === "preview" && previewSize) return previewSize;
    if (entry.role === "widgetless") return [nodeSize(entry.node)[0], 0]; // folded: title only
    return nodeSize(entry.node);
  };

  // Place a node block with its title-top at (left, top); body of `bodyHeight`.
  const placeNode = (node: WorkflowNode, left: number, top: number, width: number, bodyHeight: number): Block => {
    out.nodePos.set(node.id, [Math.round(left), Math.round(top + NODE_TITLE)]);
    return { width, height: NODE_TITLE + bodyHeight };
  };

  const placeEntryColumn = (entries: NodeEntry[], columnX: number, top: number): Block => {
    let y = top;
    let width = 0;
    for (const entry of entries) {
      const [w, bodyH] = entryBodySize(entry);
      const block = placeNode(entry.node, columnX, y, w, bodyH);
      if (entry.role === "widgetless") out.foldedNodeIds.add(entry.node.id);
      width = Math.max(width, block.width);
      y += block.height + ROW_GAP;
    }
    const height = entries.length > 0 ? y - top - ROW_GAP : 0;
    return { width, height };
  };

  // Build a group's ordered columns per the rules.
  const buildGroupColumns = (refs: ItemRef[]): Column[] => {
    const columns: Column[] = [];
    let openRegular: Extract<Column, { kind: "nodes" }> | null = null;
    let widgetlessColumn: Extract<Column, { kind: "nodes" }> | null = null;

    for (const ref of refs) {
      if (ref.type === "group") {
        openRegular = null;
        columns.push({ kind: "group", ref });
        continue;
      }
      for (const node of nodesForRef(ref)) {
        const role = classify(node);
        if (role === "preview") {
          // Own column — never under another node.
          openRegular = null;
          columns.push({ kind: "nodes", entries: [{ node, role }] });
        } else if (role === "widgetless") {
          // All widgetless nodes share one column, created where the first one
          // appears; does not break the current regular run.
          if (!widgetlessColumn) {
            widgetlessColumn = { kind: "nodes", entries: [] };
            columns.push(widgetlessColumn);
          }
          widgetlessColumn.entries.push({ node, role });
        } else {
          if (!openRegular) {
            openRegular = { kind: "nodes", entries: [] };
            columns.push(openRegular);
          }
          openRegular.entries.push({ node, role });
        }
      }
    }
    return columns;
  };

  // Lay out a group's content columns left->right; returns the content footprint.
  const layoutGroupContents = (refs: ItemRef[], originXInner: number, originYInner: number): Block => {
    const columns = buildGroupColumns(refs);
    let columnX = originXInner;
    let maxHeight = 0;
    for (const column of columns) {
      const block =
        column.kind === "group"
          ? placeGroup(column.ref, columnX, originYInner)
          : placeEntryColumn(column.entries, columnX, originYInner);
      if (block.width === 0) continue;
      columnX += block.width + COL_GAP;
      maxHeight = Math.max(maxHeight, block.height);
    }
    const width = columnX > originXInner ? columnX - originXInner - COL_GAP : 0;
    return { width: Math.max(0, width), height: maxHeight };
  };

  // Place a group box at (left, top). No left/right interior padding.
  function placeGroup(ref: Extract<ItemRef, { type: "group" }>, left: number, top: number): Block {
    const childRefs = layout.groups[ref.itemKey] ?? [];
    const content = layoutGroupContents(childRefs, left, top + GROUP_TITLE);
    const width = Math.max(content.width, MIN_GROUP_W);
    const height = Math.max(GROUP_TITLE + content.height + GROUP_PAD_BOTTOM, MIN_GROUP_H);
    const group = groupById.get(ref.id);
    if (group) {
      out.groupBounds.set(group.id, [
        Math.round(left),
        Math.round(top),
        Math.round(width),
        Math.round(height),
      ]);
    }
    return { width, height };
  }

  // Top level of the scope: left -> right, top-aligned. Folding/widgetless
  // columns are a group-only concern, so a node-bearing ref here is just placed
  // (preview nodes still get the normalized size).
  let x = originX;
  for (const ref of orderedRefs) {
    let block: Block;
    if (ref.type === "group") {
      block = placeGroup(ref, x, originY);
    } else {
      const entries: NodeEntry[] = nodesForRef(ref).map((node) => ({
        node,
        role: isPreviewSaveCompareNode(node) ? "preview" : "regular",
      }));
      block = placeEntryColumn(entries, x, originY);
      if (block.width === 0) continue;
    }
    x += block.width + COL_GAP;
  }

  return out;
}

/**
 * Recompute geometry for the whole workflow from the mobile layout ordering.
 * Returns a new workflow with updated node `pos`/`size`/`flags.collapsed` and
 * group `bounding`; the layout structure itself is untouched.
 */
export function computeTidyWorkflowGeometry(
  workflow: Workflow,
  layout: MobileLayout,
  nodeTypes: NodeTypes | null = null,
): Workflow {
  const previewSize = computePreviewSize(workflow);

  const rootResult = layoutScope(
    workflow.nodes ?? [],
    workflow.groups ?? [],
    layout.root,
    layout,
    nodeTypes,
    previewSize,
  );

  const subgraphResults = new Map<string, ScopeResult>();
  for (const sg of workflow.definitions?.subgraphs ?? []) {
    subgraphResults.set(
      sg.id,
      layoutScope(sg.nodes ?? [], sg.groups ?? [], layout.subgraphs[sg.id] ?? [], layout, nodeTypes, previewSize),
    );
  }

  const applyNodes = (nodes: WorkflowNode[], result: ScopeResult): WorkflowNode[] =>
    nodes.map((node) => {
      const pos = result.nodePos.get(node.id);
      const isPreview = previewSize != null && isPreviewSaveCompareNode(node);
      const fold = result.foldedNodeIds.has(node.id);
      if (!pos && !isPreview && !fold) return node;
      const next: WorkflowNode = { ...node };
      if (pos) next.pos = pos;
      if (isPreview && previewSize) next.size = [previewSize[0], previewSize[1]];
      if (fold) next.flags = { ...node.flags, collapsed: true };
      return next;
    });
  const applyGroups = (groups: WorkflowGroup[], result: ScopeResult): WorkflowGroup[] =>
    groups.map((group) => {
      const bounding = result.groupBounds.get(group.id);
      return bounding ? { ...group, bounding } : group;
    });

  const nextNodes = applyNodes(workflow.nodes ?? [], rootResult);
  const nextGroups = applyGroups(workflow.groups ?? [], rootResult);
  const defs = workflow.definitions?.subgraphs ?? [];
  const nextSubgraphs = defs.map((sg) => {
    const result = subgraphResults.get(sg.id);
    if (!result) return sg;
    return {
      ...sg,
      nodes: applyNodes(sg.nodes ?? [], result),
      groups: applyGroups(sg.groups ?? [], result),
    };
  });

  return {
    ...workflow,
    nodes: nextNodes,
    groups: nextGroups,
    definitions: workflow.definitions
      ? { ...workflow.definitions, subgraphs: nextSubgraphs }
      : workflow.definitions,
  };
}

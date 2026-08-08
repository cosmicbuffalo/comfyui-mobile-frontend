import type { NodeTypes, Workflow, WorkflowGroup, WorkflowNode } from "@/api/types";
import { findSeedWidgetIndex } from "@/utils/seedUtils";

// Classify the change between two workflow states for the undo system:
//  - meaningful: anything changed other than seed widget values (seed-only
//    changes are excluded from undo history).
//  - structural: a non-widget change (node/group/link/subgraph add/remove, or a
//    node's geometry/title/wiring) — used to decide coalescing (rapid widget
//    edits coalesce into one step; structural ops never do).
//  - changedNodeIds: nodes that meaningfully changed, for scroll-to-on-undo.
export interface WorkflowChangeDiff {
  meaningful: boolean;
  structural: boolean;
  changedNodeIds: number[];
}

const EMPTY: WorkflowChangeDiff = { meaningful: false, structural: false, changedNodeIds: [] };

// All nodes across scopes, keyed by SCOPE + id. Node ids are only unique within
// a scope: a workflow saved by the desktop frontend numbers each subgraph
// definition's inner nodes independently, so two definitions both holding node 1
// is normal and this app never renumbers them. Keying by id alone let one scope's
// node shadow another's, and an edit to the shadowed node compared equal — so no
// undo snapshot was recorded and a later Undo silently reverted two edits.
function scopedNodeKey(subgraphId: string | null, nodeId: number): string {
  return `${subgraphId ?? 'root'}:${nodeId}`;
}

function collectNodes(workflow: Workflow): Map<string, WorkflowNode> {
  const map = new Map<string, WorkflowNode>();
  for (const node of workflow.nodes ?? []) map.set(scopedNodeKey(null, node.id), node);
  for (const sg of workflow.definitions?.subgraphs ?? []) {
    for (const node of sg.nodes ?? []) map.set(scopedNodeKey(sg.id, node.id), node);
  }
  return map;
}

function widgetsDifferIgnoringSeed(a: unknown, b: unknown, seedIndex: number): boolean {
  if (a === b) return false;
  const av = Array.isArray(a) ? a : null;
  const bv = Array.isArray(b) ? b : null;
  if (!av || !bv) return JSON.stringify(a) !== JSON.stringify(b);
  if (av.length !== bv.length) return true;
  for (let i = 0; i < av.length; i += 1) {
    if (i === seedIndex) continue;
    if (av[i] !== bv[i] && JSON.stringify(av[i]) !== JSON.stringify(bv[i])) return true;
  }
  return false;
}

// Does a node differ in any NON-widget field (geometry, title, wiring, flags)?
function nodeNonWidgetDiffers(a: WorkflowNode, b: WorkflowNode): boolean {
  if (a.type !== b.type || a.mode !== b.mode) return true;
  if ((a.title ?? null) !== (b.title ?? null)) return true;
  if ((a.color ?? null) !== (b.color ?? null)) return true;
  if (a.pos?.[0] !== b.pos?.[0] || a.pos?.[1] !== b.pos?.[1]) return true;
  if (a.size?.[0] !== b.size?.[0] || a.size?.[1] !== b.size?.[1]) return true;
  if (JSON.stringify(a.flags ?? {}) !== JSON.stringify(b.flags ?? {})) return true;
  if (JSON.stringify(a.inputs ?? []) !== JSON.stringify(b.inputs ?? [])) return true;
  if (JSON.stringify(a.outputs ?? []) !== JSON.stringify(b.outputs ?? [])) return true;
  // properties is where node config that isn't a widget lives — the Fast Groups
  // Bypasser's matchColors/matchTitle/sort, the stashed filename prefix, S&R
  // names. Ignoring it classified those edits as not-meaningful, which skipped
  // the undo snapshot AND left the redo stack intact, so a later Redo silently
  // discarded the configuration.
  if (JSON.stringify(a.properties ?? {}) !== JSON.stringify(b.properties ?? {})) return true;
  return false;
}

// Group lists differ ignoring object identity (annotate rewrites the array but
// keeps element refs for unchanged groups).
function groupsDiffer(a: WorkflowGroup[] | undefined, b: WorkflowGroup[] | undefined): boolean {
  const ag = a ?? [];
  const bg = b ?? [];
  if (ag === bg) return false;
  if (ag.length !== bg.length) return true;
  for (let i = 0; i < ag.length; i += 1) {
    if (ag[i] === bg[i]) continue;
    const x = ag[i];
    const y = bg[i];
    if (
      x.id !== y.id ||
      (x.title ?? "") !== (y.title ?? "") ||
      (x.color ?? "") !== (y.color ?? "") ||
      JSON.stringify(x.bounding) !== JSON.stringify(y.bounding)
    ) {
      return true;
    }
  }
  return false;
}

function linksDiffer(a: Workflow["links"] | undefined, b: Workflow["links"] | undefined): boolean {
  const al = a ?? [];
  const bl = b ?? [];
  if (al === bl) return false;
  if (al.length !== bl.length) return true;
  for (let i = 0; i < al.length; i += 1) {
    if (al[i] === bl[i]) continue;
    if (JSON.stringify(al[i]) !== JSON.stringify(bl[i])) return true;
  }
  return false;
}

export function diffWorkflowChange(
  prev: Workflow | null,
  next: Workflow | null,
  nodeTypes: NodeTypes | null,
): WorkflowChangeDiff {
  if (prev === next || !prev || !next) return EMPTY;

  const prevNodes = collectNodes(prev);
  const nextNodes = collectNodes(next);
  const changedNodeIds: number[] = [];
  let structural = false;

  // Keys are scope-qualified; the reported ids stay numeric for the consumers
  // that scroll to a node by id.
  for (const [key, b] of nextNodes) {
    const a = prevNodes.get(key);
    if (!a) {
      changedNodeIds.push(b.id);
      structural = true;
      continue;
    }
    if (a === b) continue;
    const nonWidget = nodeNonWidgetDiffers(a, b);
    if (nonWidget) {
      changedNodeIds.push(b.id);
      structural = true;
      continue;
    }
    const seedIndex = findSeedWidgetIndex(next, nodeTypes, b) ?? -1;
    if (widgetsDifferIgnoringSeed(a.widgets_values, b.widgets_values, seedIndex)) {
      changedNodeIds.push(b.id);
    }
    // else: only seed widget values changed for this node — ignored.
  }
  for (const key of prevNodes.keys()) {
    if (!nextNodes.has(key)) structural = true; // removed node
  }

  if (!structural) {
    if (groupsDiffer(prev.groups, next.groups)) structural = true;
    else if (linksDiffer(prev.links, next.links)) structural = true;
    else {
      const prevDefs = prev.definitions?.subgraphs ?? [];
      const nextDefs = next.definitions?.subgraphs ?? [];
      if (prevDefs.length !== nextDefs.length) structural = true;
      else {
        for (let i = 0; i < nextDefs.length; i += 1) {
          if (
            groupsDiffer(prevDefs[i]?.groups, nextDefs[i]?.groups) ||
            linksDiffer(
              prevDefs[i]?.links as unknown as Workflow["links"],
              nextDefs[i]?.links as unknown as Workflow["links"],
            )
          ) {
            structural = true;
            break;
          }
        }
      }
    }
  }

  const meaningful = structural || changedNodeIds.length > 0;
  return { meaningful, structural, changedNodeIds };
}

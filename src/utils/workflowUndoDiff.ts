import type { NodeTypes, Workflow, WorkflowGroup, WorkflowNode } from "@/api/types";
import { findSeedWidgetIndex } from "@/utils/seedUtils";

// Classify the change between two workflow states for the undo system:
//  - meaningful: anything changed other than seed widget values (seed-only
//    changes are excluded from undo history).
//  - structural: a non-widget change (node/group/link/subgraph add/remove, or a
//    node's geometry/title/wiring) — used to decide coalescing (rapid widget
//    edits coalesce into one step; structural ops never do).
//  - changedNodeIds: ids of the nodes that meaningfully changed (used to decide
//    whether a burst of edits is all one node's, and so coalescible).
//  - changedTargets: what the edit touched, scope-qualified, in the order to
//    try revealing it — an undo scrolls to the first one it can still find.
export interface WorkflowChangeDiff {
  meaningful: boolean;
  structural: boolean;
  changedNodeIds: number[];
  changedTargets: WorkflowChangeTarget[];
}

/**
 * Something an edit changed, named so it can be found again in another copy of
 * the workflow — which is the whole job on undo, where the state to reveal it
 * in is the restored snapshot rather than the one the diff ran on.
 *
 * Scope-qualified because node and group ids are only unique within a scope
 * (see `scopedNodeKey`): an id alone can name a node in a subgraph the user is
 * not standing in, and reveal the wrong one.
 */
export type WorkflowChangeTarget =
  | {
      kind: "node";
      subgraphId: string | null;
      nodeId: number;
      change: WorkflowChangeKind;
      /**
       * The one widget row this edit changed, when it changed exactly one and
       * nothing else about the node. Lets an undo be revealed at the row.
       */
      widgetIndex?: number;
      /**
       * The widget that occupied that index when the step was recorded.
       *
       * `widgets_values` is positional, and a boundary-slot reorder moves the
       * values with the slots — so an index recorded before a reorder names a
       * different widget after one. Stamped when the step is recorded (see
       * `nameWidgetTargets`) and checked at reveal time, so a stale position
       * falls back to the node instead of lighting up the wrong row.
       */
      widgetName?: string;
    }
  | { kind: "group"; subgraphId: string | null; groupId: number; change: WorkflowChangeKind }
  /** A subgraph definition's own shape changed: boundary slots, name, labels. */
  | { kind: "subgraphDef"; subgraphId: string; change: WorkflowChangeKind };

/**
 * Whether the edit was ABOUT this item or merely reached it.
 *
 * Deleting two nodes also rewrites the link arrays of whatever they were wired
 * to, so a neighbour is "edited" by a delete it had no part in. Ranking the
 * added and removed items first is what keeps the toast naming — and the panel
 * scrolling to — what the user actually did, rather than the first bystander.
 */
export type WorkflowChangeKind = "added" | "removed" | "edited";

const EMPTY: WorkflowChangeDiff = {
  meaningful: false,
  structural: false,
  changedNodeIds: [],
  changedTargets: [],
};

// All nodes across scopes, keyed by SCOPE + id. Node ids are only unique within
// a scope: a workflow saved by the desktop frontend numbers each subgraph
// definition's inner nodes independently, so two definitions both holding node 1
// is normal and this app never renumbers them. Keying by id alone let one scope's
// node shadow another's, and an edit to the shadowed node compared equal — so no
// undo snapshot was recorded and a later Undo silently reverted two edits.
function scopedNodeKey(subgraphId: string | null, nodeId: number): string {
  return `${subgraphId ?? 'root'}:${nodeId}`;
}

/** The scope half of a `scopedNodeKey` — null for root. */
function scopeIdFromNodeKey(key: string): string | null {
  const scope = key.slice(0, key.lastIndexOf(":"));
  return scope === "root" ? null : scope;
}

function collectNodes(workflow: Workflow): Map<string, WorkflowNode> {
  const map = new Map<string, WorkflowNode>();
  for (const node of workflow.nodes ?? []) map.set(scopedNodeKey(null, node.id), node);
  for (const sg of workflow.definitions?.subgraphs ?? []) {
    for (const node of sg.nodes ?? []) map.set(scopedNodeKey(sg.id, node.id), node);
  }
  return map;
}

/**
 * Which widget values differ, ignoring the seed.
 *
 * `indices` is the whole point of reporting more than a boolean: an undo of a
 * single widget edit can be revealed at the row that changed rather than at the
 * card, and only when exactly one row changed is that unambiguous. `differs`
 * covers the shapes with no index to report — a record-form `widgets_values`,
 * or a length change — where the answer is still yes, just not locatable.
 */
function widgetsDifferIgnoringSeed(
  a: unknown,
  b: unknown,
  seedIndex: number,
): { differs: boolean; indices: number[] } {
  if (a === b) return { differs: false, indices: [] };
  const av = Array.isArray(a) ? a : null;
  const bv = Array.isArray(b) ? b : null;
  if (!av || !bv) {
    return { differs: JSON.stringify(a) !== JSON.stringify(b), indices: [] };
  }
  if (av.length !== bv.length) return { differs: true, indices: [] };
  const indices: number[] = [];
  for (let i = 0; i < av.length; i += 1) {
    if (i === seedIndex) continue;
    if (av[i] !== bv[i] && JSON.stringify(av[i]) !== JSON.stringify(bv[i])) indices.push(i);
  }
  return { differs: indices.length > 0, indices };
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

// Which groups changed, ignoring object identity (annotate rewrites the array
// but keeps element refs for unchanged groups). A length change is reported as
// the ids on the longer side that the shorter one does not have, so an added or
// deleted group is something an undo can scroll to.
function changedGroupIds(
  a: WorkflowGroup[] | undefined,
  b: WorkflowGroup[] | undefined,
): Array<{ id: number; change: WorkflowChangeKind }> {
  const ag = a ?? [];
  const bg = b ?? [];
  if (ag === bg) return [];
  const changed: Array<{ id: number; change: WorkflowChangeKind }> = [];
  if (ag.length !== bg.length) {
    const before = new Set(ag.map((group) => group.id));
    const after = new Set(bg.map((group) => group.id));
    for (const id of after) if (!before.has(id)) changed.push({ id, change: "added" });
    for (const id of before) if (!after.has(id)) changed.push({ id, change: "removed" });
    // Same count either way (a swap): the whole list is the change.
    if (changed.length === 0) {
      return bg.map((group) => ({ id: group.id, change: "edited" as const }));
    }
    return changed;
  }
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
      changed.push({ id: y.id, change: "edited" });
    }
  }
  return changed;
}

// Definition-level metadata: identity, display name, boundary slot tables
// (incl. labels and linkIds), and extra (promotion flag, proxy labels). Inner
// nodes/groups/links are compared separately.
function subgraphMetaDiffers(
  a: NonNullable<NonNullable<Workflow["definitions"]>["subgraphs"]>[number] | undefined,
  b: NonNullable<NonNullable<Workflow["definitions"]>["subgraphs"]>[number] | undefined,
): boolean {
  if (a === b) return false;
  if (!a || !b) return true;
  if (a.id !== b.id || (a.name ?? null) !== (b.name ?? null)) return true;
  if (JSON.stringify(a.inputs ?? []) !== JSON.stringify(b.inputs ?? [])) return true;
  if (JSON.stringify(a.outputs ?? []) !== JSON.stringify(b.outputs ?? [])) return true;
  if (JSON.stringify(a.extra ?? {}) !== JSON.stringify(b.extra ?? {})) return true;
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
  const changedTargets: WorkflowChangeTarget[] = [];
  let structural = false;

  const noteNode = (
    subgraphId: string | null,
    node: WorkflowNode,
    change: WorkflowChangeKind,
    widgetIndex?: number,
  ) => {
    changedNodeIds.push(node.id);
    changedTargets.push({ kind: "node", subgraphId, nodeId: node.id, change, widgetIndex });
  };

  // Keys are scope-qualified; the reported ids stay numeric for the consumers
  // that scroll to a node by id.
  for (const [key, b] of nextNodes) {
    const a = prevNodes.get(key);
    const subgraphId = scopeIdFromNodeKey(key);
    if (!a) {
      noteNode(subgraphId, b, "added");
      structural = true;
      continue;
    }
    if (a === b) continue;
    const nonWidget = nodeNonWidgetDiffers(a, b);
    if (nonWidget) {
      noteNode(subgraphId, b, "edited");
      structural = true;
      continue;
    }
    const seedIndex = findSeedWidgetIndex(next, nodeTypes, b) ?? -1;
    const widgets = widgetsDifferIgnoringSeed(a.widgets_values, b.widgets_values, seedIndex);
    if (widgets.differs) {
      // One row changed and nothing else did, so the row is what the edit was:
      // a multi-widget write (a paste, a Power Puter's output list) has no
      // single row to point at and stays a node-level change.
      noteNode(subgraphId, b, "edited", widgets.indices.length === 1 ? widgets.indices[0] : undefined);
    }
    // else: only seed widget values changed for this node — ignored.
  }
  for (const [key, a] of prevNodes) {
    if (nextNodes.has(key)) continue;
    structural = true; // removed node
    // Recorded even though it is gone from `next`: the snapshot an undo
    // restores is the state it still existed in, and putting the user back in
    // front of the node they just deleted is the point of the reveal.
    changedTargets.push({
      kind: "node",
      subgraphId: scopeIdFromNodeKey(key),
      nodeId: a.id,
      change: "removed",
    });
  }

  // Groups and subgraph definitions are compared whatever the nodes did: an
  // edit that touched both (deleting a group with its nodes, say) leaves the
  // node targets pointing at something an undo may not be able to find, and the
  // group is then what there is to scroll to.
  for (const group of changedGroupIds(prev.groups, next.groups)) {
    structural = true;
    changedTargets.push({
      kind: "group",
      subgraphId: null,
      groupId: group.id,
      change: group.change,
    });
  }

  const prevDefs = prev.definitions?.subgraphs ?? [];
  const nextDefs = next.definitions?.subgraphs ?? [];
  const prevDefById = new Map(prevDefs.map((def) => [def.id, def]));
  for (const def of nextDefs) {
    const before = prevDefById.get(def.id);
    if (!before) {
      structural = true;
      changedTargets.push({ kind: "subgraphDef", subgraphId: def.id, change: "added" });
      continue;
    }
    if (before === def) continue;
    if (subgraphMetaDiffers(before, def)) {
      structural = true;
      changedTargets.push({ kind: "subgraphDef", subgraphId: def.id, change: "edited" });
    }
    for (const group of changedGroupIds(before.groups, def.groups)) {
      structural = true;
      changedTargets.push({
        kind: "group",
        subgraphId: def.id,
        groupId: group.id,
        change: group.change,
      });
    }
  }
  if (nextDefs.length !== prevDefs.length) structural = true; // a type was removed

  if (!structural) {
    if (linksDiffer(prev.links, next.links)) structural = true;
    else {
      for (const def of nextDefs) {
        const before = prevDefById.get(def.id);
        if (
          before
          && linksDiffer(
            before.links as unknown as Workflow["links"],
            def.links as unknown as Workflow["links"],
          )
        ) {
          structural = true;
          break;
        }
      }
    }
  }

  const meaningful = structural || changedNodeIds.length > 0;
  return { meaningful, structural, changedNodeIds, changedTargets };
}

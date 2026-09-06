import type {
  Workflow,
  WorkflowGroup,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphDefinition,
  WorkflowSubgraphLink,
} from '@/api/types';
import {
  MOBILE_INSTANCE_NUMBER_PROPERTY,
  getLinkId,
  getLinkOriginId,
  getLinkOriginSlot,
  getLinkTargetId,
  getLinkTargetSlot,
  getLinkType,
  isSubgraphPlaceholder,
  makeScopeLink,
  maxNodeIdAcrossScopes,
  resolveCurrentScope,
  resolveNodeByHierarchicalKey,
  resolveScopeForHierarchicalKey,
  stripMobileDefMeta,
  withMobileDefMeta,
  type ScopeFrame,
} from '@/utils/canonicalWorkflowOps';
import { numberSubgraphInstances } from '@/utils/subgraphInstanceNumbers';
import {
  cloneSubgraphDefinition,
  generateUniqueSubgraphId,
  uniquifySubgraphName,
} from '@/utils/duplicateNode';
import { expandGroupToFitNodes, getBottomPlacementForScope } from '@/utils/nodePositioning';
import { computeGroupParentsFor, computeNodeGroupsFor } from '@/utils/nodeGroups';
import type {
  ClipboardLink,
  WorkflowClipboardPayload,
} from '@/hooks/useWorkflowClipboard';

type ScopeLink = WorkflowLink | WorkflowSubgraphLink;

// Internal links among a set of node ids, normalized to ClipboardLink. A link is
// "internal" only when BOTH endpoints are in the set — boundary links are
// dropped so they paste disconnected.
function collectInternalLinks(links: ScopeLink[], nodeIds: Set<number>): ClipboardLink[] {
  const result: ClipboardLink[] = [];
  for (const link of links) {
    const originId = getLinkOriginId(link);
    const targetId = getLinkTargetId(link);
    if (!nodeIds.has(originId) || !nodeIds.has(targetId)) continue;
    result.push({
      originId,
      originSlot: getLinkOriginSlot(link),
      targetId,
      targetSlot: getLinkTargetSlot(link),
      type: String(getLinkType(link)),
    });
  }
  return result;
}

// Subgraph definitions referenced (transitively) by the given placeholder nodes.
function collectReferencedSubgraphs(
  workflow: Workflow,
  nodes: WorkflowNode[],
): WorkflowSubgraphDefinition[] {
  const defs = workflow.definitions?.subgraphs ?? [];
  const out: WorkflowSubgraphDefinition[] = [];
  const seen = new Set<string>();
  const visit = (sgId: string) => {
    if (seen.has(sgId)) return;
    const def = defs.find((d) => d.id === sgId);
    if (!def) return;
    seen.add(sgId);
    out.push(structuredClone(def));
    // Nested placeholders inside this definition reference further defs.
    for (const inner of def.nodes ?? []) {
      if (defs.some((d) => d.id === inner.type)) visit(inner.type);
    }
  };
  for (const node of nodes) {
    if (defs.some((d) => d.id === node.type)) visit(node.type);
  }
  return out;
}

/** Build a clipboard payload for a single node (or subgraph placeholder). */
export function buildNodeClipboardPayload(
  workflow: Workflow,
  nodeItemKey: string,
): WorkflowClipboardPayload | null {
  const scope = resolveScopeForHierarchicalKey(workflow, nodeItemKey);
  const node = resolveNodeByHierarchicalKey(scope.nodes, nodeItemKey);
  if (!node) return null;
  const nodes = [structuredClone(node)];
  const subgraphs = isSubgraphPlaceholder(node, workflow)
    ? collectReferencedSubgraphs(workflow, nodes)
    : [];
  return {
    nodes,
    links: [],
    subgraphs,
    group: null,
    summary: isSubgraphPlaceholder(node, workflow) ? 'subgraph' : '1 node',
  };
}

/** Build a clipboard payload for a group: its member nodes + internal links. */
export function buildGroupClipboardPayload(
  workflow: Workflow,
  group: WorkflowGroup,
  subgraphId: string | null,
  memberNodeIds: number[],
): WorkflowClipboardPayload | null {
  const scopeStack: ScopeFrame[] =
    subgraphId == null
      ? [{ type: 'root' }]
      : [{ type: 'root' }, { type: 'subgraph', id: subgraphId, placeholderNodeId: -1 }];
  const scope = resolveCurrentScope(scopeStack, workflow);
  const idSet = new Set(memberNodeIds);
  const nodes = scope.nodes.filter((n) => idSet.has(n.id)).map((n) => structuredClone(n));
  const links = collectInternalLinks(scope.links as ScopeLink[], idSet);
  const subgraphs = collectReferencedSubgraphs(workflow, nodes);
  return {
    nodes,
    links,
    subgraphs,
    group: structuredClone(group),
    summary: `group (${nodes.length} node${nodes.length === 1 ? '' : 's'})`,
  };
}

/**
 * Build a clipboard payload for an arbitrary set of nodes in one scope (the
 * workflow-panel bulk "Copy" of a multi-selection). Gathers the nodes, the links
 * internal to the set, and any referenced subgraph definitions — but no group box
 * (group recreation on paste isn't part of this payload). A following paste drops
 * them all at once at the bottom of the target scope via applyClipboardPaste.
 */
export function buildMultiNodeClipboardPayload(
  workflow: Workflow,
  subgraphId: string | null,
  nodeIds: number[],
): WorkflowClipboardPayload | null {
  if (nodeIds.length === 0) return null;
  const scopeStack: ScopeFrame[] =
    subgraphId == null
      ? [{ type: 'root' }]
      : [{ type: 'root' }, { type: 'subgraph', id: subgraphId, placeholderNodeId: -1 }];
  const scope = resolveCurrentScope(scopeStack, workflow);
  const idSet = new Set(nodeIds);
  const nodes = scope.nodes.filter((n) => idSet.has(n.id)).map((n) => structuredClone(n));
  if (nodes.length === 0) return null;
  const links = collectInternalLinks(scope.links as ScopeLink[], idSet);
  const subgraphs = collectReferencedSubgraphs(workflow, nodes);
  return {
    nodes,
    links,
    subgraphs,
    group: null,
    summary: `${nodes.length} node${nodes.length === 1 ? '' : 's'}`,
  };
}

export interface PasteResult {
  workflow: Workflow;
  newNodeIds: number[];
  newGroupId: number | null;
}

/**
 * Paste a clipboard payload into the given scope of `workflow`. Re-ids every
 * node (and any carried subgraph definitions), rebuilds the internal links with
 * fresh ids, and positions the items at the bottom of the target scope. Returns
 * the updated workflow plus the new ids, or null if the payload is empty.
 */
export function applyClipboardPaste(
  workflow: Workflow,
  payload: WorkflowClipboardPayload,
  targetSubgraphId: string | null,
): PasteResult | null {
  if (payload.nodes.length === 0 && !payload.group) return null;
  let nextWorkflow = workflow;

  // 1. Allocate node ids (workflow-global space).
  let nextNodeId = maxNodeIdAcrossScopes(nextWorkflow) + 1;
  const nodeIdMap = new Map<number, number>();
  for (const n of payload.nodes) nodeIdMap.set(n.id, nextNodeId++);

  // 2. Materialize carried subgraph definitions.
  //    A definition already present in the target (matched by id) is the same
  //    type: pasted placeholders keep pointing at it and no clone is made —
  //    the target's version of the definition is authoritative.
  //    Everything else is cloned under a fresh id + fresh inner node ids
  //    (nested placeholders following the id map), with a uniquified name; a
  //    def transplanted into a workflow that lacks its type arrives as a new
  //    type there, with no instance lineage to carry over.
  //    Defs reachable only through a shared type are skipped entirely — the
  //    target's copy of that type already references its own nested defs.
  const existingDefs = nextWorkflow.definitions?.subgraphs ?? [];
  const payloadDefById = new Map(payload.subgraphs.map((d) => [d.id, d]));
  const sharedTypeIds = new Set<string>();
  for (const def of payload.subgraphs) {
    // The same definition id on both sides means the same type: paste makes
    // another instance of the target's copy rather than a second definition
    // that drifts away from it.
    if (existingDefs.some((d) => d.id === def.id)) sharedTypeIds.add(def.id);
  }
  // Defs that actually need clones: walk from the pasted nodes' types, stopping
  // at shared types.
  const defsToClone: WorkflowSubgraphDefinition[] = [];
  {
    const visited = new Set<string>();
    const queue = payload.nodes.map((n) => n.type).filter((t) => payloadDefById.has(t));
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (visited.has(id)) continue;
      visited.add(id);
      if (sharedTypeIds.has(id)) continue;
      const def = payloadDefById.get(id) as WorkflowSubgraphDefinition;
      defsToClone.push(def);
      for (const inner of def.nodes ?? []) {
        if (payloadDefById.has(inner.type)) queue.push(inner.type);
      }
    }
  }
  // Instances already in the target may never have been numbered — a subgraph
  // that came from desktop has no numbers at all. Number them before minting
  // one for the paste, so the copy does not land as "Layer 2" beside a "Layer".
  for (const defId of sharedTypeIds) {
    nextWorkflow = numberSubgraphInstances(nextWorkflow, defId).workflow;
  }

  const subgraphIdMap = new Map<string, string>();
  const allDefs = [...(nextWorkflow.definitions?.subgraphs ?? [])];
  const newDefs: WorkflowSubgraphDefinition[] = [];
  const takenSgIds = [...allDefs];
  for (const def of defsToClone) {
    const newSgId = generateUniqueSubgraphId(takenSgIds);
    subgraphIdMap.set(def.id, newSgId);
    takenSgIds.push({ id: newSgId } as WorkflowSubgraphDefinition);
  }
  // Inner-node renumbering, kept per cloned type. A placeholder's
  // `properties.proxyWidgets` addresses inner nodes by id, so a clone whose
  // interior was renumbered leaves those entries naming nodes that no longer
  // exist anywhere. Stock cannot resolve them: `classify` quarantines each one
  // as `missingSourceNode` and only rescues entries written against the `-1`
  // boundary sentinel, so the pasted instance silently drops back to the
  // definition's baked values and carries a `proxyWidgetErrorQuarantine`
  // property from then on.
  const innerIdMapBySgId = new Map<string, Map<number, number>>();
  for (const def of defsToClone) {
    const newSgId = subgraphIdMap.get(def.id) as string;
    const cloned = cloneSubgraphDefinition(def, newSgId, nextNodeId, subgraphIdMap);
    innerIdMapBySgId.set(newSgId, cloned.nodeIdMap);
    nextNodeId = cloned.nextNodeId;
    const forked = stripMobileDefMeta({
      ...cloned.def,
      name: uniquifySubgraphName(cloned.def.name, allDefs),
    });
    allDefs.push(forked);
    newDefs.push(forked);
  }

  // 3. Position the whole payload below everything already in the target scope,
  //    preserving the copied items' relative offsets.
  //    getBottomPlacementForScope only looks at nodes, so also drop below any
  //    existing groups — otherwise the pasted content can land inside a tall
  //    group and steal its membership.
  const base = getBottomPlacementForScope(nextWorkflow, { subgraphId: targetSubgraphId });
  const existingGroupsForBottom =
    targetSubgraphId == null
      ? nextWorkflow.groups ?? []
      : nextWorkflow.definitions?.subgraphs?.find((sg) => sg.id === targetSubgraphId)?.groups ?? [];
  let baseY = base[1];
  for (const g of existingGroupsForBottom) {
    baseY = Math.max(baseY, g.bounding[1] + g.bounding[3] + 80);
  }
  const basePos: [number, number] = [base[0], baseY];

  // Anchor placement to the group's top-left when pasting a group, otherwise to
  // the top-left-most node. Anchoring to nodes[0] (the old behaviour) let a group
  // whose first member sits low in the box float upward into existing content.
  const anchor: [number, number] = payload.group
    ? [payload.group.bounding[0], payload.group.bounding[1]]
    : [
        Math.min(...payload.nodes.map((n) => n.pos?.[0] ?? 0)),
        Math.min(...payload.nodes.map((n) => n.pos?.[1] ?? 0)),
      ];

  const newNodes: WorkflowNode[] = payload.nodes.map((n) => {
    const clone = structuredClone(n) as WorkflowNode;
    clone.id = nodeIdMap.get(n.id) as number;
    clone.type = subgraphIdMap.get(n.type) ?? n.type;
    clone.itemKey = undefined;
    // Follow the interior renumbering for a placeholder whose type was cloned.
    // Boundary entries (`-1`) address by name and are left alone.
    const innerIdMap = innerIdMapBySgId.get(clone.type);
    const proxyWidgets = (clone.properties as Record<string, unknown> | undefined)?.proxyWidgets;
    if (innerIdMap && Array.isArray(proxyWidgets)) {
      (clone.properties as Record<string, unknown>).proxyWidgets = proxyWidgets.map((entry) => {
        if (!Array.isArray(entry) || entry.length < 2) return entry;
        const sourceId = Number(entry[0]);
        const mapped = Number.isFinite(sourceId) ? innerIdMap.get(sourceId) : undefined;
        return mapped == null ? entry : [String(mapped), ...entry.slice(1)];
      });
    }
    const dx = (n.pos?.[0] ?? 0) - anchor[0];
    const dy = (n.pos?.[1] ?? 0) - anchor[1];
    clone.pos = [basePos[0] + dx, basePos[1] + dy];
    clone.inputs = (n.inputs ?? []).map((input) => ({ ...structuredClone(input), link: null }));
    clone.outputs = (n.outputs ?? []).map((output) => ({ ...structuredClone(output), links: null }));
    return clone;
  });
  const nodeById = new Map(newNodes.map((n) => [n.id, n]));

  // 3b. Instance-number bookkeeping. Pasted placeholders of a shared type get
  //     a fresh instance number from that type's counter; placeholders whose
  //     definition was forked shed any stale number carried from the source.
  let countersChanged = false;
  const nextCounterByDefId = new Map<string, number>();
  for (const clone of newNodes) {
    if (sharedTypeIds.has(clone.type)) {
      const def = allDefs.find((d) => d.id === clone.type);
      if (!def) continue;
      const next = nextCounterByDefId.get(clone.type)
        ?? numberSubgraphInstances(nextWorkflow, clone.type).next;
      clone.properties = { ...(clone.properties ?? {}), [MOBILE_INSTANCE_NUMBER_PROPERTY]: next };
      nextCounterByDefId.set(clone.type, next + 1);
      countersChanged = true;
    } else if (clone.properties && MOBILE_INSTANCE_NUMBER_PROPERTY in clone.properties) {
      const rest = { ...clone.properties };
      delete rest[MOBILE_INSTANCE_NUMBER_PROPERTY];
      clone.properties = rest;
    }
  }
  const finalDefs = countersChanged
    ? allDefs.map((d) => {
        const counter = nextCounterByDefId.get(d.id);
        return counter != null ? withMobileDefMeta(d, { nextInstanceNumber: counter }) : d;
      })
    : allDefs;

  // 4. Add cloned defs / updated counters before resolving the target scope
  //    (so the scope's applyPatch sees the new definitions list).
  if (newDefs.length > 0 || countersChanged) {
    nextWorkflow = {
      ...nextWorkflow,
      definitions: { ...(nextWorkflow.definitions ?? {}), subgraphs: finalDefs },
    };
  }

  const scopeStack: ScopeFrame[] =
    targetSubgraphId == null
      ? [{ type: 'root' }]
      : [{ type: 'root' }, { type: 'subgraph', id: targetSubgraphId, placeholderNodeId: -1 }];
  const scope = resolveCurrentScope(scopeStack, nextWorkflow);

  // 5. Rebuild the internal links with fresh ids and wire up the new slots.
  let nextLinkId =
    Math.max(scope.linkIdBase, 0, ...scope.links.map((l) => getLinkId(l))) + 1;
  const newScopeLinks: ScopeLink[] = [];
  for (const link of payload.links) {
    const newSrc = nodeIdMap.get(link.originId);
    const newTgt = nodeIdMap.get(link.targetId);
    if (newSrc == null || newTgt == null) continue;
    const newLinkId = nextLinkId++;
    newScopeLinks.push(
      makeScopeLink(newLinkId, newSrc, link.originSlot, newTgt, link.targetSlot, link.type, targetSubgraphId),
    );
    const tgt = nodeById.get(newTgt);
    if (tgt && tgt.inputs[link.targetSlot]) {
      tgt.inputs[link.targetSlot] = { ...tgt.inputs[link.targetSlot], link: newLinkId };
    }
    const src = nodeById.get(newSrc);
    if (src && src.outputs[link.originSlot]) {
      const current = src.outputs[link.originSlot].links ?? [];
      src.outputs[link.originSlot] = { ...src.outputs[link.originSlot], links: [...current, newLinkId] };
    }
  }

  // 6. Recreate the group when one was copied.
  let newGroupId: number | null = null;
  if (payload.group) {
    const maxGid = scope.groups.reduce((m, g) => Math.max(m, g.id), 0);
    newGroupId = maxGid + 1;
    const gb = payload.group.bounding;
    const newGroup: WorkflowGroup = {
      ...structuredClone(payload.group),
      id: newGroupId,
      itemKey: undefined,
      bounding: [
        basePos[0] + (gb[0] - anchor[0]),
        basePos[1] + (gb[1] - anchor[1]),
        gb[2],
        gb[3],
      ],
    };
    // Groups aren't part of ScopePatch — splice them in per scope.
    if (targetSubgraphId == null) {
      nextWorkflow = { ...nextWorkflow, groups: [...(nextWorkflow.groups ?? []), newGroup] };
    } else {
      nextWorkflow = {
        ...nextWorkflow,
        definitions: {
          ...(nextWorkflow.definitions ?? {}),
          subgraphs: (nextWorkflow.definitions?.subgraphs ?? []).map((sg) =>
            sg.id === targetSubgraphId
              ? { ...sg, groups: [...(sg.groups ?? []), newGroup] }
              : sg,
          ),
        },
      };
    }
  }

  // 7. Apply the node/link patch and bump last_node_id.
  nextWorkflow = scope.applyPatch(nextWorkflow, {
    nodes: [...scope.nodes, ...newNodes],
    links: [...(scope.links as ScopeLink[]), ...newScopeLinks] as WorkflowLink[] | WorkflowSubgraphLink[],
    last_link_id: nextLinkId - 1,
  });
  nextWorkflow = {
    ...nextWorkflow,
    last_node_id: Math.max(nextWorkflow.last_node_id ?? 0, nextNodeId - 1),
  };

  return { workflow: nextWorkflow, newNodeIds: newNodes.map((n) => n.id), newGroupId };
}

export interface GroupMoveSelection {
  rootGroupIds: number[];
  groupIds: Set<number>;
  nodeIds: Set<number>;
}

/**
 * Expand selected group ids into the complete group subtrees that must travel
 * with them. Nested selected groups collapse under their selected ancestor so
 * a subtree is translated exactly once. Nodes are scoped to this graph only;
 * subgraph placeholders travel as nodes, while their definitions do not.
 */
export function collectGroupMoveSelection(
  workflow: Workflow,
  subgraphId: string | null,
  selectedGroupIds: number[],
): GroupMoveSelection {
  const scopeStack: ScopeFrame[] =
    subgraphId == null
      ? [{ type: 'root' }]
      : [{ type: 'root' }, { type: 'subgraph', id: subgraphId, placeholderNodeId: -1 }];
  const scope = resolveCurrentScope(scopeStack, workflow);
  const groupById = new Map(scope.groups.map((group) => [group.id, group]));
  const selected = new Set(selectedGroupIds.filter((id) => groupById.has(id)));
  const parentById = computeGroupParentsFor(scope.groups);

  const hasSelectedAncestor = (groupId: number): boolean => {
    const seen = new Set<number>([groupId]);
    let parentId = parentById.get(groupId) ?? null;
    while (parentId != null && !seen.has(parentId)) {
      if (selected.has(parentId)) return true;
      seen.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
    return false;
  };
  const rootGroupIds = selectedGroupIds.filter(
    (id, index) =>
      selected.has(id)
      && selectedGroupIds.indexOf(id) === index
      && !hasSelectedAncestor(id),
  );

  const childrenByParent = new Map<number, number[]>();
  for (const [childId, parentId] of parentById) {
    if (parentId == null) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(childId);
    childrenByParent.set(parentId, children);
  }

  const groupIds = new Set<number>();
  const visitGroup = (groupId: number) => {
    if (groupIds.has(groupId)) return;
    groupIds.add(groupId);
    for (const childId of childrenByParent.get(groupId) ?? []) visitGroup(childId);
  };
  for (const rootGroupId of rootGroupIds) visitGroup(rootGroupId);

  const nodeIds = new Set<number>();
  const nodeToGroup = computeNodeGroupsFor(scope.nodes, scope.groups);
  for (const node of scope.nodes) {
    const groupId = nodeToGroup.get(node.id);
    if (groupId != null && groupIds.has(groupId)) nodeIds.add(node.id);
  }

  return { rootGroupIds, groupIds, nodeIds };
}

/**
 * Relocate whole existing group subtrees into a target group. Every nested
 * group rect and every node assigned anywhere in the subtree moves by the same
 * delta, preserving all relative geometry. Top-level selected subtrees are
 * stacked below the target's current contents, then the target grows around
 * every moved group rect. Returns the workflow unchanged when nothing applies.
 */
export function placeGroupsIntoGroup(
  workflow: Workflow,
  targetGroupId: number,
  subgraphId: string | null,
  groupIds: number[],
): Workflow {
  if (groupIds.length === 0) return workflow;
  const scopeStack: ScopeFrame[] =
    subgraphId == null
      ? [{ type: 'root' }]
      : [{ type: 'root' }, { type: 'subgraph', id: subgraphId, placeholderNodeId: -1 }];
  const scope = resolveCurrentScope(scopeStack, workflow);
  const target = scope.groups.find((g) => g.id === targetGroupId);
  if (!target) return workflow;
  const moveSelection = collectGroupMoveSelection(workflow, subgraphId, groupIds);
  if (moveSelection.rootGroupIds.length === 0) return workflow;

  const groupById = new Map(scope.groups.map((group) => [group.id, group]));
  const parentById = computeGroupParentsFor(scope.groups);
  const rootByGroupId = new Map<number, number>();
  for (const movedGroupId of moveSelection.groupIds) {
    const seen = new Set<number>([movedGroupId]);
    let current = movedGroupId;
    while (true) {
      const parentId = parentById.get(current) ?? null;
      if (
        parentId == null
        || seen.has(parentId)
        || !moveSelection.groupIds.has(parentId)
      ) {
        rootByGroupId.set(movedGroupId, current);
        break;
      }
      seen.add(parentId);
      current = parentId;
    }
  }
  const nodeToGroup = computeNodeGroupsFor(scope.nodes, scope.groups);

  const padding = 24;
  const gap = 16;
  const x = target.bounding[0] + padding;
  let y = target.bounding[1] + target.bounding[3]; // just past the current bottom

  const groupBoundingById = new Map<number, [number, number, number, number]>();
  const nodePosById = new Map<number, [number, number]>();
  for (const rootGroupId of moveSelection.rootGroupIds) {
    const group = groupById.get(rootGroupId);
    if (!group || rootGroupId === targetGroupId) continue;
    const [bx, by] = group.bounding;
    const dx = x - bx;
    const dy = y - by;

    let subtreeBottom = group.bounding[1] + group.bounding[3];
    for (const movedGroupId of moveSelection.groupIds) {
      if (rootByGroupId.get(movedGroupId) !== rootGroupId) continue;
      const movedGroup = groupById.get(movedGroupId);
      if (!movedGroup) continue;
      const [gx, gy, gw, gh] = movedGroup.bounding;
      groupBoundingById.set(movedGroupId, [gx + dx, gy + dy, gw, gh]);
      subtreeBottom = Math.max(subtreeBottom, gy + gh);
    }
    for (const node of scope.nodes) {
      if (!moveSelection.nodeIds.has(node.id)) continue;
      const assignedGroupId = nodeToGroup.get(node.id);
      if (assignedGroupId == null || rootByGroupId.get(assignedGroupId) !== rootGroupId) {
        continue;
      }
      nodePosById.set(node.id, [node.pos[0] + dx, node.pos[1] + dy]);
    }
    y += subtreeBottom - by + gap;
  }
  if (groupBoundingById.size === 0) return workflow;

  // Grow the target box around the moved rects (each rect as a pseudo-node).
  const movedRects = [...groupBoundingById.values()].map(([px, py, pw, ph], index) => ({
    id: -(index + 1),
    pos: [px, py] as [number, number],
    size: [pw, ph] as [number, number],
  }));
  const expandedTarget = expandGroupToFitNodes(target, movedRects);

  const patchGroups = (groups: WorkflowGroup[]): WorkflowGroup[] =>
    groups.map((g) => {
      if (g.id === targetGroupId) return expandedTarget;
      const bounding = groupBoundingById.get(g.id);
      return bounding ? { ...g, bounding } : g;
    });

  let next = scope.applyPatch(workflow, {
    nodes: scope.nodes.map((n) =>
      nodePosById.has(n.id) ? { ...n, pos: nodePosById.get(n.id) as [number, number] } : n,
    ),
  });
  if (subgraphId == null) {
    next = { ...next, groups: patchGroups(next.groups ?? []) };
  } else {
    next = {
      ...next,
      definitions: {
        ...(next.definitions ?? {}),
        subgraphs: (next.definitions?.subgraphs ?? []).map((sg) =>
          sg.id === subgraphId ? { ...sg, groups: patchGroups(sg.groups ?? []) } : sg,
        ),
      },
    };
  }
  return next;
}

/**
 * Relocate freshly-pasted nodes into an existing group: stack them just below the
 * group's current contents, then grow the group's bounding box to enclose them so
 * the geometric layout pass counts them as members. Used by "Paste here" on a
 * group container. Returns the workflow unchanged if the group or nodes are gone.
 */
export function placePastedNodesIntoGroup(
  workflow: Workflow,
  groupId: number,
  subgraphId: string | null,
  newNodeIds: number[],
): Workflow {
  const scopeStack: ScopeFrame[] =
    subgraphId == null
      ? [{ type: 'root' }]
      : [{ type: 'root' }, { type: 'subgraph', id: subgraphId, placeholderNodeId: -1 }];
  const scope = resolveCurrentScope(scopeStack, workflow);
  const group = scope.groups.find((g) => g.id === groupId);
  if (!group) return workflow;

  const idSet = new Set(newNodeIds);
  const targets = scope.nodes.filter((n) => idSet.has(n.id));
  if (targets.length === 0) return workflow;

  const padding = 24;
  const gap = 16;
  const [gx, gy, , gh] = group.bounding;
  const x = gx + padding;
  let y = gy + gh; // start just past the current bottom; expand grows to fit

  const sizeOf = (n: WorkflowNode): [number, number] =>
    (Array.isArray(n.size) ? (n.size as [number, number]) : [200, 100]);
  const posById = new Map<number, [number, number]>();
  for (const node of targets) {
    const [, h] = sizeOf(node);
    posById.set(node.id, [x, y]);
    y += h + gap;
  }

  const repositioned = targets.map((n) => ({ id: n.id, pos: posById.get(n.id) as [number, number], size: sizeOf(n) }));
  const expandedGroup = expandGroupToFitNodes(group, repositioned);

  // Patch node positions in scope, then splice the resized group back per scope.
  let next = scope.applyPatch(workflow, {
    nodes: scope.nodes.map((n) => (posById.has(n.id) ? { ...n, pos: posById.get(n.id) as [number, number] } : n)),
  });
  if (subgraphId == null) {
    next = {
      ...next,
      groups: (next.groups ?? []).map((g) => (g.id === groupId ? expandedGroup : g)),
    };
  } else {
    next = {
      ...next,
      definitions: {
        ...(next.definitions ?? {}),
        subgraphs: (next.definitions?.subgraphs ?? []).map((sg) =>
          sg.id === subgraphId
            ? { ...sg, groups: (sg.groups ?? []).map((g) => (g.id === groupId ? expandedGroup : g)) }
            : sg,
        ),
      },
    };
  }
  return next;
}

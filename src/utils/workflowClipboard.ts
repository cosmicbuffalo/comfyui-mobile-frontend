import type {
  Workflow,
  WorkflowGroup,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphDefinition,
  WorkflowSubgraphLink,
} from '@/api/types';
import {
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
  type ScopeFrame,
} from '@/utils/canonicalWorkflowOps';
import {
  cloneSubgraphDefinition,
  generateUniqueSubgraphId,
} from '@/utils/duplicateNode';
import { expandGroupToFitNodes, getBottomPlacementForScope } from '@/utils/nodePositioning';
import { t } from '@/i18n';
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
    summary: isSubgraphPlaceholder(node, workflow) ? t('subgraph') : t('1 node'),
  };
}

/** Build a clipboard payload for a group: its member nodes + internal links. */
export function buildGroupClipboardPayload(
  workflow: Workflow,
  group: WorkflowGroup,
  subgraphId: string | null,
  memberNodeIds: number[],
): WorkflowClipboardPayload | null {
  if (memberNodeIds.length === 0) return null;
  const scopeStack: ScopeFrame[] =
    subgraphId == null
      ? [{ type: 'root' }]
      : [{ type: 'root' }, { type: 'subgraph', id: subgraphId, placeholderNodeId: -1 }];
  const scope = resolveCurrentScope(scopeStack, workflow);
  const idSet = new Set(memberNodeIds);
  const nodes = scope.nodes.filter((n) => idSet.has(n.id)).map((n) => structuredClone(n));
  if (nodes.length === 0) return null;
  const links = collectInternalLinks(scope.links as ScopeLink[], idSet);
  const subgraphs = collectReferencedSubgraphs(workflow, nodes);
  return {
    nodes,
    links,
    subgraphs,
    group: structuredClone(group),
    summary: nodes.length === 1
      ? t('group (1 node)')
      : t('group ({count} nodes)', { count: nodes.length }),
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
    summary: nodes.length === 1
      ? t('1 node')
      : t('{count} nodes', { count: nodes.length }),
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
  if (payload.nodes.length === 0) return null;
  let nextWorkflow = workflow;

  // 1. Allocate node ids (workflow-global space).
  let nextNodeId = maxNodeIdAcrossScopes(nextWorkflow) + 1;
  const nodeIdMap = new Map<number, number>();
  for (const n of payload.nodes) nodeIdMap.set(n.id, nextNodeId++);

  // 2. Clone carried subgraph definitions under fresh ids + inner node ids.
  //    Allocate every new definition id up front: payload.subgraphs lists
  //    parents before their nested definitions, and a parent's inner
  //    placeholder nodes need the nested definition's NEW id at clone time.
  const subgraphIdMap = new Map<string, string>();
  const existingDefs = nextWorkflow.definitions?.subgraphs ?? [];
  const allDefs = [...existingDefs];
  const newDefs: WorkflowSubgraphDefinition[] = [];
  const takenSgIds = [...allDefs];
  for (const def of payload.subgraphs) {
    const newSgId = generateUniqueSubgraphId(takenSgIds);
    subgraphIdMap.set(def.id, newSgId);
    takenSgIds.push({ id: newSgId } as WorkflowSubgraphDefinition);
  }
  for (const def of payload.subgraphs) {
    const newSgId = subgraphIdMap.get(def.id) as string;
    const cloned = cloneSubgraphDefinition(def, newSgId, nextNodeId, subgraphIdMap);
    nextNodeId = cloned.nextNodeId;
    allDefs.push(cloned.def);
    newDefs.push(cloned.def);
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
    const dx = (n.pos?.[0] ?? 0) - anchor[0];
    const dy = (n.pos?.[1] ?? 0) - anchor[1];
    clone.pos = [basePos[0] + dx, basePos[1] + dy];
    clone.inputs = (n.inputs ?? []).map((input) => ({ ...structuredClone(input), link: null }));
    clone.outputs = (n.outputs ?? []).map((output) => ({ ...structuredClone(output), links: null }));
    return clone;
  });
  const nodeById = new Map(newNodes.map((n) => [n.id, n]));

  // 4. Add cloned defs before resolving the target scope (so the scope's
  //    applyPatch sees the new definitions list).
  if (newDefs.length > 0) {
    nextWorkflow = {
      ...nextWorkflow,
      definitions: { ...(nextWorkflow.definitions ?? {}), subgraphs: allDefs },
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

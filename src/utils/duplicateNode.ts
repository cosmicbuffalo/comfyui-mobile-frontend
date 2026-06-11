import type {
  Workflow,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphLink,
  WorkflowSubgraphDefinition,
} from '@/api/types';
import {
  getLinkId,
  getLinkOriginId,
  getLinkOriginSlot,
  getLinkType,
  isSubgraphPlaceholder,
  makeScopeLink,
  maxNodeIdAcrossScopes,
  resolveNodeByHierarchicalKey,
  resolveScopeForHierarchicalKey,
  type ScopeContext,
} from '@/utils/canonicalWorkflowOps';

type ScopeLink = WorkflowLink | WorkflowSubgraphLink;

// How far down/right the duplicate is offset from the original so it doesn't
// land exactly on top of it.
const DUPLICATE_OFFSET = 40;

export interface DuplicateNodeResult {
  workflow: Workflow;
  newNodeId: number;
  // The duplicated node's own id, so the layout can place the copy directly
  // after it in the list.
  originalNodeId: number;
}

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function generateUniqueSubgraphId(defs: WorkflowSubgraphDefinition[]): string {
  const existing = new Set(defs.map((d) => d.id));
  let id = generateUuid();
  while (existing.has(id)) id = generateUuid();
  return id;
}

/**
 * Build the duplicate of `original` inside its own scope: a fresh node carrying
 * the same values, with every INPUT connection recreated (and the source
 * outputs updated to list the new links) but every OUTPUT connection left
 * blank. `typeOverride` retargets a subgraph placeholder at the cloned
 * definition. Returns the new scope nodes/links and the highest link ID used.
 */
function buildNodeDuplicateInScope(
  scope: ScopeContext,
  original: WorkflowNode,
  newNodeId: number,
  typeOverride?: string,
): { nodes: WorkflowNode[]; links: ScopeLink[]; lastLinkId: number } {
  const subgraphId = scope.subgraphId;
  // Mint link IDs above whatever the scope already uses.
  let nextLinkId =
    Math.max(scope.linkIdBase, 0, ...scope.links.map((l) => getLinkId(l))) + 1;

  const clone: WorkflowNode = {
    ...original,
    id: newNodeId,
    type: typeOverride ?? original.type,
    // Re-annotated by the store's hierarchical-key pass after insertion.
    itemKey: undefined,
    pos: [original.pos[0] + DUPLICATE_OFFSET, original.pos[1] + DUPLICATE_OFFSET],
    flags: structuredClone(original.flags ?? {}),
    properties: structuredClone(original.properties ?? {}),
    widgets_values:
      original.widgets_values !== undefined
        ? structuredClone(original.widgets_values)
        : undefined,
    inputs: (original.inputs ?? []).map((input) => ({ ...input, link: null })),
    // External output connections are intentionally dropped on the copy.
    outputs: (original.outputs ?? []).map((output) => ({ ...output, links: null })),
  };

  // Recreate the incoming connections, and remember which source outputs need
  // the new link IDs appended so their outputs[].links stay consistent.
  const newLinks: ScopeLink[] = [];
  const sourceOutputAdds = new Map<number, Array<{ slot: number; linkId: number }>>();
  (original.inputs ?? []).forEach((input, index) => {
    if (input.link == null) return;
    const link = scope.links.find((l) => getLinkId(l) === input.link);
    if (!link) return;
    const originId = getLinkOriginId(link);
    const originSlot = getLinkOriginSlot(link);
    const type = getLinkType(link);
    const newLinkId = nextLinkId++;
    newLinks.push(
      makeScopeLink(newLinkId, originId, originSlot, newNodeId, index, type, subgraphId),
    );
    clone.inputs[index] = { ...clone.inputs[index], link: newLinkId };
    const adds = sourceOutputAdds.get(originId) ?? [];
    adds.push({ slot: originSlot, linkId: newLinkId });
    sourceOutputAdds.set(originId, adds);
  });

  const nodes = scope.nodes.map((node) => {
    const adds = sourceOutputAdds.get(node.id);
    if (!adds) return node;
    const outputs = (node.outputs ?? []).map((output, slot) => {
      const slotAdds = adds.filter((a) => a.slot === slot);
      if (slotAdds.length === 0) return output;
      return { ...output, links: [...(output.links ?? []), ...slotAdds.map((a) => a.linkId)] };
    });
    return { ...node, outputs };
  });
  nodes.push(clone);

  const links: ScopeLink[] = [...(scope.links as ScopeLink[]), ...newLinks];
  return { nodes, links, lastLinkId: nextLinkId - 1 };
}

/**
 * Deep-copy a subgraph definition into a new definition with a fresh id and
 * fresh, globally-unique inner node IDs. Inner link IDs and the boundary
 * inputs/outputs `linkIds` are kept (subgraph links have their own per-definition
 * ID space); only link endpoints are remapped to the new node IDs, with the
 * -10 (input) / -20 (output) boundary sentinels left untouched. Nested subgraph
 * placeholders keep their type, so they continue to reference (share) the same
 * nested definition — standard subgraph-instance semantics.
 */
function cloneSubgraphDefinition(
  def: WorkflowSubgraphDefinition,
  newSubgraphId: string,
  startNodeId: number,
): { def: WorkflowSubgraphDefinition; nextNodeId: number } {
  let nextNodeId = startNodeId;
  const nodeIdMap = new Map<number, number>();
  for (const inner of def.nodes ?? []) {
    nodeIdMap.set(inner.id, nextNodeId++);
  }
  const remapEndpoint = (id: number): number =>
    id === -10 || id === -20 ? id : (nodeIdMap.get(id) ?? id);

  const nodes = (def.nodes ?? []).map((inner) => {
    const clone = structuredClone(inner) as WorkflowNode;
    clone.id = nodeIdMap.get(inner.id) ?? inner.id;
    clone.itemKey = undefined;
    return clone;
  });
  const links = (def.links ?? []).map((link) => ({
    ...structuredClone(link),
    origin_id: remapEndpoint(link.origin_id),
    target_id: remapEndpoint(link.target_id),
  }));
  const groups = (def.groups ?? []).map((group) => {
    const clone = structuredClone(group);
    clone.itemKey = undefined;
    return clone;
  });

  const newDef: WorkflowSubgraphDefinition = {
    ...structuredClone(def),
    id: newSubgraphId,
    itemKey: undefined,
    nodes,
    links,
    groups,
  };
  return { def: newDef, nextNodeId };
}

/**
 * Duplicate a node (or subgraph placeholder) identified by its hierarchical
 * key. The copy keeps all widget values and incoming connections; outgoing
 * connections are left blank. For a subgraph placeholder, the whole definition
 * is deep-copied into a new definition and the new placeholder points at it.
 * Returns null if the node can't be resolved.
 */
export function duplicateWorkflowNode(
  workflow: Workflow,
  itemKey: string,
): DuplicateNodeResult | null {
  const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
  const original = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
  if (!original) return null;

  if (isSubgraphPlaceholder(original, workflow)) {
    const defs = workflow.definitions?.subgraphs ?? [];
    const sourceDef = defs.find((sg) => sg.id === original.type);
    if (!sourceDef) return null;

    const newSubgraphId = generateUniqueSubgraphId(defs);
    let nextNodeId = maxNodeIdAcrossScopes(workflow) + 1;
    const cloned = cloneSubgraphDefinition(sourceDef, newSubgraphId, nextNodeId);
    nextNodeId = cloned.nextNodeId;
    const newPlaceholderId = nextNodeId++;

    let nextWorkflow: Workflow = {
      ...workflow,
      last_node_id: Math.max(workflow.last_node_id ?? 0, newPlaceholderId),
      definitions: {
        ...(workflow.definitions ?? {}),
        subgraphs: [...defs, cloned.def],
      },
    };

    const built = buildNodeDuplicateInScope(
      scope,
      original,
      newPlaceholderId,
      newSubgraphId,
    );
    nextWorkflow = scope.applyPatch(nextWorkflow, {
      nodes: built.nodes,
      links: built.links as WorkflowLink[] | WorkflowSubgraphLink[],
      last_link_id: built.lastLinkId,
    });
    return { workflow: nextWorkflow, newNodeId: newPlaceholderId, originalNodeId: original.id };
  }

  const newNodeId = maxNodeIdAcrossScopes(workflow) + 1;
  const built = buildNodeDuplicateInScope(scope, original, newNodeId);
  const nextWorkflow = scope.applyPatch(
    { ...workflow, last_node_id: Math.max(workflow.last_node_id ?? 0, newNodeId) },
    {
      nodes: built.nodes,
      links: built.links as WorkflowLink[] | WorkflowSubgraphLink[],
      last_link_id: built.lastLinkId,
    },
  );
  return { workflow: nextWorkflow, newNodeId, originalNodeId: original.id };
}

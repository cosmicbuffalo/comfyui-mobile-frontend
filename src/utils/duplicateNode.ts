import type {
  Workflow,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphLink,
  WorkflowSubgraphDefinition,
} from '@/api/types';
import { numberSubgraphInstances } from '@/utils/subgraphInstanceNumbers';
import {
  MOBILE_INSTANCE_NUMBER_PROPERTY,
  getLinkId,
  getLinkOriginId,
  getLinkOriginSlot,
  getLinkType,
  getMobileDefMeta,
  isSubgraphPlaceholder,
  makeScopeLink,
  maxNodeIdAcrossScopes,
  resolveNodeByHierarchicalKey,
  resolveScopeForHierarchicalKey,
  withMobileDefMeta,
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

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function generateUniqueSubgraphId(defs: WorkflowSubgraphDefinition[]): string {
  const existing = new Set(defs.map((d) => d.id));
  let id = generateUuid();
  while (existing.has(id)) id = generateUuid();
  return id;
}

/**
 * A display name not already used by any definition: the base itself when
 * free, otherwise the base's stem (trailing " N" stripped) with the lowest
 * free numeric suffix — "Foo" → "Foo 2", "Foo 2" → "Foo 3".
 */
export function uniquifySubgraphName(
  base: string | undefined,
  defs: WorkflowSubgraphDefinition[],
): string {
  const taken = new Set(defs.map((d) => d.name).filter((n): n is string => Boolean(n)));
  const name = base?.trim() ? base.trim() : 'Subgraph';
  if (!taken.has(name)) return name;
  const stem = name.replace(/ \d+$/, '').trim() || name;
  for (let i = 2; ; i += 1) {
    const candidate = `${stem} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
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
 * -10 (input) / -20 (output) boundary sentinels left untouched. Without a
 * `subgraphIdMap`, nested subgraph placeholders keep their type, so they
 * continue to reference (share) the same nested definition — standard
 * subgraph-instance semantics for same-workflow duplication. When the caller
 * is transplanting definitions into another workflow (clipboard paste), it
 * must pass the old→new definition-id map so nested placeholders follow their
 * carried definitions instead of pointing at ids that only exist in the source.
 */
export function cloneSubgraphDefinition(
  def: WorkflowSubgraphDefinition,
  newSubgraphId: string,
  startNodeId: number,
  subgraphIdMap?: Map<string, string>,
): { def: WorkflowSubgraphDefinition; nextNodeId: number; nodeIdMap: Map<number, number> } {
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
    clone.type = subgraphIdMap?.get(inner.type) ?? inner.type;
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

  let newDef: WorkflowSubgraphDefinition = {
    ...structuredClone(def),
    id: newSubgraphId,
    itemKey: undefined,
    nodes,
    links,
    groups,
  };

  // The mobile meta's proxyLabels are keyed "<innerNodeId>:<widgetName>";
  // those ids were just re-minted, so re-key the labels or every custom
  // proxy-widget label silently detaches from its widget on the clone.
  const proxyLabels = getMobileDefMeta(newDef).proxyLabels;
  if (proxyLabels) {
    const remapped: Record<string, string> = {};
    for (const [key, label] of Object.entries(proxyLabels)) {
      const separator = key.indexOf(':');
      const oldId = Number(key.slice(0, separator));
      const mapped = nodeIdMap.get(oldId);
      remapped[mapped != null ? `${mapped}${key.slice(separator)}` : key] = label;
    }
    newDef = withMobileDefMeta(newDef, { proxyLabels: remapped });
  }

  return { def: newDef, nextNodeId, nodeIdMap };
}

/**
 * Duplicate a node (or subgraph placeholder) identified by its hierarchical
 * key. The copy keeps all widget values and incoming connections; outgoing
 * connections are left blank. For a subgraph placeholder, the copy is another
 * instance of the SAME definition — every subgraph is a reusable type, so a
 * copy stays a copy and edits inside it reach the original. Forking is its own
 * action. Returns null if the node can't be resolved.
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

    // Every definition is a shared "subgraph type": duplicating one of its
    // placeholders creates another INSTANCE of the same definition (same
    // node.type, fresh instance number) rather than forking the definition.
    // Forking is its own deliberate action, because it is the one that stops
    // later edits from reaching the copies.
    const numbered = numberSubgraphInstances(workflow, sourceDef.id);
    const newPlaceholderId = maxNodeIdAcrossScopes(numbered.workflow) + 1;
    const instanceNumber = numbered.next;
    const workflowWithCounter: Workflow = {
      ...numbered.workflow,
      last_node_id: Math.max(numbered.workflow.last_node_id ?? 0, newPlaceholderId),
      definitions: {
        ...(numbered.workflow.definitions ?? {}),
        subgraphs: (numbered.workflow.definitions?.subgraphs ?? []).map((sg) =>
          sg.id === sourceDef.id
            ? withMobileDefMeta(sg, { nextInstanceNumber: instanceNumber + 1 })
            : sg,
        ),
      },
    };
    const scopeAfter = resolveScopeForHierarchicalKey(workflowWithCounter, itemKey);
    const originalAfter =
      resolveNodeByHierarchicalKey(scopeAfter.nodes, itemKey) ?? original;
    const built = buildNodeDuplicateInScope(scopeAfter, originalAfter, newPlaceholderId);
    const nodes = built.nodes.map((n) =>
      n.id === newPlaceholderId
        ? {
            ...n,
            properties: {
              ...(n.properties ?? {}),
              [MOBILE_INSTANCE_NUMBER_PROPERTY]: instanceNumber,
            },
          }
        : n,
    );
    const nextWorkflow = scopeAfter.applyPatch(workflowWithCounter, {
      nodes,
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

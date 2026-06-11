import type {
  NodeTypes,
  Workflow,
  WorkflowGroup,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphDefinition,
  WorkflowSubgraphLink,
} from '@/api/types';
import {
  applyPromotedValueToTarget,
  buildSlotMap,
  resolvePromotedInlineValue,
} from '@/utils/expandWorkflowSubgraphs';
import {
  getLinkId,
  getLinkOriginId,
  getLinkOriginSlot,
  getLinkTargetId,
  getLinkTargetSlot,
  getLinkType,
  makeScopeLink,
  maxNodeIdAcrossScopes,
} from '@/utils/canonicalWorkflowOps';

type ScopeLink = WorkflowLink | WorkflowSubgraphLink;

interface RawEndpointLink {
  origin_id: number;
  origin_slot: number;
  target_id: number;
  target_slot: number;
  type: string;
}

export interface DissolveSubgraphResult {
  workflow: Workflow;
  /** Inner group id → promoted group id (last dissolved instance wins). */
  groupIdMap: Map<number, number>;
}

function cloneInnerNode(node: WorkflowNode, id: number, bypass: boolean): WorkflowNode {
  return {
    ...node,
    id,
    // The old key points into the dissolved subgraph scope; the store's
    // hierarchical-key annotation pass assigns a fresh parent-scope key.
    itemKey: undefined,
    inputs: (node.inputs ?? []).map((input) => ({ ...input, link: null })),
    outputs: (node.outputs ?? []).map((output) => ({ ...output, links: [] })),
    properties: { ...(node.properties ?? {}) },
    mode: bypass ? 4 : (node.mode ?? 0),
  };
}

/** Recompute every node's inputs[].link / outputs[].links from the scope's links. */
function rebuildScopeNodeLinkRefs(nodes: WorkflowNode[], links: ScopeLink[]): WorkflowNode[] {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number[]>();
  for (const link of links) {
    const id = getLinkId(link);
    incoming.set(`${getLinkTargetId(link)}:${getLinkTargetSlot(link)}`, id);
    const outKey = `${getLinkOriginId(link)}:${getLinkOriginSlot(link)}`;
    const list = outgoing.get(outKey) ?? [];
    list.push(id);
    outgoing.set(outKey, list);
  }
  return nodes.map((node) => ({
    ...node,
    inputs: (node.inputs ?? []).map((input, index) => ({
      ...input,
      link: incoming.get(`${node.id}:${index}`) ?? null,
    })),
    outputs: (node.outputs ?? []).map((output, index) => {
      const list = outgoing.get(`${node.id}:${index}`) ?? [];
      return { ...output, links: list.length > 0 ? list : null };
    }),
  }));
}

/**
 * Dissolve every placeholder instance of `subgraphId` in the given parent
 * scope: promote the definition's inner nodes (fresh IDs per instance),
 * convert inner links to the parent scope's format with fresh link IDs,
 * bridge boundary connections (parent link → placeholder slot → inner node,
 * and the reverse for outputs), bake promoted widget values into the promoted
 * nodes, and clone the definition's groups with fresh IDs.
 *
 * The definition itself is removed only when no placeholder of it remains in
 * any other scope. Returns null when the subgraph or its placeholders are not
 * found in the parent scope.
 */
export function dissolveSubgraph(
  workflow: Workflow,
  subgraphId: string,
  parentSubgraphId: string | null,
  nodeTypes: NodeTypes | null,
): DissolveSubgraphResult | null {
  const defs = workflow.definitions?.subgraphs ?? [];
  const target = defs.find((sg) => sg.id === subgraphId);
  if (!target) return null;
  const parentDef =
    parentSubgraphId == null ? null : defs.find((sg) => sg.id === parentSubgraphId);
  if (parentSubgraphId != null && !parentDef) return null;

  const parentNodes: WorkflowNode[] =
    parentSubgraphId == null ? (workflow.nodes ?? []) : (parentDef!.nodes ?? []);
  const parentLinks: ScopeLink[] =
    parentSubgraphId == null ? (workflow.links ?? []) : (parentDef!.links ?? []);
  const parentGroups: WorkflowGroup[] =
    parentSubgraphId == null ? (workflow.groups ?? []) : (parentDef!.groups ?? []);

  const placeholders = parentNodes.filter((n) => n.type === subgraphId);
  if (placeholders.length === 0) return null;
  const placeholderIds = new Set(placeholders.map((n) => n.id));

  const subgraphMap = new Map<string, WorkflowSubgraphDefinition>(
    defs.map((sg) => [sg.id, sg]),
  );

  let nextNodeId = maxNodeIdAcrossScopes(workflow) + 1;
  let nextLinkId =
    (parentSubgraphId == null
      ? Math.max(
          workflow.last_link_id ?? 0,
          ...(workflow.links ?? []).map((l) => l[0]),
          0,
        )
      : Math.max(0, ...(parentDef!.links ?? []).map((l) => l.id))) + 1;
  let nextGroupId = Math.max(0, ...parentGroups.map((g) => g.id)) + 1;

  const promotedNodes: WorkflowNode[] = [];
  const promotedGroups: WorkflowGroup[] = [];
  const groupIdMap = new Map<number, number>();
  const rawNewLinks: RawEndpointLink[] = [];

  interface InstanceData {
    inputSlotMap: Map<number, number>;
    outputSlotMap: Map<number, number>;
    /** def input slot → inner endpoints (remapped node ids) */
    inputTargets: Map<number, Array<{ nodeId: number; slot: number; type: string }>>;
    /** def output slot → inner endpoints (remapped node ids) */
    outputSources: Map<number, Array<{ nodeId: number; slot: number; type: string }>>;
  }
  const instanceData = new Map<number, InstanceData>();

  for (const placeholder of placeholders) {
    const bypass = placeholder.mode === 4;
    const nodeIdMap = new Map<number, number>();
    const clonesById = new Map<number, WorkflowNode>();

    for (const inner of target.nodes ?? []) {
      const mappedId = nextNodeId++;
      nodeIdMap.set(inner.id, mappedId);
      const clone = cloneInnerNode(inner, mappedId, bypass);
      clonesById.set(mappedId, clone);
      promotedNodes.push(clone);
    }

    const inputSlotMap = buildSlotMap(placeholder.inputs ?? [], target.inputs ?? []);
    const outputSlotMap = buildSlotMap(placeholder.outputs ?? [], target.outputs ?? []);
    const inputTargets: InstanceData['inputTargets'] = new Map();
    const outputSources: InstanceData['outputSources'] = new Map();

    for (const link of target.links ?? []) {
      if (link.origin_id === -10) {
        const mappedTarget = nodeIdMap.get(link.target_id);
        if (mappedTarget === undefined) continue;
        const list = inputTargets.get(link.origin_slot) ?? [];
        list.push({ nodeId: mappedTarget, slot: link.target_slot, type: link.type });
        inputTargets.set(link.origin_slot, list);
        continue;
      }
      if (link.target_id === -20) {
        const mappedOrigin = nodeIdMap.get(link.origin_id);
        if (mappedOrigin === undefined) continue;
        const list = outputSources.get(link.target_slot) ?? [];
        list.push({ nodeId: mappedOrigin, slot: link.origin_slot, type: link.type });
        outputSources.set(link.target_slot, list);
        continue;
      }
      const mappedOrigin = nodeIdMap.get(link.origin_id);
      const mappedTarget = nodeIdMap.get(link.target_id);
      if (mappedOrigin === undefined || mappedTarget === undefined) continue;
      rawNewLinks.push({
        origin_id: mappedOrigin,
        origin_slot: link.origin_slot,
        target_id: mappedTarget,
        target_slot: link.target_slot,
        type: link.type,
      });
    }

    // Bake promoted widget values into the promoted nodes — the placeholder
    // (whose widgets_values were authoritative) is about to disappear.
    const promotedInputs = (placeholder.inputs ?? []).filter((inp) => inp.widget != null);
    promotedInputs.forEach((inp, promotedIndex) => {
      if (inp.link != null) return;
      const value = resolvePromotedInlineValue(placeholder, inp, promotedIndex);
      if (value === undefined) return;
      const parentSlot = (placeholder.inputs ?? []).indexOf(inp);
      const mappedSlot = inputSlotMap.get(parentSlot);
      if (mappedSlot === undefined) return;
      for (const endpoint of inputTargets.get(mappedSlot) ?? []) {
        applyPromotedValueToTarget(
          clonesById.get(endpoint.nodeId),
          endpoint.slot,
          inp.widget?.name,
          value,
          subgraphMap,
          nodeTypes,
        );
      }
    });

    for (const group of target.groups ?? []) {
      const mappedId = nextGroupId++;
      groupIdMap.set(group.id, mappedId);
      promotedGroups.push({ ...group, id: mappedId, itemKey: undefined });
    }

    instanceData.set(placeholder.id, {
      inputSlotMap,
      outputSlotMap,
      inputTargets,
      outputSources,
    });
  }

  // Re-route parent links that touch a dissolved placeholder.
  const retainedLinks: ScopeLink[] = [];
  for (const link of parentLinks) {
    const originId = getLinkOriginId(link);
    const targetId = getLinkTargetId(link);
    const originData = placeholderIds.has(originId) ? instanceData.get(originId) : null;
    const targetData = placeholderIds.has(targetId) ? instanceData.get(targetId) : null;

    if (!originData && !targetData) {
      retainedLinks.push(link);
      continue;
    }

    const sources = originData
      ? (() => {
          const mappedSlot = originData.outputSlotMap.get(getLinkOriginSlot(link));
          return mappedSlot === undefined
            ? []
            : (originData.outputSources.get(mappedSlot) ?? []);
        })()
      : [{ nodeId: originId, slot: getLinkOriginSlot(link), type: getLinkType(link) }];
    const targets = targetData
      ? (() => {
          const mappedSlot = targetData.inputSlotMap.get(getLinkTargetSlot(link));
          return mappedSlot === undefined
            ? []
            : (targetData.inputTargets.get(mappedSlot) ?? []);
        })()
      : [{ nodeId: targetId, slot: getLinkTargetSlot(link), type: getLinkType(link) }];

    for (const source of sources) {
      for (const targetEnd of targets) {
        rawNewLinks.push({
          origin_id: source.nodeId,
          origin_slot: source.slot,
          target_id: targetEnd.nodeId,
          target_slot: targetEnd.slot,
          type: source.type,
        });
      }
    }
  }

  const finalLinks: ScopeLink[] = [
    ...retainedLinks,
    ...rawNewLinks.map((raw) =>
      makeScopeLink(
        nextLinkId++,
        raw.origin_id,
        raw.origin_slot,
        raw.target_id,
        raw.target_slot,
        raw.type,
        parentSubgraphId,
      ),
    ),
  ];

  const nextParentNodes = rebuildScopeNodeLinkRefs(
    [...parentNodes.filter((n) => !placeholderIds.has(n.id)), ...promotedNodes],
    finalLinks,
  );
  const nextParentGroups = [...parentGroups, ...promotedGroups];

  // Drop the definition only when no other scope still references it.
  const stillReferenced =
    (parentSubgraphId != null &&
      (workflow.nodes ?? []).some((n) => n.type === subgraphId)) ||
    defs.some(
      (sg) =>
        sg.id !== subgraphId &&
        sg.id !== parentSubgraphId &&
        (sg.nodes ?? []).some((n) => n.type === subgraphId),
    ) ||
    // Nested placeholders just promoted into the parent scope keep their own
    // defs; a promoted placeholder of subgraphId itself (self-nesting) cannot
    // exist, so only sibling scopes matter — checked above.
    false;

  const nextDefs = defs
    .filter((sg) => stillReferenced || sg.id !== subgraphId)
    .map((sg) =>
      parentSubgraphId != null && sg.id === parentSubgraphId
        ? {
            ...sg,
            nodes: nextParentNodes,
            links: finalLinks as WorkflowSubgraphLink[],
            groups: nextParentGroups,
          }
        : sg,
    );

  const nextWorkflow: Workflow = {
    ...workflow,
    ...(parentSubgraphId == null
      ? {
          nodes: nextParentNodes,
          links: finalLinks as WorkflowLink[],
          groups: nextParentGroups,
          last_link_id: Math.max(workflow.last_link_id ?? 0, nextLinkId - 1),
        }
      : {}),
    last_node_id: Math.max(workflow.last_node_id ?? 0, nextNodeId - 1),
    definitions: {
      ...(workflow.definitions ?? {}),
      subgraphs: nextDefs,
    },
  };

  return { workflow: nextWorkflow, groupIdMap };
}

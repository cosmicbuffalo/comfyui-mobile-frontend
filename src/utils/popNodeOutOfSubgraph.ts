import type {
  Workflow,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphDefinition,
  WorkflowSubgraphLink,
} from '@/api/types';
import {
  SUBGRAPH_INPUT_NODE_ID,
  SUBGRAPH_OUTPUT_NODE_ID,
  maxNodeIdAcrossScopes,
} from '@/utils/canonicalWorkflowOps';
import { normalizeSubgraphPlaceholders } from '@/utils/normalizeSubgraphPlaceholders';
import { newBoundarySlotId } from '@/utils/subgraphBoundaryNames';

export type PopOutTerminalKind = 'source' | 'sink';

export interface PopNodeOutResult {
  workflow: Workflow;
  kind: PopOutTerminalKind;
  rootNodeIds: number[];
  addedInputSlots: number;
  addedOutputSlots: number;
}

interface InstanceStep {
  /** The placeholder at this level. The first step is always a root node. */
  nodeId: number;
  definitionId: string;
}

interface IncomingEndpoint {
  originId: number;
  originSlot: number;
  type: string;
  targetSlots: number[];
}

/**
 * A pop-out can preserve a terminal node without inventing relay nodes only
 * when its connected side ends at ordinary nodes in its own definition.
 * Boundary-connected terminals need instance-value/external-link tracing and
 * are deliberately withheld until that representation is available.
 */
export function getPopOutTerminalKind(
  definition: WorkflowSubgraphDefinition | null | undefined,
  nodeId: number,
): PopOutTerminalKind | null {
  if (!definition) return null;
  const incoming = definition.links.filter((link) => link.target_id === nodeId);
  const outgoing = definition.links.filter((link) => link.origin_id === nodeId);
  if (
    incoming.length === 0
    && outgoing.length > 0
    && outgoing.every((link) => link.target_id >= 0)
  ) {
    return 'source';
  }
  if (
    outgoing.length === 0
    && incoming.length > 0
    && incoming.every((link) => link.origin_id >= 0)
  ) {
    return 'sink';
  }
  return null;
}

function collectInstancePaths(workflow: Workflow, targetDefinitionId: string): InstanceStep[][] {
  const definitions = new Map(
    (workflow.definitions?.subgraphs ?? []).map((definition) => [definition.id, definition]),
  );
  const paths: InstanceStep[][] = [];

  const visit = (
    nodes: WorkflowNode[],
    prefix: InstanceStep[],
    activeDefinitions: Set<string>,
  ) => {
    for (const node of nodes) {
      const definition = definitions.get(node.type);
      if (!definition || activeDefinitions.has(definition.id)) continue;
      const path = [...prefix, { nodeId: node.id, definitionId: definition.id }];
      if (definition.id === targetDefinitionId) {
        paths.push(path);
        continue;
      }
      visit(
        definition.nodes ?? [],
        path,
        new Set([...activeDefinitions, definition.id]),
      );
    }
  };

  visit(workflow.nodes ?? [], [], new Set());
  return paths;
}

function clearNodeLinks(node: WorkflowNode, id: number, position: [number, number]): WorkflowNode {
  return {
    ...structuredClone(node),
    id,
    itemKey: undefined,
    pos: position,
    order: id,
    inputs: (node.inputs ?? []).map((input) => ({ ...structuredClone(input), link: null })),
    outputs: (node.outputs ?? []).map((output) => ({ ...structuredClone(output), links: null })),
    properties: structuredClone(node.properties ?? {}),
  };
}

function uniqueSlotName(
  slots: Array<{ name?: string }> | undefined,
  preferred: string,
): string {
  const base = preferred.trim().replace(/\s+/g, '_') || 'value';
  const used = new Set((slots ?? []).map((slot) => slot.name));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function rebuildNodeLinkRefs(
  nodes: WorkflowNode[],
  links: WorkflowLink[] | WorkflowSubgraphLink[],
): WorkflowNode[] {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number[]>();
  for (const link of links) {
    const id = Array.isArray(link) ? link[0] : link.id;
    const originId = Array.isArray(link) ? link[1] : link.origin_id;
    const originSlot = Array.isArray(link) ? link[2] : link.origin_slot;
    const targetId = Array.isArray(link) ? link[3] : link.target_id;
    const targetSlot = Array.isArray(link) ? link[4] : link.target_slot;
    if (targetId >= 0) incoming.set(`${targetId}:${targetSlot}`, id);
    if (originId >= 0) {
      const key = `${originId}:${originSlot}`;
      const ids = outgoing.get(key) ?? [];
      ids.push(id);
      outgoing.set(key, ids);
    }
  }
  return nodes.map((node) => ({
    ...node,
    inputs: (node.inputs ?? []).map((input, index) => ({
      ...input,
      link: incoming.get(`${node.id}:${index}`) ?? null,
    })),
    outputs: (node.outputs ?? []).map((output, index) => {
      const ids = outgoing.get(`${node.id}:${index}`) ?? [];
      return { ...output, links: ids.length > 0 ? ids : null };
    }),
  }));
}

function rebuildDefinitionCaches(definition: WorkflowSubgraphDefinition): void {
  definition.inputs = (definition.inputs ?? []).map((slot, slotIndex) => ({
    ...slot,
    linkIds: definition.links
      .filter((link) => link.origin_id === SUBGRAPH_INPUT_NODE_ID && link.origin_slot === slotIndex)
      .map((link) => link.id),
  }));
  definition.outputs = (definition.outputs ?? []).map((slot, slotIndex) => ({
    ...slot,
    linkIds: definition.links
      .filter((link) => link.target_id === SUBGRAPH_OUTPUT_NODE_ID && link.target_slot === slotIndex)
      .map((link) => link.id),
  }));
}

/**
 * Move one terminal node from a subgraph definition all the way to root.
 *
 * Source terminal (outgoing links only): one root node feeds a newly promoted
 * input through every concrete instance path. Sink terminal (incoming links
 * only): each concrete instance path gets its own root clone, fed through
 * output slots promoted outward along that path.
 */
export function popNodeOutOfSubgraph(
  workflow: Workflow,
  subgraphId: string,
  nodeId: number,
): PopNodeOutResult | null {
  const paths = collectInstancePaths(workflow, subgraphId);
  if (paths.length === 0) return null;

  const next = structuredClone(workflow);
  const definitions = new Map(
    (next.definitions?.subgraphs ?? []).map((definition) => [definition.id, definition]),
  );
  const target = definitions.get(subgraphId);
  const node = target?.nodes.find((candidate) => candidate.id === nodeId);
  const kind = getPopOutTerminalKind(target, nodeId);
  if (!target || !node || !kind) return null;

  let nextNodeId = maxNodeIdAcrossScopes(next) + 1;
  let nextRootLinkId = Math.max(
    next.last_link_id ?? 0,
    ...(next.links ?? []).map((link) => link[0]),
    0,
  ) + 1;
  const nextDefinitionLinkId = new Map<string, number>();
  const allocateDefinitionLinkId = (definition: WorkflowSubgraphDefinition) => {
    const id = nextDefinitionLinkId.get(definition.id)
      ?? (Math.max(0, ...definition.links.map((link) => link.id)) + 1);
    nextDefinitionLinkId.set(definition.id, id + 1);
    return id;
  };
  const addDefinitionLink = (
    definition: WorkflowSubgraphDefinition,
    originId: number,
    originSlot: number,
    targetId: number,
    targetSlot: number,
    type: string,
  ) => {
    const duplicate = definition.links.some(
      (link) => link.origin_id === originId
        && link.origin_slot === originSlot
        && link.target_id === targetId
        && link.target_slot === targetSlot,
    );
    if (duplicate) return;
    definition.links.push({
      id: allocateDefinitionLinkId(definition),
      origin_id: originId,
      origin_slot: originSlot,
      target_id: targetId,
      target_slot: targetSlot,
      type,
    });
  };
  const addRootLink = (
    originId: number,
    originSlot: number,
    targetId: number,
    targetSlot: number,
    type: string,
  ) => {
    const duplicate = next.links.some(
      (link) => link[1] === originId
        && link[2] === originSlot
        && link[3] === targetId
        && link[4] === targetSlot,
    );
    if (duplicate) return;
    next.links.push([nextRootLinkId++, originId, originSlot, targetId, targetSlot, type]);
  };

  const involvedLinkIds = new Set(
    target.links
      .filter((link) => link.origin_id === nodeId || link.target_id === nodeId)
      .map((link) => link.id),
  );
  const originalLinks = target.links.filter((link) => involvedLinkIds.has(link.id));
  target.nodes = target.nodes.filter((candidate) => candidate.id !== nodeId);
  target.links = target.links.filter((link) => !involvedLinkIds.has(link.id));

  const rootNodeIds: number[] = [];
  let addedInputSlots = 0;
  let addedOutputSlots = 0;

  if (kind === 'source') {
    const firstRootPlaceholder = next.nodes.find((candidate) => candidate.id === paths[0]?.[0]?.nodeId);
    const rootNodeId = nextNodeId++;
    const position: [number, number] = firstRootPlaceholder
      ? [firstRootPlaceholder.pos[0] - (node.size?.[0] ?? 200) - 80, firstRootPlaceholder.pos[1]]
      : [node.pos[0], node.pos[1]];
    next.nodes.push(clearNodeLinks(node, rootNodeId, position));
    rootNodeIds.push(rootNodeId);

    const byOutput = new Map<number, WorkflowSubgraphLink[]>();
    for (const link of originalLinks) {
      const links = byOutput.get(link.origin_slot) ?? [];
      links.push(link);
      byOutput.set(link.origin_slot, links);
    }

    for (const [outputSlot, links] of byOutput) {
      const output = node.outputs?.[outputSlot];
      const type = String(output?.type ?? links[0]?.type ?? '*');
      const label = output?.label || output?.localized_name || output?.name || `Output ${outputSlot + 1}`;
      const targetInputSlot = (target.inputs ?? []).length;
      target.inputs = [
        ...(target.inputs ?? []),
        {
          id: newBoundarySlotId(),
          name: uniqueSlotName(target.inputs, output?.name || label),
          label,
          type,
          linkIds: [],
        },
      ];
      addedInputSlots += 1;
      for (const link of links) {
        addDefinitionLink(
          target,
          SUBGRAPH_INPUT_NODE_ID,
          targetInputSlot,
          link.target_id,
          link.target_slot,
          link.type,
        );
      }

      const ancestorInputSlot = new Map<string, number>([[subgraphId, targetInputSlot]]);
      const ensureAncestorInput = (definitionId: string) => {
        const existing = ancestorInputSlot.get(definitionId);
        if (existing != null) return existing;
        const definition = definitions.get(definitionId)!;
        const slot = (definition.inputs ?? []).length;
        definition.inputs = [
          ...(definition.inputs ?? []),
          {
            id: newBoundarySlotId(),
            name: uniqueSlotName(definition.inputs, output?.name || label),
            label,
            type,
            linkIds: [],
          },
        ];
        ancestorInputSlot.set(definitionId, slot);
        addedInputSlots += 1;
        return slot;
      };

      for (const path of paths) {
        let childInputSlot = targetInputSlot;
        for (let index = path.length - 1; index >= 0; index -= 1) {
          const placeholder = path[index];
          if (index === 0) {
            addRootLink(rootNodeId, outputSlot, placeholder.nodeId, childInputSlot, type);
            continue;
          }
          const parentDefinitionId = path[index - 1].definitionId;
          const parentDefinition = definitions.get(parentDefinitionId);
          if (!parentDefinition) continue;
          const parentInputSlot = ensureAncestorInput(parentDefinitionId);
          addDefinitionLink(
            parentDefinition,
            SUBGRAPH_INPUT_NODE_ID,
            parentInputSlot,
            placeholder.nodeId,
            childInputSlot,
            type,
          );
          childInputSlot = parentInputSlot;
        }
      }
    }
  } else {
    const incomingBySource = new Map<string, IncomingEndpoint>();
    for (const link of originalLinks) {
      const key = `${link.origin_id}:${link.origin_slot}`;
      const endpoint = incomingBySource.get(key) ?? {
        originId: link.origin_id,
        originSlot: link.origin_slot,
        type: link.type,
        targetSlots: [],
      };
      endpoint.targetSlots.push(link.target_slot);
      incomingBySource.set(key, endpoint);
    }

    const targetOutputSlotBySource = new Map<string, number>();
    for (const [key, endpoint] of incomingBySource) {
      const sourceNode = target.nodes.find((candidate) => candidate.id === endpoint.originId);
      const output = sourceNode?.outputs?.[endpoint.originSlot];
      const label = output?.label || output?.localized_name || output?.name || `Output ${endpoint.originSlot + 1}`;
      const slot = (target.outputs ?? []).length;
      target.outputs = [
        ...(target.outputs ?? []),
        {
          id: newBoundarySlotId(),
          name: uniqueSlotName(target.outputs, output?.name || label),
          label,
          type: endpoint.type,
          linkIds: [],
        },
      ];
      targetOutputSlotBySource.set(key, slot);
      addedOutputSlots += 1;
      addDefinitionLink(
        target,
        endpoint.originId,
        endpoint.originSlot,
        SUBGRAPH_OUTPUT_NODE_ID,
        slot,
        endpoint.type,
      );
    }

    const ancestorOutputSlot = new Map<string, number>();
    paths.forEach((path, pathIndex) => {
      const rootPlaceholder = next.nodes.find((candidate) => candidate.id === path[0]?.nodeId);
      const rootNodeId = nextNodeId++;
      const position: [number, number] = rootPlaceholder
        ? [
            rootPlaceholder.pos[0] + (rootPlaceholder.size?.[0] ?? 200) + 80,
            rootPlaceholder.pos[1] + pathIndex * ((node.size?.[1] ?? 100) + 30),
          ]
        : [node.pos[0], node.pos[1] + pathIndex * ((node.size?.[1] ?? 100) + 30)];
      next.nodes.push(clearNodeLinks(node, rootNodeId, position));
      rootNodeIds.push(rootNodeId);

      for (const [key, endpoint] of incomingBySource) {
        let childOutputSlot = targetOutputSlotBySource.get(key)!;
        for (let index = path.length - 1; index > 0; index -= 1) {
          const childPlaceholder = path[index];
          const parentDefinitionId = path[index - 1].definitionId;
          const parentDefinition = definitions.get(parentDefinitionId);
          if (!parentDefinition) continue;
          const ancestorKey = `${parentDefinitionId}:${childPlaceholder.nodeId}:${childOutputSlot}`;
          let parentOutputSlot = ancestorOutputSlot.get(ancestorKey);
          if (parentOutputSlot == null) {
            parentOutputSlot = (parentDefinition.outputs ?? []).length;
            const input = node.inputs?.[endpoint.targetSlots[0]];
            const label = input?.label || input?.localized_name || input?.name || endpoint.type;
            parentDefinition.outputs = [
              ...(parentDefinition.outputs ?? []),
              {
                id: newBoundarySlotId(),
                name: uniqueSlotName(parentDefinition.outputs, label),
                label,
                type: endpoint.type,
                linkIds: [],
              },
            ];
            ancestorOutputSlot.set(ancestorKey, parentOutputSlot);
            addedOutputSlots += 1;
            addDefinitionLink(
              parentDefinition,
              childPlaceholder.nodeId,
              childOutputSlot,
              SUBGRAPH_OUTPUT_NODE_ID,
              parentOutputSlot,
              endpoint.type,
            );
          }
          childOutputSlot = parentOutputSlot;
        }

        const topPlaceholder = path[0];
        for (const targetSlot of endpoint.targetSlots) {
          addRootLink(
            topPlaceholder.nodeId,
            childOutputSlot,
            rootNodeId,
            targetSlot,
            endpoint.type,
          );
        }
      }
    });
  }

  for (const definition of definitions.values()) rebuildDefinitionCaches(definition);
  next.last_node_id = Math.max(next.last_node_id ?? 0, nextNodeId - 1);
  next.last_link_id = Math.max(next.last_link_id ?? 0, nextRootLinkId - 1);

  const normalized = normalizeSubgraphPlaceholders(next);
  normalized.nodes = rebuildNodeLinkRefs(normalized.nodes, normalized.links);
  for (const definition of normalized.definitions?.subgraphs ?? []) {
    definition.nodes = rebuildNodeLinkRefs(definition.nodes, definition.links);
    rebuildDefinitionCaches(definition);
  }

  return {
    workflow: normalized,
    kind,
    rootNodeIds,
    addedInputSlots,
    addedOutputSlots,
  };
}

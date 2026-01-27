import type {
  Workflow,
  WorkflowNode,
  WorkflowLink,
  WorkflowSubgraphDefinition,
  WorkflowSubgraphLink
} from '@/api/types';

type RawLink = Omit<WorkflowSubgraphLink, 'id'>;
const MOBILE_ORIGIN_KEY = '__mobile_origin';
const MOBILE_SUBGRAPH_GROUP_MAP_KEY = '__mobile_subgraph_group_map';
type MobileOrigin =
  | { scope: 'root'; nodeId: number }
  | { scope: 'subgraph'; subgraphId: string; nodeId: number };

function cloneNode(node: WorkflowNode, id: number, origin?: MobileOrigin): WorkflowNode {
  const properties = { ...(node.properties ?? {}) } as Record<string, unknown>;
  if (origin && properties[MOBILE_ORIGIN_KEY] === undefined) {
    properties[MOBILE_ORIGIN_KEY] = origin;
  }
  return {
    ...node,
    id,
    inputs: (node.inputs ?? []).map((input) => ({ ...input, link: null })),
    outputs: (node.outputs ?? []).map((output) => ({ ...output, links: [] })),
    widgets_values: node.widgets_values ?? [],
    flags: node.flags ?? {},
    properties,
    mode: node.mode ?? 0,
    order: node.order ?? 0
  };
}

function getGroupIdForNode(
  node: WorkflowNode,
  groups: Workflow['groups']
): number | null {
  if (!groups || groups.length === 0) return null;
  const sortedGroups = [...groups].sort((a, b) => a.id - b.id);
  const [nodeX, nodeY] = node.pos;
  const [nodeWidth, nodeHeight] = node.size;
  const centerX = nodeX + nodeWidth / 2;
  const centerY = nodeY + nodeHeight / 2;

  for (const group of sortedGroups) {
    const [groupX, groupY, groupWidth, groupHeight] = group.bounding;
    if (
      centerX >= groupX &&
      centerX <= groupX + groupWidth &&
      centerY >= groupY &&
      centerY <= groupY + groupHeight
    ) {
      return group.id;
    }
  }
  return null;
}

function buildSlotMap(
  parentEntries: Array<{ name?: string }>,
  subgraphEntries: Array<{ name?: string }>
): Map<number, number> {
  const slotMap = new Map<number, number>();
  const subgraphByName = new Map<string, number>();
  subgraphEntries.forEach((entry, index) => {
    if (entry?.name) subgraphByName.set(entry.name, index);
  });

  parentEntries.forEach((entry, index) => {
    const name = entry?.name;
    if (name && subgraphByName.has(name)) {
      slotMap.set(index, subgraphByName.get(name)!);
      return;
    }
    if (index < subgraphEntries.length) {
      slotMap.set(index, index);
    }
  });

  return slotMap;
}

function rebuildNodeLinks(nodes: WorkflowNode[], links: WorkflowLink[]): WorkflowNode[] {
  const nodeMap = new Map<number, WorkflowNode>();
  for (const node of nodes) {
    node.inputs = (node.inputs ?? []).map((input) => ({ ...input, link: null }));
    node.outputs = (node.outputs ?? []).map((output) => ({
      ...output,
      links: []
    }));
    nodeMap.set(node.id, node);
  }

  for (const link of links) {
    const [linkId, originId, originSlot, targetId, targetSlot] = link;
    const originNode = nodeMap.get(originId);
    const targetNode = nodeMap.get(targetId);
    const originOutput = originNode?.outputs?.[originSlot];
    const targetInput = targetNode?.inputs?.[targetSlot];

    if (originOutput) {
      if (!originOutput.links) {
        originOutput.links = [];
      }
      originOutput.links.push(linkId);
    }
    if (targetInput) {
      targetInput.link = linkId;
    }
  }

  return nodes;
}

function expandWorkflowSubgraphsOnce(
  workflow: Workflow,
  subgraphMap: Map<string, WorkflowSubgraphDefinition>
): { workflow: Workflow; changed: boolean } {
  const placeholderNodes = workflow.nodes.filter((node) => subgraphMap.has(node.type));
  if (placeholderNodes.length === 0) {
    return { workflow, changed: false };
  }

  const placeholderIds = new Set(placeholderNodes.map((node) => node.id));
  let nextNodeId = Math.max(0, ...workflow.nodes.map((node) => node.id)) + 1;
  const newNodes: WorkflowNode[] = [];
  const groups = workflow.groups ?? [];
  const extra = (workflow.extra ?? {}) as Record<string, unknown>;
  const previousGroupMap =
    typeof extra[MOBILE_SUBGRAPH_GROUP_MAP_KEY] === 'object' &&
    extra[MOBILE_SUBGRAPH_GROUP_MAP_KEY] !== null
      ? (extra[MOBILE_SUBGRAPH_GROUP_MAP_KEY] as Record<string, unknown>)
      : {};
  const subgraphGroupMap: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(previousGroupMap)) {
    if (typeof value === 'number' || value === null) {
      subgraphGroupMap[key] = value;
    }
  }

  const placeholderData = new Map<
    number,
    {
      inputSlotMap: Map<number, number>;
      outputSlotMap: Map<number, number>;
      inputTargets: Map<number, Array<RawLink>>;
      outputSources: Map<number, Array<RawLink>>;
      internalLinks: RawLink[];
    }
  >();

  for (const node of workflow.nodes) {
    if (!placeholderIds.has(node.id)) {
      newNodes.push(cloneNode(node, node.id, { scope: 'root', nodeId: node.id }));
      continue;
    }

    const subgraph = subgraphMap.get(node.type);
    if (!subgraph) {
      newNodes.push(cloneNode(node, node.id, { scope: 'root', nodeId: node.id }));
      continue;
    }
    const groupId = getGroupIdForNode(node, groups);
    subgraphGroupMap[subgraph.id] = groupId ?? null;

    const inputSlotMap = buildSlotMap(node.inputs ?? [], subgraph.inputs ?? []);
    const outputSlotMap = buildSlotMap(node.outputs ?? [], subgraph.outputs ?? []);
    const nodeIdMap = new Map<number, number>();
    const inputTargets = new Map<number, Array<RawLink>>();
    const outputSources = new Map<number, Array<RawLink>>();
    const internalLinks: RawLink[] = [];

    for (const subNode of subgraph.nodes ?? []) {
      const mappedId = nextNodeId++;
      nodeIdMap.set(subNode.id, mappedId);
      newNodes.push(
        cloneNode(subNode, mappedId, { scope: 'subgraph', subgraphId: subgraph.id, nodeId: subNode.id })
      );
    }

    for (const subLink of subgraph.links ?? []) {
      const originId = subLink.origin_id;
      const targetId = subLink.target_id;

      if (originId === -10) {
        const mappedTarget = nodeIdMap.get(targetId);
        if (mappedTarget !== undefined) {
          const targets = inputTargets.get(subLink.origin_slot) ?? [];
          targets.push({
            origin_id: -10,
            origin_slot: subLink.origin_slot,
            target_id: mappedTarget,
            target_slot: subLink.target_slot,
            type: subLink.type
          });
          inputTargets.set(subLink.origin_slot, targets);
        }
        continue;
      }

      if (targetId === -20) {
        const mappedOrigin = nodeIdMap.get(originId);
        if (mappedOrigin !== undefined) {
          const sources = outputSources.get(subLink.target_slot) ?? [];
          sources.push({
            origin_id: mappedOrigin,
            origin_slot: subLink.origin_slot,
            target_id: -20,
            target_slot: subLink.target_slot,
            type: subLink.type
          });
          outputSources.set(subLink.target_slot, sources);
        }
        continue;
      }

      const mappedOrigin = nodeIdMap.get(originId);
      const mappedTarget = nodeIdMap.get(targetId);
      if (mappedOrigin !== undefined && mappedTarget !== undefined) {
        internalLinks.push({
          origin_id: mappedOrigin,
          origin_slot: subLink.origin_slot,
          target_id: mappedTarget,
          target_slot: subLink.target_slot,
          type: subLink.type
        });
      }
    }

    placeholderData.set(node.id, {
      inputSlotMap,
      outputSlotMap,
      inputTargets,
      outputSources,
      internalLinks
    });
  }

  const rawLinks: RawLink[] = [];
  const baseLinks = workflow.links ?? [];

  for (const link of baseLinks) {
    const [, originId, originSlot, targetId, targetSlot, type] = link;
    const originIsPlaceholder = placeholderIds.has(originId);
    const targetIsPlaceholder = placeholderIds.has(targetId);

    if (!originIsPlaceholder && !targetIsPlaceholder) {
      rawLinks.push({
        origin_id: originId,
        origin_slot: originSlot,
        target_id: targetId,
        target_slot: targetSlot,
        type
      });
      continue;
    }

    if (originIsPlaceholder && targetIsPlaceholder) {
      const originData = placeholderData.get(originId);
      const targetData = placeholderData.get(targetId);
      const mappedOriginSlot = originData?.outputSlotMap.get(originSlot);
      const mappedTargetSlot = targetData?.inputSlotMap.get(targetSlot);
      if (mappedOriginSlot === undefined || mappedTargetSlot === undefined) continue;
      const sources = originData?.outputSources.get(mappedOriginSlot) ?? [];
      const targets = targetData?.inputTargets.get(mappedTargetSlot) ?? [];
      for (const source of sources) {
        for (const target of targets) {
          rawLinks.push({
            origin_id: source.origin_id,
            origin_slot: source.origin_slot,
            target_id: target.target_id,
            target_slot: target.target_slot,
            type: source.type
          });
        }
      }
      continue;
    }

    if (originIsPlaceholder) {
      const originData = placeholderData.get(originId);
      const mappedSlot = originData?.outputSlotMap.get(originSlot);
      if (mappedSlot === undefined) continue;
      const sources = originData?.outputSources.get(mappedSlot) ?? [];
      for (const source of sources) {
        rawLinks.push({
          origin_id: source.origin_id,
          origin_slot: source.origin_slot,
          target_id: targetId,
          target_slot: targetSlot,
          type: source.type
        });
      }
      continue;
    }

    if (targetIsPlaceholder) {
      const targetData = placeholderData.get(targetId);
      const mappedSlot = targetData?.inputSlotMap.get(targetSlot);
      if (mappedSlot === undefined) continue;
      const targets = targetData?.inputTargets.get(mappedSlot) ?? [];
      for (const target of targets) {
        rawLinks.push({
          origin_id: originId,
          origin_slot: originSlot,
          target_id: target.target_id,
          target_slot: target.target_slot,
          type: target.type
        });
      }
    }
  }

  for (const data of placeholderData.values()) {
    rawLinks.push(...data.internalLinks);
  }

  const links: WorkflowLink[] = rawLinks.map((link, index) => [
    index + 1,
    link.origin_id,
    link.origin_slot,
    link.target_id,
    link.target_slot,
    link.type
  ]);

  rebuildNodeLinks(newNodes, links);

  return {
    workflow: {
      ...workflow,
      extra: {
        ...extra,
        [MOBILE_SUBGRAPH_GROUP_MAP_KEY]: subgraphGroupMap
      },
      nodes: newNodes,
      links,
      last_node_id: Math.max(0, ...newNodes.map((node) => node.id)),
      last_link_id: links.length
    },
    changed: true
  };
}

export function expandWorkflowSubgraphs(workflow: Workflow): Workflow {
  const subgraphs = workflow.definitions?.subgraphs ?? [];
  if (subgraphs.length === 0) return workflow;

  const subgraphMap = new Map<string, WorkflowSubgraphDefinition>();
  for (const subgraph of subgraphs) {
    if (subgraph?.id) {
      subgraphMap.set(subgraph.id, subgraph);
    }
  }

  let current = workflow;
  for (let i = 0; i < subgraphs.length + 4; i += 1) {
    const { workflow: next, changed } = expandWorkflowSubgraphsOnce(current, subgraphMap);
    if (!changed) break;
    current = next;
  }

  return current;
}

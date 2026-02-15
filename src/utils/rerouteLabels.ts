import type { Workflow } from '@/api/types';

export function resolveRerouteConnectionLabel(
  workflow: Workflow,
  nodeId: number,
  direction: 'input' | 'output',
  fallback: string
): string {
  const node = workflow.nodes.find((item) => item.id === nodeId);
  if (!node) return fallback;
  if (node.type !== 'Reroute') return fallback;

  let upstreamLabel: string | null = null;
  const downstreamLabels: string[] = [];
  const seenDownstreamLabels = new Set<string>();

  const inputLinkId = node.inputs[0]?.link;
  if (inputLinkId != null) {
    const link = workflow.links.find((item) => item[0] === inputLinkId);
    if (link) {
      const sourceNodeId = link[1];
      const sourceSlotIndex = link[2];
      const sourceNode = workflow.nodes.find((item) => item.id === sourceNodeId);
      const outputSlot = sourceNode?.outputs[sourceSlotIndex];
      upstreamLabel = outputSlot?.localized_name || outputSlot?.name || null;
    }
  }

  for (const output of node.outputs) {
    const outputLinkIds = output.links ?? [];
    for (const linkId of outputLinkIds) {
      const link = workflow.links.find((item) => item[0] === linkId);
      if (!link) continue;
      const targetNodeId = link[3];
      const targetSlotIndex = link[4];
      const targetNode = workflow.nodes.find((item) => item.id === targetNodeId);
      const inputSlot = targetNode?.inputs[targetSlotIndex];
      const downstreamLabel = inputSlot?.localized_name || inputSlot?.name || null;
      if (downstreamLabel && !seenDownstreamLabels.has(downstreamLabel)) {
        seenDownstreamLabels.add(downstreamLabel);
        downstreamLabels.push(downstreamLabel);
      }
    }
  }
  const downstreamCombined = downstreamLabels
    .map((label, index) => (index < downstreamLabels.length - 1 ? `${label}/` : label))
    .join('\n');

  if (downstreamLabels.length > 1) {
    return downstreamCombined;
  }

  if (direction === 'input') {
    return upstreamLabel || downstreamCombined || fallback;
  }
  return downstreamCombined || upstreamLabel || fallback;
}

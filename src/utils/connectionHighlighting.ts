import type { WorkflowNode } from '@/api/types';

export type ConnectionHighlightMode = 'off' | 'inputs' | 'outputs' | 'both';

export function resolveConnectionHighlightSources(
  nodes: WorkflowNode[],
  modes: Record<string, ConnectionHighlightMode>,
): Array<{ node: WorkflowNode; mode: Exclude<ConnectionHighlightMode, 'off'> }> {
  const nodesByItemKey = new Map(
    nodes.flatMap((node) => (node.itemKey ? [[node.itemKey, node] as const] : [])),
  );
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  return Object.entries(modes).flatMap(([itemKey, mode]) => {
    if (mode === 'off') return [];

    const legacyNodeId = Number(itemKey);
    const node = nodesByItemKey.get(itemKey)
      ?? (Number.isFinite(legacyNodeId) ? nodesById.get(legacyNodeId) : undefined);

    return node ? [{ node, mode }] : [];
  });
}

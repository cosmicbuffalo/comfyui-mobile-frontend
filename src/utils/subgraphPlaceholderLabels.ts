import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';

export function findRootWorkflowNodeById(
  canonicalWorkflow: Workflow | null,
  nodeId: number
): WorkflowNode | null {
  if (!canonicalWorkflow) return null;
  return canonicalWorkflow.nodes.find((entry) => entry.id === nodeId) ?? null;
}

export function findWorkflowNodeInScope(
  canonicalWorkflow: Workflow | null,
  nodeId: number,
  subgraphId: string | null,
): WorkflowNode | null {
  if (!canonicalWorkflow) return null;
  if (subgraphId == null) {
    return findRootWorkflowNodeById(canonicalWorkflow, nodeId);
  }
  const subgraph = canonicalWorkflow.definitions?.subgraphs?.find(
    (entry) => entry.id === subgraphId,
  );
  return (subgraph?.nodes ?? []).find((entry) => entry.id === nodeId) ?? null;
}

export function resolveWorkflowNodeDisplayName(
  canonicalWorkflow: Workflow | null,
  node: WorkflowNode,
  nodeTypes: NodeTypes | null
): string {
  const nodeTitle = typeof node.title === 'string' && node.title.trim()
    ? node.title.trim()
    : null;
  if (nodeTitle) return nodeTitle;

  const subgraphName = canonicalWorkflow?.definitions?.subgraphs?.find(
    (subgraph) => subgraph.id === node.type
  )?.name?.trim();
  if (subgraphName) return subgraphName;

  return nodeTypes?.[node.type]?.display_name || node.type;
}

/**
 * Resolve connection labels for subgraph placeholder nodes.
 *
 * Mirrors ComfyUI frontend behavior: display label = label ?? localized_name ?? name.
 * The `label` field holds user-authored display names (e.g. "model_high_fromLora"),
 * while `name` is the internal slot identifier (e.g. "model").
 */
export function resolveSubgraphPlaceholderConnectionLabel(
  canonicalWorkflow: Workflow | null,
  nodeId: number,
  direction: 'input' | 'output',
  slotIndex: number,
  fallback: string,
  subgraphId: string | null = null,
): string {
  if (!canonicalWorkflow) return fallback;

  const node = findWorkflowNodeInScope(canonicalWorkflow, nodeId, subgraphId);
  if (!node) return fallback;

  const subgraph = canonicalWorkflow.definitions?.subgraphs?.find(
    (entry) => entry.id === node.type
  );
  if (!subgraph) return fallback;

  // Prefer the node slot's label > localized_name > name (mirrors ComfyUI: label ?? localized_name ?? name)
  const nodeSlot = direction === 'input'
    ? node.inputs?.[slotIndex]
    : node.outputs?.[slotIndex];
  const nodeSlotLabel = (nodeSlot?.label || nodeSlot?.localized_name || nodeSlot?.name)?.trim();
  if (nodeSlotLabel) return nodeSlotLabel;

  // Fall back to subgraph boundary slot with same priority
  const boundarySlot = direction === 'input'
    ? subgraph.inputs?.[slotIndex]
    : subgraph.outputs?.[slotIndex];
  const boundaryLabel = (boundarySlot?.label || boundarySlot?.localized_name || boundarySlot?.name)?.trim();
  return boundaryLabel ? boundaryLabel : fallback;
}

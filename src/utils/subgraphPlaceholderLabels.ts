import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { getInstanceNumber } from '@/utils/canonicalWorkflowOps';
import { getInstanceSlotLabel } from '@/utils/boundarySlotLabels';
import { interpolateInstanceLabel } from '@/utils/subgraphInstanceLabels';
import { generatedTitleOf } from '@/utils/materializeSubgraphTitles';

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
  // A title written by the title materializer is not the user's name for this
  // node — it is a rendering of the type's, kept where other frontends can read
  // it. Rendering live from the type below keeps a rename showing immediately
  // instead of waiting for the next save.
  if (nodeTitle && nodeTitle !== generatedTitleOf(node)) return nodeTitle;

  const subgraphName = canonicalWorkflow?.definitions?.subgraphs?.find(
    (subgraph) => subgraph.id === node.type
  )?.name?.trim();
  if (subgraphName) {
    // Shared-definition names may carry the {n} instance token ("Layer {n}").
    const rendered = interpolateInstanceLabel(subgraphName, getInstanceNumber(node));
    if (rendered) return rendered;
  }

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

  const instanceNumber = getInstanceNumber(node);
  const boundarySlot = direction === 'input'
    ? subgraph.inputs?.[slotIndex]
    : subgraph.outputs?.[slotIndex];

  // Prefer THIS instance's own override (properties, see boundarySlotLabels) >
  // the definition's boundary label (shared across instances) > the node slot's
  // own label > localized_name > name (mirrors ComfyUI: label ?? localized_name
  // ?? name). Both edit levels may carry the {n} instance token.
  //
  // The definition outranks the node slot because the node slot is a CACHE of
  // it — `applyBoundaryPresentation` overwrites it from the boundary on every
  // normalization. Reading the cache first meant renaming a type's slot changed
  // nothing on screen until something happened to re-seat the placeholders.
  const nodeSlot = direction === 'input'
    ? node.inputs?.[slotIndex]
    : node.outputs?.[slotIndex];
  const instanceLabel = boundarySlot?.name
    ? getInstanceSlotLabel(node, direction, boundarySlot.name)
    : null;
  const nodeSlotLabel = (
    instanceLabel || boundarySlot?.label || nodeSlot?.label || nodeSlot?.localized_name || nodeSlot?.name
  )?.trim();
  if (nodeSlotLabel) {
    return interpolateInstanceLabel(nodeSlotLabel, instanceNumber) || fallback;
  }

  // Fall back to subgraph boundary slot with same priority
  const boundaryLabel = (boundarySlot?.label || boundarySlot?.localized_name || boundarySlot?.name)?.trim();
  return boundaryLabel
    ? interpolateInstanceLabel(boundaryLabel, instanceNumber) || fallback
    : fallback;
}

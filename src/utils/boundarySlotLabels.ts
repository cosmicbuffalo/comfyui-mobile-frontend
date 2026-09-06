import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import { getInstanceNumber } from '@/utils/canonicalWorkflowOps';
import { interpolateInstanceLabel } from '@/utils/subgraphInstanceLabels';

/**
 * Per-instance boundary slot labels.
 *
 * A boundary slot's label has two homes, because it answers two different
 * questions: what this port is called on the type, and what it is called on
 * one particular instance of it.
 *
 * *All instances* lives on the definition's boundary entry
 * (`definitions.subgraphs[*].inputs[i].label`) — the field ComfyUI itself
 * writes and reads.
 *
 * *This instance* CANNOT live on the placeholder's own slot `label`, which is
 * the obvious-looking home and the wrong one: both ComfyUI's
 * `SubgraphNode.configure` and our `normalizeSubgraphPlaceholders` rebuild a
 * placeholder's slots from the definition on every load, and the definition's
 * label overwrites whatever the instance carried. An override stored there
 * survives until the next load and then silently reverts. So it lives in the
 * placeholder's `properties` instead, which neither side rebuilds — the same
 * place the instance number already lives.
 *
 * Keyed by slot NAME rather than index: names are stable identifiers, while
 * indices shift whenever a slot is added or removed.
 */
export const MOBILE_SLOT_LABELS_PROPERTY = 'mobileSlotLabels';

export type BoundaryDirection = 'input' | 'output';

export function slotLabelKey(direction: BoundaryDirection, slotName: string): string {
  return `${direction}:${slotName}`;
}

/**
 * Key for a proxy widget's override. Proxy widgets are promoted straight from
 * an inner node's widget rather than through a boundary slot, so they have no
 * slot name to key by — but they are labelled the same way and belong in the
 * same map, so one instance's overrides all live together.
 */
export function proxyLabelKey(innerNodeId: number, widgetName: string): string {
  return `proxy:${innerNodeId}:${widgetName}`;
}

/** This instance's override for one proxy widget, or null. */
export function getInstanceProxyLabel(
  node: WorkflowNode | null | undefined,
  innerNodeId: number,
  widgetName: string,
): string | null {
  return getInstanceSlotLabels(node)[proxyLabelKey(innerNodeId, widgetName)] ?? null;
}

/** The instance overrides carried by one placeholder node, never null. */
export function getInstanceSlotLabels(
  node: WorkflowNode | null | undefined,
): Record<string, string> {
  const raw = node?.properties?.[MOBILE_SLOT_LABELS_PROPERTY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return Object.fromEntries(entries);
}

/** This instance's override for one slot, or null when it defers to the type. */
export function getInstanceSlotLabel(
  node: WorkflowNode | null | undefined,
  direction: BoundaryDirection,
  slotName: string,
): string | null {
  return getInstanceSlotLabels(node)[slotLabelKey(direction, slotName)] ?? null;
}

/** The label the type carries for a slot, before any instance override. */
export function getDefinitionSlotLabel(
  def: WorkflowSubgraphDefinition | null | undefined,
  direction: BoundaryDirection,
  slotIndex: number,
): string {
  const slot = (direction === 'input' ? def?.inputs : def?.outputs)?.[slotIndex];
  if (!slot) return '';
  return slot.label || slot.localized_name || slot.name || `#${slotIndex}`;
}

/**
 * What one boundary slot is called, for a given instance.
 *
 * Instance override wins over the type's label, which wins over the slot's
 * localized name and then its raw name. `{n}` interpolates the instance's own
 * number at the end, so either level can carry the template.
 */
export function resolveBoundarySlotLabel(
  def: WorkflowSubgraphDefinition | null | undefined,
  placeholder: WorkflowNode | null | undefined,
  direction: BoundaryDirection,
  slotIndex: number,
): string {
  const slot = (direction === 'input' ? def?.inputs : def?.outputs)?.[slotIndex];
  const fallback = slot?.name || `#${slotIndex}`;
  const template =
    (slot?.name ? getInstanceSlotLabel(placeholder, direction, slot.name) : null) ??
    getDefinitionSlotLabel(def, direction, slotIndex);
  return (
    interpolateInstanceLabel(template, getInstanceNumber(placeholder ?? ({} as WorkflowNode))) ||
    fallback
  );
}

/** Every placeholder of a subgraph type, in every scope, with its own scope id. */
export function collectSubgraphInstances(
  workflow: Workflow | null | undefined,
  subgraphId: string,
): Array<{ node: WorkflowNode; parentSubgraphId: string | null }> {
  if (!workflow) return [];
  const found: Array<{ node: WorkflowNode; parentSubgraphId: string | null }> = [];
  for (const node of workflow.nodes ?? []) {
    if (node.type === subgraphId) found.push({ node, parentSubgraphId: null });
  }
  for (const def of workflow.definitions?.subgraphs ?? []) {
    for (const node of def.nodes ?? []) {
      if (node.type === subgraphId) found.push({ node, parentSubgraphId: def.id });
    }
  }
  return found;
}

/**
 * The instances that disagree with `placeholder` about a slot's label, so the
 * editor can say what the rest of the type looks like rather than implying the
 * label it shows is universal.
 */
export function collectDivergentInstanceLabels(
  workflow: Workflow | null | undefined,
  def: WorkflowSubgraphDefinition | null | undefined,
  current: WorkflowNode | null | undefined,
  direction: BoundaryDirection,
  slotIndex: number,
): Array<{ node: WorkflowNode; label: string }> {
  if (!def) return [];
  const currentLabel = resolveBoundarySlotLabel(def, current, direction, slotIndex);
  return collectSubgraphInstances(workflow, def.id)
    .filter(({ node }) => node.id !== current?.id)
    .map(({ node }) => ({
      node,
      label: resolveBoundarySlotLabel(def, node, direction, slotIndex),
    }))
    .filter(({ label }) => label !== currentLabel);
}

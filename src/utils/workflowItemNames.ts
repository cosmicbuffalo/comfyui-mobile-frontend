import type { NodeTypes, Workflow, WorkflowGroup, WorkflowNode } from '@/api/types';
import { resolveWorkflowNodeDisplayName } from '@/utils/subgraphPlaceholderLabels';
import { getInputWidgetDefinitions, getWidgetDefinitions } from '@/utils/widgetDefinitions';

/**
 * What to call a node, a group or a subgraph placeholder when naming it back to
 * the user away from its card — in the Undo/Redo toast, today.
 *
 * Delegates to the card's own resolver so the toast can never name an edit
 * differently from the card it flashes: that shared path knows a title stamped
 * by the title materializer is a rendering of the type's name, not the user's,
 * and keeps showing a type rename immediately instead of the stale stamp.
 */
export function resolveNodeDisplayName(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
): string {
  return resolveWorkflowNodeDisplayName(workflow, node, nodeTypes);
}

/**
 * The widget at one position in `widgets_values`: what it is called under the
 * hood, and what its row draws. Matching label rules: a rename
 * lives on the node's input slot as `label` (the way the desktop frontend
 * stores it), and the widget's own name is the fallback.
 *
 * Combos and plain widgets come from two different definition lists — combos
 * take their own render path, and `getWidgetDefinitions` filters them out — so
 * both are searched here. Returns null when the index names no widget the card
 * would draw, which is the signal to stay at node level.
 */
export function resolveWidgetRow(
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
  widgetIndex: number,
): { name: string; label: string } | null {
  const definition = [
    ...getWidgetDefinitions(nodeTypes, node),
    ...getInputWidgetDefinitions(nodeTypes, node),
  ].find((candidate) => candidate.widgetIndex === widgetIndex);
  if (!definition) return null;
  const slotName = definition.inputName ?? definition.name;
  const rename = node.inputs?.find((input) => input.name === slotName)?.label;
  return {
    // `name` is the identity a recorded position is checked against; `label` is
    // what the row draws, which a rename moves without moving the widget.
    name: definition.name,
    label: typeof rename === 'string' && rename.trim() ? rename.trim() : definition.name,
  };
}

/** Groups draw their title, and fall back to the same "Group" the header shows. */
export function resolveGroupDisplayName(group: WorkflowGroup): string {
  return group.title?.trim() || 'Group';
}

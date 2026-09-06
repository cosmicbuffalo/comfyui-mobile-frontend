import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { SUBGRAPH_INPUT_NODE_ID } from '@/utils/canonicalWorkflowOps';
import { newBoundarySlotId, uniqueBoundaryName } from '@/utils/subgraphBoundaryNames';
import { getWidgetDefinitions } from '@/utils/widgetDefinitions';

/**
 * Promote the widgets of nodes that have just been moved into a subgraph.
 *
 * Moving a node across the boundary is a presentation change — the submitted
 * graph is identical either side of it — so it should be presentation-neutral
 * the other way too: a value the user could see and set before the move should
 * still be settable after it. Without this, moving a prompt encoder in takes
 * its text off the card and leaves it reachable only by entering the subgraph
 * and promoting by hand, which is the manual step this removes.
 *
 * Only widgets the user has actually SET are promoted. Everything else would
 * put a node's whole widget list on the boundary — seven for a KSampler, more
 * for a lora loader — and each promoted widget is another positional entry in
 * `widgets_values` to keep aligned. A value that still matches the node type's
 * default is one nobody has expressed an interest in.
 */

export interface AutoPromoteResult {
  workflow: Workflow;
  /** Boundary input names added, in the order they were added. */
  promoted: string[];
}

/** The value a fresh node of this type would show for a widget. */
function defaultValueFor(
  nodeTypes: NodeTypes | null,
  nodeType: string,
  widgetName: string,
): unknown {
  const groups = nodeTypes?.[nodeType]?.input;
  if (!groups) return undefined;
  for (const group of Object.values(groups)) {
    const spec = (group as Record<string, unknown>)?.[widgetName];
    if (!Array.isArray(spec)) continue;
    const options = spec[1];
    if (options && typeof options === 'object' && 'default' in options) {
      return (options as { default: unknown }).default;
    }
    // A combo's first option is its default when none is declared.
    if (Array.isArray(spec[0])) return spec[0][0];
    return undefined;
  }
  return undefined;
}

/**
 * Whether this widget carries something worth putting on the boundary.
 *
 * With no node definition to compare against — a custom node the server has not
 * described, or a unit test — nothing is promoted rather than guessing, so the
 * move behaves exactly as it did before.
 */
function isWorthPromoting(
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
  widget: { name: string; type: string; value: unknown; connected: boolean },
): boolean {
  if (widget.connected) return false;
  if (widget.value === undefined || widget.value === null || widget.value === '') return false;
  const fallback = defaultValueFor(nodeTypes, node.type, widget.name);
  if (fallback !== undefined) return JSON.stringify(widget.value) !== JSON.stringify(fallback);
  // Plenty of inputs declare no `default` — `CLIPTextEncode.text` and
  // `PrimitiveFloat.value` among them — but the type still implies one, and it
  // is ComfyUI's, not an invention: an unspecified STRING starts empty, a
  // numeric starts at zero, a boolean starts false. A value away from that is
  // one somebody typed. A type we cannot reason about is left alone rather than
  // guessed at, so an unknown custom node behaves as it did before.
  const implied = String(widget.type).toUpperCase();
  if (implied === 'STRING') return typeof widget.value === 'string' && widget.value.trim() !== '';
  if (implied === 'INT' || implied === 'FLOAT') return Number(widget.value) !== 0;
  if (implied === 'BOOLEAN') return widget.value === true;
  return false;
}

/** Every link id in the file — interior ids share the root's allocator. */
function nextLinkId(workflow: Workflow): number {
  let max = workflow.last_link_id ?? 0;
  for (const link of workflow.links ?? []) max = Math.max(max, link[0]);
  for (const definition of workflow.definitions?.subgraphs ?? []) {
    for (const link of definition.links ?? []) max = Math.max(max, link.id);
  }
  return max + 1;
}

export function autoPromoteMovedWidgets(
  workflow: Workflow,
  subgraphId: string,
  movedInnerNodeIds: number[],
  nodeTypes: NodeTypes | null,
): AutoPromoteResult {
  if (!nodeTypes || movedInnerNodeIds.length === 0) return { workflow, promoted: [] };
  const definitions = workflow.definitions?.subgraphs ?? [];
  if (!definitions.some((definition) => definition.id === subgraphId)) {
    return { workflow, promoted: [] };
  }

  const next = structuredClone(workflow) as Workflow;
  const definition = next.definitions!.subgraphs!.find((sg) => sg.id === subgraphId)!;
  const moved = new Set(movedInnerNodeIds);
  let linkId = nextLinkId(next);
  const promoted: string[] = [];

  for (const node of definition.nodes ?? []) {
    if (!moved.has(node.id)) continue;
    for (const widget of getWidgetDefinitions(nodeTypes, node)) {
      if (!isWorthPromoting(nodeTypes, node, widget)) continue;

      const inputName = widget.inputName ?? widget.name;
      let inputSlot = (node.inputs ?? []).findIndex(
        (input) => input.name === inputName || input.widget?.name === inputName,
      );
      // Already fed from somewhere: not ours to take over.
      if (inputSlot >= 0 && node.inputs[inputSlot].link != null) continue;

      const boundaryName = uniqueBoundaryName(
        new Set((definition.inputs ?? []).map((slot) => slot.name ?? '')),
        inputName,
      );
      const inputType = String(
        inputSlot >= 0 ? (node.inputs[inputSlot].type ?? widget.type) : widget.type,
      );

      const materialized = {
        ...(inputSlot >= 0 ? node.inputs[inputSlot] : {}),
        name: inputName,
        type: inputType,
        link: linkId,
        widget: { name: inputName },
      };
      if (inputSlot >= 0) node.inputs[inputSlot] = materialized;
      else {
        node.inputs = [...(node.inputs ?? []), materialized];
        inputSlot = node.inputs.length - 1;
      }

      const boundarySlot = (definition.inputs ?? []).length;
      definition.inputs = [
        ...(definition.inputs ?? []),
        {
          id: newBoundarySlotId((definition.inputs ?? []).map((slot) => slot.id ?? '')),
          name: boundaryName,
          type: inputType,
          linkIds: [linkId],
        },
      ];
      definition.links = [
        ...(definition.links ?? []),
        {
          id: linkId,
          origin_id: SUBGRAPH_INPUT_NODE_ID,
          origin_slot: boundarySlot,
          target_id: node.id,
          target_slot: inputSlot,
          type: inputType,
        },
      ];
      promoted.push(boundaryName);
      linkId += 1;
    }
  }

  if (promoted.length === 0) return { workflow, promoted: [] };

  // No values are written here on purpose. The inner node still holds the value
  // it always held, and reconciling instance values after a boundary change
  // already seeds a newly widget-backed slot from exactly that. Laying the array
  // out here as well would mean guessing which order the instance's existing
  // entries are in — and this move may have dropped a slot too, so that guess is
  // wrong by one. One place owns that ordering; this is not it.
  next.last_link_id = Math.max(next.last_link_id ?? 0, linkId - 1);
  return { workflow: next, promoted };
}

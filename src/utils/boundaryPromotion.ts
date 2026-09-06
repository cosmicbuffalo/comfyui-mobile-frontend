import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import { SUBGRAPH_INPUT_NODE_ID, SUBGRAPH_OUTPUT_NODE_ID } from '@/utils/canonicalWorkflowOps';

export interface BoundaryPromotion {
  direction: 'input' | 'output';
  nodeKey: string;
  slotIndex: number;
}

interface ResolveArgs {
  /** The current scope rendered as a root-shaped workflow (tuple links). */
  scopedWorkflow: Pick<Workflow, 'nodes' | 'links'> | null;
  /** Null at root: there is no boundary to promote onto. */
  currentSubgraphId: string | null;
  /** Hierarchical key of the node the slot belongs to. */
  nodeKey: string | null;
  nodeId: number;
  direction: 'input' | 'output';
  slotIndex: number;
}

/**
 * Whether a slot inside a subgraph can be promoted onto that subgraph's
 * boundary, and with what arguments.
 *
 * Offered only where promoting is a real, non-destructive choice:
 *
 * - at root there is no boundary, so never;
 * - an input must be unwired — a boundary slot and a local link cannot both
 *   drive one input, so promoting a fed input would cut the link feeding it;
 * - an output must not already reach the boundary, but may freely feed inner
 *   nodes as well, since it fans out to both without conflict.
 */
export function resolveBoundaryPromotion({
  scopedWorkflow,
  currentSubgraphId,
  nodeKey,
  nodeId,
  direction,
  slotIndex,
}: ResolveArgs): BoundaryPromotion | null {
  if (!currentSubgraphId || !nodeKey || !scopedWorkflow) return null;
  const node = scopedWorkflow.nodes.find((entry) => entry.id === nodeId);
  if (!node) return null;

  if (direction === 'input') {
    const input = node.inputs?.[slotIndex];
    if (!input || input.link != null) return null;
    return { direction: 'input', nodeKey, slotIndex };
  }

  const output = node.outputs?.[slotIndex];
  if (!output) return null;
  const alreadyPromoted = (output.links ?? []).some((linkId) => {
    const link = scopedWorkflow.links.find((entry) => entry[0] === linkId);
    return link?.[3] === SUBGRAPH_OUTPUT_NODE_ID;
  });
  if (alreadyPromoted) return null;
  return { direction: 'output', nodeKey, slotIndex };
}

/** Key identifying one promoted widget: the inner node that owns it, by name. */
export function promotedWidgetKey(nodeId: number, widgetName: string): string {
  return `${nodeId}:${widgetName}`;
}

/**
 * Which inner widgets a placeholder actually promotes, as `nodeId:widgetName`
 * keys.
 *
 * `properties.proxyWidgets` names the owning node directly for a widget reached
 * straight inside a node (`["1842", "seed"]`), but writes the sentinel `"-1"`
 * for one routed through a boundary input (`["-1", "text"]`) — there the only
 * record of the target is the boundary link itself. Matching those by widget
 * NAME alone lights up every node in the subgraph that happens to own a widget
 * with that name: a subgraph holding two CLIPTextEncode nodes showed both their
 * `text` widgets as promoted when only one was wired to the boundary.
 *
 * So a `-1` entry is resolved through the boundary: boundary slot index, then
 * the links leaving the input node from that slot, to the inner nodes they land
 * on. A boundary input may fan out to several inner nodes, and then every one of
 * them genuinely carries that promoted widget.
 */
export function resolvePromotedWidgetKeys(
  placeholderNode: WorkflowNode | undefined,
  subgraph: WorkflowSubgraphDefinition | undefined,
): Set<string> {
  const keys = new Set<string>();
  if (!placeholderNode) return keys;

  const boundaryNames = new Set<string>();

  const proxyWidgets = (placeholderNode.properties as Record<string, unknown> | undefined)
    ?.proxyWidgets;
  if (Array.isArray(proxyWidgets)) {
    for (const entry of proxyWidgets) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const [innerNodeIdRaw, widgetNameRaw] = entry;
      const widgetName = typeof widgetNameRaw === 'string' ? widgetNameRaw.trim() : '';
      if (!widgetName) continue;
      if (String(innerNodeIdRaw) === '-1') {
        boundaryNames.add(widgetName);
        continue;
      }
      const innerNodeId = Number(innerNodeIdRaw);
      if (Number.isFinite(innerNodeId)) keys.add(promotedWidgetKey(innerNodeId, widgetName));
    }
  }

  // The older shape carries no proxyWidgets list; the boundary input's own
  // widget slot is then the whole record of the promotion.
  for (const input of placeholderNode.inputs ?? []) {
    const promotedName = input.widget?.name;
    if (typeof promotedName === 'string' && promotedName.trim()) {
      boundaryNames.add(promotedName.trim());
    }
  }

  if (!subgraph || boundaryNames.size === 0) return keys;

  for (const boundaryName of boundaryNames) {
    const slotIndex = (subgraph.inputs ?? []).findIndex(
      (boundaryInput) => boundaryInput.name === boundaryName,
    );
    if (slotIndex === -1) continue;
    for (const link of subgraph.links ?? []) {
      if (link.origin_id !== SUBGRAPH_INPUT_NODE_ID || link.origin_slot !== slotIndex) continue;
      const innerNode = subgraph.nodes?.find((candidate) => candidate.id === link.target_id);
      const innerInput = innerNode?.inputs?.[link.target_slot];
      // One boundary input may fan out to a widget-backed slot on one node and a
      // plain socket on another; only the widget-backed side promotes a widget.
      if (!innerInput?.widget) continue;
      // The inner slot's own widget name, not the boundary name — a renamed
      // boundary slot still promotes the widget the inner node calls its own.
      const widgetName = innerInput.widget.name?.trim() || innerInput.name?.trim() || boundaryName;
      keys.add(promotedWidgetKey(link.target_id, widgetName));
    }
  }

  return keys;
}

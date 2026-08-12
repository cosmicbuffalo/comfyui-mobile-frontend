import type { Workflow, WorkflowNode } from '@/api/types';
import { getWidgetIndexForInput } from '@/utils/seedUtils';

// Impact Pack pushes widget values back to the client over the ComfyUI
// websocket as `impact-node-feedback`. It fires from an onprompt hook, so the
// values land at queue time rather than after execution.
//
// The one users notice is ImpactWildcardProcessor in `populate` mode: the
// server expands the wildcards, rewrites `populated_text` in the submitted
// prompt, and feeds the resolved string back so the box shows what actually
// ran. Without this the box just stays empty. The same event also carries the
// `mode` flip and the seed/value updates from Impact's logic nodes, so this is
// deliberately generic rather than wildcard-specific.

export interface ImpactNodeFeedback {
  nodeId: number;
  widgetName: string;
  value: unknown;
}

/** Validate a raw websocket payload. `node_id` arrives as a string. */
export function parseImpactNodeFeedback(payload: unknown): ImpactNodeFeedback | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;

  const rawId = data.node_id;
  const nodeId = typeof rawId === 'number' ? rawId : Number.parseInt(String(rawId ?? ''), 10);
  if (!Number.isFinite(nodeId)) return null;

  const widgetName = data.widget_name;
  if (typeof widgetName !== 'string' || !widgetName) return null;
  if (!('value' in data)) return null;

  return { nodeId, widgetName, value: data.value };
}

/**
 * Write the fed-back value into the matching widget, searching root nodes and
 * then every subgraph definition. Returns the updated workflow, or null when
 * nothing matched — an unknown node id is normal (the event is broadcast to
 * every connected client, including ones on a different workflow).
 */
export function applyImpactNodeFeedback(
  workflow: Workflow,
  nodeTypes: Parameters<typeof getWidgetIndexForInput>[1],
  feedback: ImpactNodeFeedback,
): Workflow | null {
  const patchNode = (node: WorkflowNode): WorkflowNode | null => {
    if (node.id !== feedback.nodeId) return null;
    if (!Array.isArray(node.widgets_values)) return null;
    const index = getWidgetIndexForInput(workflow, nodeTypes, node, feedback.widgetName);
    if (index === null || index < 0) return null;
    // Nothing to do when the value already matches — avoids marking the
    // workflow dirty on a re-queue that resolved to the same text.
    if (node.widgets_values[index] === feedback.value) return null;
    const widgets_values = [...node.widgets_values];
    widgets_values[index] = feedback.value;
    return { ...node, widgets_values };
  };

  let patched = false;
  const nodes = workflow.nodes.map((node) => {
    const next = patchNode(node);
    if (!next) return node;
    patched = true;
    return next;
  });
  if (patched) return { ...workflow, nodes };

  const subgraphs = workflow.definitions?.subgraphs;
  if (!subgraphs?.length) return null;

  const nextSubgraphs = subgraphs.map((subgraph) => {
    if (patched || !Array.isArray(subgraph.nodes)) return subgraph;
    let localPatch = false;
    const innerNodes = subgraph.nodes.map((node) => {
      const next = patchNode(node);
      if (!next) return node;
      localPatch = true;
      return next;
    });
    if (!localPatch) return subgraph;
    patched = true;
    return { ...subgraph, nodes: innerNodes };
  });

  if (!patched) return null;
  return {
    ...workflow,
    definitions: { ...workflow.definitions, subgraphs: nextSubgraphs },
  };
}

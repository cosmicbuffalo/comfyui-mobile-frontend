import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { getActiveNodeInputDefinitions } from './workflowInputs';

const captures = new Map<string, { capture: () => Promise<string>; sessionId: string | null }>();
export function registerWebcam(key: string, capture: () => Promise<string>, sessionId: string | null = null) {
  const registration = { capture, sessionId };
  captures.set(key, registration);
  return () => { if (captures.get(key) === registration) captures.delete(key); };
}

/** Capture only cameras the user has explicitly started; saved stills also run. */
export async function captureQueuedWebcams(workflow: Workflow, types: NodeTypes, sessionId: string | null = null): Promise<Workflow> {
  if (!captures.size) return workflow;
  const update = async (nodes: WorkflowNode[]) => Promise.all(nodes.map(async node => {
    if (node.type !== 'WebcamCapture' || node.mode === 2 || node.mode === 4 || !node.itemKey || !captures.has(node.itemKey)) return node;
    const registration = captures.get(node.itemKey)!;
    if (registration.sessionId !== sessionId) return node;
    const definition = types[node.type];
    if (!definition) return node;
    const inputs = getActiveNodeInputDefinitions(definition, node);
    if (inputs.find(input => input.name === 'capture_on_queue')?.value === false) return node;
    const image = inputs.find(input => input.name === 'image');
    if (image?.widgetIndex == null || !Array.isArray(node.widgets_values)) return node;
    const path = await registration.capture();
    const values = [...node.widgets_values]; values[image.widgetIndex] = path;
    return { ...node, widgets_values: values };
  }));
  const nodes = await update(workflow.nodes);
  const definitions = workflow.definitions?.subgraphs;
  const used = new Set<string>();
  const visit = (list: WorkflowNode[]) => { for (const node of list) if (!used.has(node.type)) { const sg = definitions?.find(sg => sg.id === node.type); if (sg) { used.add(node.type); visit(sg.nodes ?? []); } } };
  visit(nodes);
  const subgraphs = definitions && await Promise.all(definitions.map(async sg => used.has(sg.id) ? { ...sg, nodes: await update(sg.nodes ?? []) } : sg));
  return { ...workflow, nodes, ...(subgraphs ? { definitions: { ...workflow.definitions, subgraphs } } : {}) };
}

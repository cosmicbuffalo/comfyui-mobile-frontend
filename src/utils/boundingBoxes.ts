import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { getActiveNodeInputDefinitions } from './workflowInputs';
import { resolveNodeByHierarchicalKey, resolveScopeForHierarchicalKey } from './canonicalWorkflowOps';

export interface LayoutBox {
  x: number; y: number; width: number; height: number;
  metadata?: { type?: string; text?: string; desc?: string; palette?: string[]; [key: string]: unknown };
  [key: string]: unknown;
}
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function readBoxes(value: unknown): LayoutBox[] {
  return Array.isArray(value) ? value.filter((box): box is LayoutBox => !!box && typeof box === 'object' &&
    ['x', 'y', 'width', 'height'].every(key => typeof box[key] === 'number' && Number.isFinite(box[key]))) : [];
}
export function fitBox(box: LayoutBox, width: number, height: number): LayoutBox {
  const x = clamp(Math.min(box.x, box.x + box.width), 0, Math.max(0, width - 1));
  const y = clamp(Math.min(box.y, box.y + box.height), 0, Math.max(0, height - 1));
  return { ...box, x: Math.round(x), y: Math.round(y), width: Math.round(clamp(Math.abs(box.width), 1, width - x)), height: Math.round(clamp(Math.abs(box.height), 1, height - y)) };
}
export function boxInputs(node: WorkflowNode, types: NodeTypes | null) {
  const def = types?.[node.type];
  return def ? getActiveNodeInputDefinitions(def, node) : [];
}

/** Mirror the core's incoming-value precedence into the saved editor state. */
export function applyBoundingBoxResult(workflow: Workflow, types: NodeTypes | null, key: string, output: Record<string, unknown>): Workflow {
  const scope = resolveScopeForHierarchicalKey(workflow, key);
  const node = resolveNodeByHierarchicalKey(scope.nodes, key);
  if (node?.type !== 'CreateBoundingBoxes' || !Array.isArray(node.widgets_values)) return workflow;
  const definitions = boxInputs(node, types);
  const values = [...node.widgets_values];
  let changed = false;
  const incoming = readBoxes(output.input_bboxes);
  const last = definitions.find(input => input.name === 'last_incoming');
  const editor = definitions.find(input => input.name === 'editor_state');
  if (incoming.length && last?.widgetIndex != null && editor?.widgetIndex != null && JSON.stringify(incoming) !== JSON.stringify(last.value)) {
    values[last.widgetIndex] = incoming;
    values[editor.widgetIndex] = incoming;
    changed = true;
  }
  const background = Array.isArray(output.background_images) ? output.background_images[0] : undefined;
  const dims = Array.isArray(output.dims) && output.dims.length === 2 && output.dims.every(n => typeof n === 'number' && Number.isFinite(n) && n > 0)
    ? output.dims : node.properties.__mobile_box_dims;
  if (!changed && JSON.stringify(background ?? null) === JSON.stringify(node.properties.__mobile_box_background ?? null) && JSON.stringify(dims) === JSON.stringify(node.properties.__mobile_box_dims)) return workflow;
  const next = { ...node, widgets_values: values, properties: { ...node.properties, __mobile_box_background: background ?? null, ...(dims ? { __mobile_box_dims: dims } : {}) } };
  return scope.applyPatch(workflow, { nodes: scope.nodes.map(n => n.id === node.id ? next : n) });
}

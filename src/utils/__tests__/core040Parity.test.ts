import { describe, expect, it } from 'vitest';
import type { NodeTypeDefinition, Workflow, WorkflowNode } from '@/api/types';
import { buildDefaultConnectionInputs, buildDefaultWidgetValues, buildWorkflowPromptInputs, getActiveNodeInputDefinitions, rebuildDynamicComboNode } from '../workflowInputs';
import { readGroupRows } from '../workflowInputs/dynamicGroups';
import { getWidgetDefinitions } from '../widgetDefinitions';
import { collectExecutedMediaOutputs } from '@/hooks/useWebSocket/outputExtraction';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { makeLocationPointer } from '@/utils/mobileLayout';

const group = ['COMFY_DYNAMICGROUP_V3', { min: 1, max: 20, group_name: 'LoRA', template: { required: {
  lora_name: ['COMBO', { options: ['a.safetensors', 'b.safetensors'] }],
  strength: ['FLOAT', { default: 1, min: -100, max: 100, step: 0.01 }],
  enabled: ['BOOLEAN', { default: true }],
} } }] as [string, Record<string, unknown>];
const type = { name: 'LoadLoraModel', display_name: 'Load LoRA (Model)', description: '', python_module: 'comfy_extras.nodes_lora_stack', category: 'model/loaders', output_name: ['MODEL'], input: { required: { model: ['MODEL', {}], loras: group, tail: ['FLOAT', { default: 7 }] } }, output: ['MODEL'] } as NodeTypeDefinition;
const node = (values: unknown[] = [2, 'a.safetensors', 0.5, true, 'b.safetensors', -1, false, 7]): WorkflowNode => ({
  id: 1, itemKey: makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null }), type: 'LoadLoraModel', inputs: buildDefaultConnectionInputs(type).map(i => ({ ...i, link: null })), outputs: [], widgets_values: values, pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0, properties: {},
});
const workflow = (n: WorkflowNode): Workflow => ({ nodes: [n], links: [], groups: [], last_node_id: 1, last_link_id: 0, config: {}, extra: {}, version: 0.4 });

describe('native LoRA groups', () => {
  it('creates the stock hidden count and flattened fields, without a group socket', () => {
    expect(buildDefaultWidgetValues(type)).toEqual([1, 'a.safetensors', 1, true, 7]);
    expect(buildDefaultConnectionInputs(type).map(i => i.name)).toEqual(['model', 'loras.0.lora_name', 'loras.0.strength', 'loras.0.enabled', 'tail']);
  });
  it('keeps following widgets aligned and sends indexed fields rather than the controller', () => {
    const n = node();
    const inputs = buildWorkflowPromptInputs(workflow(n), { LoadLoraModel: type }, n, n.type, new Set([1]), { loras: 0, tail: 7 });
    expect(inputs).toEqual({ 'loras.0.lora_name': 'a.safetensors', 'loras.0.strength': 0.5, 'loras.0.enabled': true, 'loras.1.lora_name': 'b.safetensors', 'loras.1.strength': -1, 'loras.1.enabled': false, tail: 7 });
    expect(getWidgetDefinitions({ LoadLoraModel: type }, n).map(w => [w.type, w.widgetIndex])).toEqual([['DYNAMIC_GROUP', 0], ['FLOAT', 7]]);
  });
  it('reorders rows and their connected fields, then removes and reports abandoned links', () => {
    const n = node();
    n.inputs.push({ name: 'loras.1.strength', type: 'FLOAT', link: 10, widget: { name: 'loras.1.strength' } });
    const rows = readGroupRows(n, 'loras', 0, group[1]);
    const moved = rebuildDynamicComboNode(n, type, 'loras', group, 0, { rows: [rows[1], rows[0]], order: [1, 0] })!;
    expect(moved.node.widgets_values).toEqual([2, 'b.safetensors', -1, false, 'a.safetensors', 0.5, true, 7]);
    expect(moved.node.inputs.find(i => i.name === 'loras.0.strength')?.link).toBe(10);
    expect(moved.node.inputs.map(i => i.name)).toEqual(['model', 'loras.0.lora_name', 'loras.0.strength', 'loras.0.enabled', 'loras.1.lora_name', 'loras.1.strength', 'loras.1.enabled', 'tail']);
    const removed = rebuildDynamicComboNode(moved.node, type, 'loras', group, 0, { rows: [rows[0]], order: [1] })!;
    expect(removed.removedLinkIds).toEqual([10]);
    expect(removed.node.widgets_values).toEqual([1, 'a.safetensors', 0.5, true, 7]);
  });
  it('rejects edits outside the backend row limits', () => {
    expect(rebuildDynamicComboNode(node(), type, 'loras', group, 0, { rows: [], order: [] })).toBeNull();
    expect(rebuildDynamicComboNode(node(), type, 'loras', group, 0, { rows: Array(21).fill({}), order: [] })).toBeNull();
  });
  it('edits a group through the store and retains the following widget', () => {
    const n = node();
    n.properties.__lm_widget_ids = ['loras', 'loras.0.lora_name', 'loras.0.strength', 'loras.0.enabled', 'loras.1.lora_name', 'loras.1.strength', 'loras.1.enabled', 'tail'];
    useWorkflowStore.setState({ workflow: workflow(n), nodeTypes: { LoadLoraModel: type }, scopeStack: [] });
    const rows = readGroupRows(n, 'loras', 0, group[1]);
    useWorkflowStore.getState().updateNodeWidget(n.itemKey!, 0, { rows: [rows[1]], order: [1] }, 'loras');
    expect(useWorkflowStore.getState().workflow?.nodes[0].widgets_values).toEqual([1, 'b.safetensors', -1, false, 7]);
    expect(useWorkflowStore.getState().workflow?.nodes[0].properties.__lm_widget_ids).toBeUndefined();
  });
});

it('switches a DynamicCombo away from and back to an option holding a group without shifting later widgets', () => {
  const comboType = { ...type, input: { required: {
    mode: ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'on', inputs: { required: { rows: group } } }, { key: 'off', inputs: { required: {} } }] }],
    tail: ['INT', { default: 9 }],
  } } } as NodeTypeDefinition;
  const n = node(['on', 2, 'a.safetensors', 0.25, true, 'b.safetensors', 0.5, false, 9]);
  n.type = 'Switched';
  n.inputs = [];
  const off = rebuildDynamicComboNode(n, comboType, 'mode', comboType.input!.required!.mode, 0, 'off')!;
  expect(off.node.widgets_values).toEqual(['off', 9]);
  expect(buildWorkflowPromptInputs(workflow(off.node), { Switched: comboType }, off.node, 'Switched', new Set([1]), null)).toEqual({ mode: 'off', tail: 9 });
  const on = rebuildDynamicComboNode(off.node, comboType, 'mode', comboType.input!.required!.mode, 0, 'on')!;
  expect(on.node.widgets_values).toEqual(['on', 1, 'a.safetensors', 1, true, 9]);
});

describe('camera widget serialization', () => {
  it('does not save CameraInfoState, and preserves the CameraAngle view-mode slot', () => {
    const info = { ...type, input: { required: { a: ['FLOAT', { default: 2 }], state: ['CAMERA_INFO_STATE', { socketless: true }], b: ['FLOAT', { default: 3 }] } } } as NodeTypeDefinition;
    expect(buildDefaultWidgetValues(info)).toEqual([2, 3]);
    const angle = { ...type, input: { required: { angle: ['INT', { default: 0 }], view: ['STRING', { widgetType: 'CAMERA_ANGLE_VIEW', socketless: true, default: '' }], zoom: ['FLOAT', { default: 5 }] } } } as NodeTypeDefinition;
    expect(buildDefaultWidgetValues(angle)).toEqual([0, 'camera', 5]);
    const n = node([45, 'object', 7]);
    n.inputs = [];
    const inputs = buildWorkflowPromptInputs(workflow(n), { LoadLoraModel: angle }, n, n.type, new Set([1]), { angle: 0, view: 1, zoom: 2 });
    expect(inputs).toEqual({ angle: 45, zoom: 7 });
    expect(getActiveNodeInputDefinitions(info, node([2, 3])).find(i => i.name === 'b')?.widgetIndex).toBe(1);
  });
});

it('retains 3D output camera/transform metadata in the same order as the files', () => {
  const camera = { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 }, zoom: 2, cameraType: 'perspective' };
  const transform = { position: { x: 2, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } };
  const files = collectExecutedMediaOutputs({ '3d': [{ filename: 'mesh.glb', subfolder: '', type: 'output' }], camera_info: [camera], model_3d_info: [transform] }, 'run-1');
  expect(files).toEqual([{ filename: 'mesh.glb', subfolder: '', type: 'output', cacheToken: 'run-1', model3d: { camera, transform } }]);
});

it('shows Preview3D\'s legacy result as an output-folder model with its camera', () => {
  const camera = { position: { x: 3, y: 2, z: 4 }, target: { x: 0, y: 0, z: 0 }, zoom: 1, cameraType: 'perspective' };
  const files = collectExecutedMediaOutputs({ result: ['showcase\\knot.glb', camera, null] }, 'run-2');
  expect(files).toEqual([{ filename: 'knot.glb', subfolder: 'showcase', type: 'output', cacheToken: 'run-2', model3d: { camera, transform: undefined } }]);
  expect(collectExecutedMediaOutputs({ result: ['not a model'] }, 'run-3')).toEqual([]);
});

it('shows Preview3D results from older cores, including annotated temp paths and placements', () => {
  const camera = { position: { x: 0, y: 1, z: 4 }, target: { x: 0, y: 0, z: 0 }, zoom: 1, cameraType: 'perspective' };
  const placement = { position: { x: 1, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 2, y: 2, z: 2 } };
  // Core 0.37 Preview3DAdvanced: annotated folder, placement third.
  expect(collectExecutedMediaOutputs({ result: ['preview3d_ab.glb [temp]', camera, [placement]] }, 'r')).toEqual([
    { filename: 'preview3d_ab.glb', subfolder: '', type: 'temp', cacheToken: 'r', model3d: { camera, transform: placement } },
  ]);
  // Core 0.34 Preview3D: output-relative path, placement object third.
  expect(collectExecutedMediaOutputs({ result: ['3d/mesh.obj', null, placement] }, 'r')).toEqual([
    { filename: 'mesh.obj', subfolder: '3d', type: 'output', cacheToken: 'r', model3d: { camera: undefined, transform: placement } },
  ]);
  // Core 0.40 Preview3D: background image path third, which is not a placement.
  expect(collectExecutedMediaOutputs({ result: ['mesh.glb', camera, 'temp/bg_1.png'] }, 'r')[0].model3d).toEqual({ camera, transform: undefined });
  // A 0.37 result that also carries the standard bucket is left to the bucket.
  expect(collectExecutedMediaOutputs({ result: ['x.glb [temp]', camera, []], '3d': [{ filename: 'x.glb', subfolder: '', type: 'temp' }] }, 'r')).toHaveLength(1);
});

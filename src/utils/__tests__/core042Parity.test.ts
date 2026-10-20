import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypeDefinition, NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import fixture from './fixtures/core042Nodes.json';
import { buildDefaultConnectionInputs, buildDefaultWidgetValues, buildWorkflowPromptInputs, getActiveNodeInputDefinitions, rebuildDynamicComboNode } from '../workflowInputs';
import { autogrowInputs, editAutogrow } from '../workflowInputs/autogrow';
import { getInputWidgetDefinitions, getWidgetDefinitions } from '../widgetDefinitions';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { makeLocationPointer } from '../mobileLayout';
import { applyBoundingBoxResult, readBoundingBoxOutput, fitBox } from '../boundingBoxes';
import { parseBinaryPreviewMessage } from '@/hooks/useWebSocket/binaryPreview';
import { captureQueuedWebcams, registerWebcam } from '../webcamCapture';

const types = fixture as unknown as NodeTypes;
const key = (id: number) => makeLocationPointer({ type: 'node', nodeId: id, subgraphId: null });
const node = (type: string, id = 1): WorkflowNode => ({ id, itemKey: key(id), type, pos: [0,0], size: [300,300], order: 0, flags: {}, mode: 0, properties: {},
  widgets_values: buildDefaultWidgetValues(types[type]), inputs: buildDefaultConnectionInputs(types[type]).map(input => ({ ...input, link: null })),
  outputs: types[type].output.map((outputType, i) => ({ name: types[type].output_name?.[i] ?? outputType, type: outputType, links: [] })),
});
const workflow = (nodes: WorkflowNode[]): Workflow => ({ nodes, links: [], last_node_id: 2, last_link_id: 0, config: {}, extra: {}, groups: [], version: 0.4 });
const prompt = (n: WorkflowNode) => buildWorkflowPromptInputs(workflow([n]), types, n, n.type, new Set([n.id]), null);
afterEach(() => vi.unstubAllGlobals());

describe('real 0.42 input schemas', () => {
  it('creates one typed reference socket without allocating 100 or saving a controller', () => {
    const n = node('ReferenceMultiLatent');
    expect(n.inputs.filter(i => i.name.startsWith('images'))).toEqual([{ name: 'images.image0', type: 'IMAGE', link: null }]);
    expect(n.widgets_values).toEqual(['keep resolution']);
    expect(getWidgetDefinitions(types, n)).toEqual([]);
    expect(prompt(n)).toEqual({ resolution: 'keep resolution' });
  });
  it('keeps stock Krea values aligned with no references and with named gaps', () => {
    const n = node('Krea3ImageNode');
    n.widgets_values = ['Krea 3', 'paint a cat', 'auto', '2K', 'fast', false, 42, 'fixed'];
    n.inputs = n.inputs.filter(i => !i.name.startsWith('model.images'));
    n.inputs.push({ name: 'model.images.image_5', type: 'IMAGE', link: 99 });
    expect(prompt(n)).toMatchObject({ 'model.prompt': 'paint a cat', 'model.aspect_ratio': 'auto', 'model.resolution': '2K', 'model.thinking_mode': 'fast', 'model.precise_edit': false, 'model.seed': 42 });
    expect(prompt(n)).not.toHaveProperty('model.images');
    const widgets = [...getWidgetDefinitions(types, n), ...getInputWidgetDefinitions(types, n)];
    expect(widgets.find(w => w.inputName === 'model.prompt')?.widgetIndex).toBe(1);
  });
  it('grows, removes connected references and repairs link slots/source outputs through the store', () => {
    const target = node('ReferenceMultiLatent');
    const source: WorkflowNode = { ...node('ImageSDRToHDR', 2), outputs: [{ name: 'image', type: 'IMAGE', links: [] }] };
    useWorkflowStore.setState({ workflow: workflow([target, source]), nodeTypes: types, scopeStack: [{ type: 'root' }], itemKeyByPointer: {}, pointerByHierarchicalKey: {} });
    let slot = target.inputs.findIndex(input => input.name === 'images.image0');
    useWorkflowStore.getState().connectNodes(key(2), 0, key(1), slot, 'IMAGE');
    let wf = useWorkflowStore.getState().workflow!;
    expect(wf.nodes[0].inputs.find(i => i.name === 'images.image1')?.link).toBeNull();
    expect(wf.nodes[0].inputs.find(i => i.name === 'images.image0')?.link).toBe(1);
    slot = wf.nodes[0].inputs.findIndex(input => input.name === 'images.image1');
    useWorkflowStore.getState().connectNodes(key(2), 0, key(1), slot, 'IMAGE');
    useWorkflowStore.getState().updateNodeWidget(key(1), -1, { remove: 'images.image0' }, 'images');
    wf = useWorkflowStore.getState().workflow!;
    expect(wf.links).toHaveLength(1);
    expect(wf.links[0][4]).toBe(wf.nodes[0].inputs.findIndex(input => input.link === 2));
    expect(wf.nodes[1].outputs[0].links).toEqual([2]);
    expect(wf.nodes[0].inputs.some(input => input.name === 'images.image0')).toBe(false);
  });
  it('preserves saved reference links when changing resolution', () => {
    const n = node('ReferenceMultiLatent'); n.inputs.find(i => i.name === 'images.image0')!.link = 8;
    const resized = rebuildDynamicComboNode(n, types[n.type], 'resolution', types[n.type].input!.required!.resolution, 0, 'resize')!;
    expect(prompt(resized.node)).toMatchObject({ resolution: 'resize', 'resolution.megapixels': 1 });
    expect(resized.node.inputs.find(i => i.name === 'images.image0')?.link).toBe(8);
    expect(resized.removedLinkIds).toEqual([]);
  });
  it('supports named templates, limits and socket-only primitive types', () => {
    const options = { template: { names: ['a', 'b'], min: 0, input: { required: { value: ['STRING', { default: 'unused' }] } } } };
    const n = { ...node('ReferenceMultiLatent'), inputs: [] };
    const first = editAutogrow(n, 'group', options, { add: true })!;
    const second = editAutogrow(first.node, 'group', options, { add: true })!;
    expect(second.node.inputs.map(i => i.name)).toEqual(['group.a', 'group.b']);
    expect(autogrowInputs(options, 'group', second.node)[0].inputDef[1]?.forceInput).toBe(true);
    expect(editAutogrow(second.node, 'group', options, { add: true })).toBeNull();
    expect(editAutogrow(second.node, 'group', { ...options, template: { ...options.template, min: 2 } }, { remove: 'group.a' })).toBeNull();
  });
  it('preserves nested group links on a surviving branch and removes them on departure', () => {
    const krea = types.Krea3ImageNode.input!.required!.model;
    const options = krea[1]!.options as { key: string; inputs: unknown }[];
    const def = { ...types.Krea3ImageNode, input: { required: { model: ['COMFY_DYNAMICCOMBO_V3', { options: [...options, { ...options[0], key: 'another' }, { key: 'off', inputs: { required: {} } }] }] } } } as NodeTypeDefinition;
    const n = node('Krea3ImageNode');
    n.inputs = n.inputs.filter(i => !i.name.startsWith('model.images'));
    n.inputs.push({ name: 'model.images.image_5', type: 'IMAGE', link: 8 });
    const same = rebuildDynamicComboNode(n, def, 'model', def.input!.required!.model, 0, 'another')!;
    expect(same.node.inputs.find(i => i.name === 'model.images.image_5')?.link).toBe(8);
    const off = rebuildDynamicComboNode(n, def, 'model', def.input!.required!.model, 0, 'off')!;
    expect(off.removedLinkIds).toEqual([8]);
    expect(off.node.widgets_values).toEqual(['off']);
    expect(off.node.inputs.some(i => i.name.startsWith('model.images'))).toBe(false);
  });
  it('serializes SDR/HDR and new remeshing controls without shifting later widgets', () => {
    expect(prompt(node('ImageSDRToHDR'))).toEqual({ algorithm: 'lottes', 'algorithm.target_luminance': 650 });
    const n = node('RemeshMesh');
    const solid = rebuildDynamicComboNode(n, types[n.type], 'sign_mode', types[n.type].input!.required!.sign_mode, 1, 'solid')!;
    expect(prompt(solid.node)).toMatchObject({ sign_mode: 'solid', 'sign_mode.fill': 20, 'sign_mode.qef': false, band: 1, smooth_iters: 0, precluster_max_verts: 20000000 });
    expect(prompt(solid.node)).not.toHaveProperty('sign_mode.manifold');
  });
});

describe('bounding-box state', () => {
  const incoming = [{ x: 12, y: 20, width: 50, height: 60, metadata: { type: 'text', text: 'hello', desc: 'sign', palette: ['#ff0000'] } }];
  it('applies a changed upstream input once, then preserves local edits on repeat execution', () => {
    const n = node('CreateBoundingBoxes'); let wf = workflow([n]);
    wf = applyBoundingBoxResult(wf, types, key(1), { input_bboxes: incoming });
    let definitions = getActiveNodeInputDefinitions(types[n.type], wf.nodes[0]);
    expect(definitions.find(d => d.name === 'editor_state')?.value).toEqual(incoming);
    expect(definitions.find(d => d.name === 'last_incoming')?.value).toEqual(incoming);
    const index = definitions.find(d => d.name === 'editor_state')!.widgetIndex!;
    (wf.nodes[0].widgets_values as unknown[])[index] = [{ ...incoming[0], x: 99 }];
    expect(applyBoundingBoxResult(wf, types, key(1), { input_bboxes: incoming })).toBe(wf);
    wf = applyBoundingBoxResult(wf, types, key(1), { input_bboxes: [{ ...incoming[0], x: 33 }] });
    definitions = getActiveNodeInputDefinitions(types[n.type], wf.nodes[0]);
    expect(definitions.find(d => d.name === 'editor_state')?.value).toMatchObject([{ x: 33 }]);
  });
  it('keeps the run\'s background and canvas size out of the workflow, as stock does', () => {
    const wf = workflow([node('CreateBoundingBoxes')]);
    const background = { filename: 'bg.png', subfolder: '', type: 'temp' };
    expect(applyBoundingBoxResult(wf, types, key(1), { dims: [256, 2048], background_images: [background] })).toBe(wf);
    expect(readBoundingBoxOutput({ dims: [256, 2048], background_images: [background] })).toEqual({ dims: [256, 2048], background });
    expect(readBoundingBoxOutput({ dims: [NaN, 0], background_images: [null] })).toEqual({});
  });
  it('wraps saved box arrays as values rather than prompt links', () => {
    const n = node('CreateBoundingBoxes');
    const index = getActiveNodeInputDefinitions(types[n.type], n).find(d => d.name === 'editor_state')!.widgetIndex!;
    (n.widgets_values as unknown[])[index] = incoming;
    expect(prompt(n).editor_state).toEqual({ __value__: incoming });
  });
  it('normalizes reverse drags and keeps coordinates inside the canvas', () => {
    expect(fitBox({ x: 60, y: 50, width: -40, height: -30 }, 100, 100)).toMatchObject({ x: 20, y: 20, width: 40, height: 30 });
    expect(fitBox({ x: 100, y: 100, width: 50, height: 50 }, 100, 100)).toEqual({ x: 99, y: 99, width: 1, height: 1 });
  });
});

describe('binary diagnostics', () => {
  const textFrame = (id: string, text: string) => {
    const name = new TextEncoder().encode(id), content = new TextEncoder().encode(text);
    const buffer = new ArrayBuffer(8 + name.length + content.length), view = new DataView(buffer);
    view.setUint32(0, 3); view.setUint32(4, name.length); new Uint8Array(buffer, 8).set(name); new Uint8Array(buffer, 8 + name.length).set(content); return buffer;
  };
  it('decodes UTF-8 text and nested node ids', () => expect(parseBinaryPreviewMessage(textFrame('12:3', 'width: 64 — résumé'))).toEqual({ kind: 'text', nodeId: '12:3', text: 'width: 64 — résumé' }));
  it('keeps long text, as stock does', () => {
    const long = 'x'.repeat(200_000);
    expect(parseBinaryPreviewMessage(textFrame('1', long))).toEqual({ kind: 'text', nodeId: '1', text: long });
  });
  it('rejects truncated, oversized-id and invalid UTF-8 text frames', () => {
    const truncated = textFrame('1', 'x'); new DataView(truncated).setUint32(4, 9000);
    expect(parseBinaryPreviewMessage(truncated)).toBeNull();
    expect(parseBinaryPreviewMessage(textFrame('1'.repeat(4097), 'x'))).toBeNull();
    const invalid = textFrame('1', 'x'); new Uint8Array(invalid)[8] = 255;
    expect(parseBinaryPreviewMessage(invalid)).toBeNull();
  });
});

it('captures active webcams before queueing and preserves a saved still when capture-on-queue is off', async () => {
  const n = node('WebcamCapture');
  expect(n.widgets_values).toEqual(['', 0, 0, true]);
  const capture = vi.fn(async () => 'webcam/frame.png'); const unregister = registerWebcam(key(1), capture);
  try {
    const wf = await captureQueuedWebcams(workflow([n]), types);
    expect((wf.nodes[0].widgets_values as unknown[])[0]).toBe('webcam/frame.png');
    expect((n.widgets_values as unknown[])[0]).toBe('');
    (n.widgets_values as unknown[])[3] = false;
    await captureQueuedWebcams(workflow([n]), types);
    expect(capture).toHaveBeenCalledTimes(1);
  } finally { unregister(); }
});


it('keeps captures scoped to their workflow tab when node keys match', async () => {
  const capture = vi.fn(async () => 'webcam/active.png');
  const unregister = registerWebcam(key(1), capture, 'active');
  try {
    const wf = workflow([node('WebcamCapture')]);
    const parked = await captureQueuedWebcams(wf, types, 'parked');
    expect(parked.nodes[0].widgets_values).toEqual(wf.nodes[0].widgets_values);
    expect(capture).not.toHaveBeenCalled();
    await captureQueuedWebcams(wf, types, 'active');
    expect(capture).toHaveBeenCalledOnce();
  } finally { unregister(); }
});

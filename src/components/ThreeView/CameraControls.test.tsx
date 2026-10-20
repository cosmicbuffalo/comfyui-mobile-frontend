import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NodeTypeDefinition, WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { makeLocationPointer } from '@/utils/mobileLayout';

vi.mock('three', async importOriginal => {
  const three = await importOriginal<typeof import('three')>();
  class WebGLRenderer {
    domElement = document.createElement('canvas');
    private size = new three.Vector2();
    setPixelRatio() {}
    setClearColor() {}
    getSize(target: InstanceType<typeof three.Vector2>) { return target.copy(this.size); }
    setSize(width: number, height: number) { this.size.set(width, height); }
    setScissorTest() {}
    setScissor() {}
    setViewport() {}
    clear() {}
    render() {}
    dispose() {}
    forceContextLoss() {}
  }
  return { ...three, WebGLRenderer };
});

const { default: CameraControls } = await import('./CameraControls');

// Narrower than core's 0-360 so the drag below has to be clamped.
const angleType = {
  name: 'CameraAngle', display_name: 'Compose Camera Angle Prompt', description: '', python_module: 'comfy_extras.nodes_camera_angle', category: 'camera',
  output: ['LOAD3D_CAMERA', 'STRING'], output_name: ['camera_info', 'prompt'],
  input: { required: {
    horizontal_angle: ['INT', { default: 0, min: 0, max: 100 }],
    vertical_angle: ['INT', { default: 0, min: -30, max: 60 }],
    zoom: ['FLOAT', { default: 5, min: 0, max: 10 }],
    view: ['STRING', { widgetType: 'CAMERA_ANGLE_VIEW', socketless: true, default: 'camera' }],
  }, optional: { image: ['IMAGE', {}] } },
} as unknown as NodeTypeDefinition;

let frames: FrameRequestCallback[] = [];
const runFrame = () => act(() => { const queued = frames; frames = []; queued.forEach(callback => callback(0)); });
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect() {}, strokeRect() {}, fillText() {} } as unknown as CanvasRenderingContext2D);
  HTMLCanvasElement.prototype.setPointerCapture = () => {};
  HTMLCanvasElement.prototype.hasPointerCapture = () => false;
  HTMLCanvasElement.prototype.releasePointerCapture = () => {};
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function pointer(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

it('writes a drag to the workflow once per frame, inside the input range, and flushes on unmount', () => {
  const node: WorkflowNode = {
    id: 1, itemKey: makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null }), type: 'CameraAngle',
    inputs: [], outputs: [], widgets_values: [10, 0, 5, 'object'], pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0, properties: {},
  };
  useWorkflowStore.setState({ nodeTypes: { CameraAngle: angleType }, workflow: { nodes: [node], links: [], groups: [], last_node_id: 1, last_link_id: 0, config: {}, extra: {}, version: 0.4 }, scopeStack: [] });
  const onChange = vi.fn();
  act(() => root.render(<CameraControls node={node} onChange={onChange} disabled={false} />));
  const canvas = container.querySelector('canvas')!;

  // Object view looks through the camera, so a free drag turns it.
  act(() => {
    canvas.dispatchEvent(pointer('pointerdown', 100, 100));
    for (let step = 1; step <= 40; step++) canvas.dispatchEvent(pointer('pointermove', 100 - step * 4, 100));
  });
  expect(onChange).not.toHaveBeenCalled();
  runFrame();
  // 160 px left turns +80 degrees from 10: 90, inside max 100.
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenLastCalledWith({ 0: 90, 1: 0 });

  act(() => { for (let step = 41; step <= 60; step++) canvas.dispatchEvent(pointer('pointermove', 100 - step * 4, 100)); });
  act(() => root.unmount());
  // 240 px would reach 130; the unflushed write lands on unmount, clamped to 100.
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(onChange).toHaveBeenLastCalledWith({ 0: 100, 1: 0 });
});

function renderInfo(mode: string) {
  const node: WorkflowNode = {
    id: 2, itemKey: makeLocationPointer({ type: 'node', nodeId: 2, subgraphId: null }), type: 'CreateCameraInfo',
    inputs: [], outputs: [], widgets_values: [mode], pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0, properties: {},
  };
  const infoType = {
    ...angleType, name: 'CreateCameraInfo', output: ['LOAD3D_CAMERA'], output_name: ['camera_info'],
    input: { required: { mode: ['COMFY_DYNAMICCOMBO_V3', { options: ['orbit', 'look_at', 'quaternion'].map(key => ({ key, inputs: { required: {} } })) }] } },
  } as unknown as NodeTypeDefinition;
  useWorkflowStore.setState({ nodeTypes: { CreateCameraInfo: infoType }, workflow: { nodes: [node], links: [], groups: [], last_node_id: 2, last_link_id: 0, config: {}, extra: {}, version: 0.4 }, scopeStack: [] });
  act(() => root.render(<CameraControls node={node} onChange={() => {}} disabled={false} />));
  return container.querySelector<HTMLSelectElement>('select[aria-label="Camera transform"]')!;
}

it('offers only the transforms the camera mode can store', () => {
  const options = (mode: string) => [...renderInfo(mode).options].map(option => option.textContent);
  // One set of handles each: the camera's, or its target's. A quaternion camera
  // has no target to move, but a rotation of its own.
  expect(options('orbit')).toEqual(['Orbit / roll', 'Move']);
  expect(options('look_at')).toEqual(['Move camera', 'Move']);
  expect(options('quaternion')).toEqual(['Move camera', 'Rotate camera']);
  act(() => root.unmount());
});

it('keeps the handles and transform picker for the corner while looking through', () => {
  const picker = renderInfo('orbit');
  const button = (label: string) => [...container.querySelectorAll('button')].find(b => b.textContent === label)!;
  const corner = () => container.querySelector('[data-camera-corner]');
  expect(corner()).not.toBeNull();
  act(() => button('Look through').click());
  // The handles move to the corner, so both stay usable, and Reset view turns the corner back.
  expect(button('Handles').disabled).toBe(false);
  expect(picker.disabled).toBe(false);
  expect(button('Reset view').disabled).toBe(false);
  act(() => button('Handles').click());
  expect(corner()).toBeNull();
  expect(button('Reset view').disabled).toBe(true);
  act(() => button('Handles').click());
  expect(corner()).not.toBeNull();
  act(() => root.unmount());
});

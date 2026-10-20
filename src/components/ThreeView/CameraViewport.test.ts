import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { CameraInputs } from './cameraMath';

// The real scene, gestures and controls, with a renderer that draws nothing.
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

const { CameraViewport, pickTransformGizmo } = await import('./CameraViewport');

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  // The cube's face labels are drawn on 2D canvases.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect() {}, strokeRect() {}, fillText() {} } as unknown as CanvasRenderingContext2D);
  HTMLCanvasElement.prototype.setPointerCapture = () => {};
  HTMLCanvasElement.prototype.hasPointerCapture = () => false;
  HTMLCanvasElement.prototype.releasePointerCapture = () => {};
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function pointer(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

function dragAngle(start: CameraInputs, steps: number, dx: number, dy: number) {
  const container = document.createElement('div');
  const changes: CameraInputs[] = [];
  const viewport = new CameraViewport(container, 'angle', values => changes.push(values));
  viewport.updateInputs(start);
  viewport.setViewMode('object');
  const canvas = container.querySelector('canvas')!;
  canvas.dispatchEvent(pointer('pointerdown', 100, 100));
  for (let step = 1; step <= steps; step++) canvas.dispatchEvent(pointer('pointermove', 100 + step * dx, 100 + step * dy));
  canvas.dispatchEvent(pointer('pointerup', 100 + steps * dx, 100 + steps * dy));
  viewport.remove();
  return changes.at(-1);
}

it('accumulates small Object-view drags instead of rounding each step away', () => {
  // 50 one-pixel steps: the total, not 50 rounded half-degree steps, moves the camera.
  expect(dragAngle({ horizontal_angle: 10, vertical_angle: 0, zoom: 5 }, 50, 1, -1)).toEqual({ horizontal_angle: 345, vertical_angle: -25 });
  expect(dragAngle({ horizontal_angle: 10, vertical_angle: 0, zoom: 5 }, 50, -1, 1)).toEqual({ horizontal_angle: 35, vertical_angle: 25 });
});

it('moves the same distance for one long step as for many short ones', () => {
  const start = { horizontal_angle: 90, vertical_angle: 10, zoom: 5 };
  expect(dragAngle(start, 30, 0.6, 0.6)).toEqual(dragAngle(start, 1, 18, 18));
});

it('grabs a handle from a finger-width away, but needs a mouse to be closer', () => {
  const grab = (pointerType: string) => {
    const container = document.createElement('div');
    const changes: CameraInputs[] = [];
    const viewport = new CameraViewport(container, 'angle', values => changes.push(values));
    // A high camera lifts the pitch and distance handles well clear of the yaw handle on its track.
    viewport.updateInputs({ horizontal_angle: 0, vertical_angle: 60, zoom: 5 });
    const canvas = container.querySelector('canvas')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON() {} });
    const internals = viewport as unknown as { handles: Map<string, import('three').Mesh>; view: { camera: import('three').Camera; scene: import('three').Scene } };
    internals.view.scene.updateMatrixWorld(true);
    const point = internals.handles.get('yaw')!.getWorldPosition(internals.handles.get('yaw')!.position.clone()).project(internals.view.camera);
    const x = (point.x + 1) / 2 * 400, y = (1 - point.y) / 2 * 300 + 18;
    const event = (type: string, dx = 0) => {
      const e = pointer(type, x + dx, y);
      Object.defineProperty(e, 'pointerType', { value: pointerType });
      return e;
    };
    canvas.dispatchEvent(event('pointerdown'));
    canvas.dispatchEvent(event('pointermove', 60));
    canvas.dispatchEvent(event('pointerup', 60));
    viewport.remove();
    return changes.some(change => 'horizontal_angle' in change);
  };
  expect(grab('touch')).toBe(true);
  expect(grab('mouse')).toBe(false);
});

it('keeps the yaw track still while the camera rises and falls', () => {
  const viewport = new CameraViewport(document.createElement('div'), 'angle', () => {});
  const internals = viewport as unknown as { handles: Map<string, import('three').Mesh> };
  viewport.updateInputs({ horizontal_angle: 90, vertical_angle: -30, zoom: 5 });
  const low = internals.handles.get('yaw')!.position.clone();
  viewport.updateInputs({ horizontal_angle: 90, vertical_angle: 60, zoom: 5 });
  // Only the pitch changed, so the yaw handle stays where it was on its track.
  expect(internals.handles.get('yaw')!.position.distanceTo(low)).toBeLessThan(1e-9);
  viewport.remove();
});

it('hides the roll ring while the move-camera gizmo sits on the camera', () => {
  const container = document.createElement('div');
  const viewport = new CameraViewport(container, 'info', () => {});
  viewport.updateInputs({ mode: 'look_at', 'mode.position_x': 2, 'mode.position_y': 1, 'mode.position_z': 3 });
  const roll = (viewport as unknown as { handles: Map<string, { visible: boolean }> }).handles.get('roll')!;
  expect(roll.visible).toBe(true);
  viewport.setTransformGizmoMode('camera-translate');
  expect(roll.visible).toBe(false);
  viewport.setTransformGizmoMode('target');
  expect(roll.visible).toBe(true);
  viewport.remove();
});

it('picks a newly enabled transform gizmo before its first render frame', () => {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 512, bottom: 288, width: 512, height: 288, toJSON() {} });
  const camera = new THREE.PerspectiveCamera(35, 512 / 288, 0.1, 1000);
  camera.position.set(8, 6, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const scene = new THREE.Scene(), object = new THREE.Object3D();
  const control = new TransformControls(camera, canvas); control.setSize(0.8); control.attach(object);
  scene.add(object, control.getHelper());
  scene.updateMatrixWorld(true);
  // Input changes and visibility arrive ahead of the scheduled WebGL frame.
  object.position.set(-3, 2, 1); control.enabled = true; control.getHelper().visible = true;
  const point = object.position.clone().project(camera);
  pickTransformGizmo(scene, control, new THREE.Vector2(point.x, point.y));
  expect(control.axis).not.toBeNull();
  expect((control as unknown as { worldPosition: THREE.Vector3 }).worldPosition.toArray()).toEqual([-3, 2, 1]);
  control.dispose();
});

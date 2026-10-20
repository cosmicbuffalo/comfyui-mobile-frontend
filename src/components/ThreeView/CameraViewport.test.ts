import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const { CameraViewport, cornerFraction, pickTransformGizmo } = await import('./CameraViewport');

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

it('shows one set of handles at a time', () => {
  const viewport = new CameraViewport(document.createElement('div'), 'info', () => {});
  const internals = viewport as unknown as { gizmo: THREE.Object3D; rollRing: THREE.Object3D; transformControl: TransformControls };
  const shown = () => ({ orbit: internals.gizmo.visible, roll: internals.rollRing.visible, gizmo: internals.transformControl.enabled });
  viewport.updateInputs({ mode: 'orbit', 'mode.yaw': 35, 'mode.pitch': 25, 'mode.distance': 4 });
  expect(shown()).toEqual({ orbit: true, roll: true, gizmo: false });
  viewport.setTransformGizmoMode('target');
  expect(shown()).toEqual({ orbit: false, roll: false, gizmo: true });
  // A placed camera moves by a gizmo, with the roll ring beside it.
  viewport.updateInputs({ mode: 'look_at', 'mode.position_x': 2, 'mode.position_y': 1, 'mode.position_z': 3 });
  expect(shown()).toEqual({ orbit: false, roll: false, gizmo: true });
  viewport.setTransformGizmoMode('camera');
  expect(shown()).toEqual({ orbit: false, roll: true, gizmo: true });
  viewport.remove();
});

it('rolls the camera by dragging the dot around its ring', () => {
  const container = document.createElement('div');
  const changes: CameraInputs[] = [];
  const viewport = new CameraViewport(container, 'info', values => changes.push(values));
  viewport.updateInputs({ mode: 'orbit', 'mode.yaw': 35, 'mode.pitch': 25, 'mode.distance': 4, roll: 0 });
  const canvas = container.querySelector('canvas')!;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400, right: 400, bottom: 400, x: 0, y: 0, toJSON() {} });
  const internals = viewport as unknown as { rollRing: THREE.Object3D; handles: Map<string, THREE.Object3D>; view: { camera: THREE.Camera; scene: THREE.Scene } };
  internals.view.scene.updateMatrixWorld(true);
  const screen = (world: THREE.Vector3) => {
    const point = world.project(internals.view.camera);
    return [(point.x + 1) / 2 * 400, (1 - point.y) / 2 * 400] as const;
  };
  const [x0, y0] = screen(internals.handles.get('roll')!.getWorldPosition(new THREE.Vector3()));
  // A quarter turn round the ring, from the dot at its top to its left side.
  const [x1, y1] = screen(internals.rollRing.localToWorld(new THREE.Vector3(-1, 0, 0)));
  canvas.dispatchEvent(pointer('pointerdown', x0, y0));
  canvas.dispatchEvent(pointer('pointermove', x1, y1));
  canvas.dispatchEvent(pointer('pointerup', x1, y1));
  expect(Number(changes.at(-1)?.roll)).toBeCloseTo(90, 0);
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

it('keeps orbiting the overview after a handle drag', () => {
  const container = document.createElement('div');
  const changes: CameraInputs[] = [];
  const viewport = new CameraViewport(container, 'angle', values => changes.push(values));
  viewport.updateInputs({ horizontal_angle: 0, vertical_angle: 60, zoom: 5 });
  viewport.setViewMode('camera');
  const canvas = container.querySelector('canvas')!;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON() {} });
  const internals = viewport as unknown as { handles: Map<string, import('three').Mesh>; view: { camera: import('three').Camera; scene: import('three').Scene; controls: { enabled: boolean } } };
  expect(internals.view.controls.enabled).toBe(true);
  internals.view.scene.updateMatrixWorld(true);
  const point = internals.handles.get('yaw')!.getWorldPosition(new THREE.Vector3()).project(internals.view.camera);
  const x = (point.x + 1) / 2 * 400, y = (1 - point.y) / 2 * 300;
  canvas.dispatchEvent(pointer('pointerdown', x, y));
  expect(internals.view.controls.enabled).toBe(false);
  canvas.dispatchEvent(pointer('pointermove', x + 60, y));
  canvas.dispatchEvent(pointer('pointerup', x + 60, y));
  expect(changes.some(change => 'horizontal_angle' in change)).toBe(true);
  expect(internals.view.controls.enabled).toBe(true);
  viewport.setViewMode('object');
  expect(internals.view.controls.enabled).toBe(false);
  viewport.remove();
});

it('ends a transform gizmo drag that the system cancels', () => {
  const container = document.createElement('div');
  const viewport = new CameraViewport(container, 'info', () => {});
  viewport.updateInputs({ mode: 'look_at', 'mode.position_x': 2, 'mode.position_y': 1, 'mode.position_z': 3 });
  viewport.setTransformGizmoMode('target');
  const canvas = container.querySelector('canvas')!;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON() {} });
  const internals = viewport as unknown as { transformControl: TransformControls; transformProxy: THREE.Object3D; view: { camera: THREE.Camera; scene: THREE.Scene; controls: { enabled: boolean } } };
  internals.view.scene.updateMatrixWorld(true);
  const point = internals.transformProxy.getWorldPosition(new THREE.Vector3()).project(internals.view.camera);
  const x = (point.x + 1) / 2 * 400, y = (1 - point.y) / 2 * 300;
  canvas.dispatchEvent(pointer('pointerdown', x, y));
  expect(internals.transformControl.dragging).toBe(true);
  expect(internals.view.controls.enabled).toBe(false);
  // An iOS system gesture or a palm cancels the touch instead of lifting it.
  canvas.dispatchEvent(pointer('pointercancel', x, y));
  expect(internals.transformControl.dragging).toBe(false);
  expect(internals.transformControl.axis).toBeNull();
  expect(internals.view.controls.enabled).toBe(true);
  viewport.remove();
});

it('clears the reference image when a new one fails to load', async () => {
  const loaded = new THREE.Texture<HTMLImageElement>();
  const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async url => {
    if (url === 'ok.png') return loaded;
    throw new Error('403');
  });
  const viewport = new CameraViewport(document.createElement('div'), 'angle', () => {});
  const face = () => ((viewport as unknown as { subject: THREE.Mesh }).subject.material as THREE.MeshStandardMaterial[])[4].map;
  await viewport.setImage('ok.png');
  expect(face()).toBe(loaded);
  await viewport.setImage('refused.png');
  expect(face()).toBeNull();
  await viewport.setImage('refused.png');
  expect(load).toHaveBeenCalledTimes(3);
  viewport.remove();
});

it('puts the overview back where it started', () => {
  for (const kind of ['info', 'angle'] as const) {
    const container = document.createElement('div');
    const viewport = new CameraViewport(container, kind, () => {});
    viewport.updateInputs(kind === 'angle' ? { horizontal_angle: 0, vertical_angle: 0, zoom: 5 } : { mode: 'orbit', 'mode.yaw': 35, 'mode.pitch': 25, 'mode.distance': 4 });
    const view = (viewport as unknown as { view: { camera: THREE.PerspectiveCamera; setCameraState: (state: object) => void } }).view;
    viewport.resetView();
    const home = view.camera.position.clone();
    view.setCameraState({ position: new THREE.Vector3(-3, 9, 2), target: new THREE.Vector3(1, 0, 0), zoom: 2, cameraType: 'perspective' });
    viewport.resetView();
    expect(view.camera.position.distanceTo(home), kind).toBeLessThan(1e-6);
    expect(view.camera.zoom, kind).toBe(1);
    viewport.remove();
  }
});

it('draws the frustum to just past the target, not to the far plane', () => {
  const viewport = new CameraViewport(document.createElement('div'), 'info', () => {});
  viewport.updateInputs({ mode: 'orbit', 'mode.yaw': 35, 'mode.pitch': 25, 'mode.distance': 4 });
  const internals = viewport as unknown as { frustum: THREE.PerspectiveCamera; subjectCamera: THREE.PerspectiveCamera };
  expect(internals.frustum.far).toBeCloseTo(6);
  // What the camera sees, in the inset and when looking through it, is unchanged.
  expect(internals.subjectCamera.far).toBe(1000);
  viewport.remove();
});

describe('the handle corner while looking through', () => {
  const setup = () => {
    const container = document.createElement('div');
    const changes: CameraInputs[] = [];
    const viewport = new CameraViewport(container, 'info', values => changes.push(values));
    viewport.updateInputs({ mode: 'orbit', 'mode.yaw': 35, 'mode.pitch': 25, 'mode.distance': 4, target_x: 0, target_y: 0, target_z: 0 });
    const canvas = container.querySelector('canvas')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 600, right: 600, bottom: 600, x: 0, y: 0, toJSON() {} });
    viewport.setLookThrough(true);
    const internals = viewport as unknown as { cornerCamera: THREE.Camera; handles: Map<string, THREE.Object3D>; transformProxy: THREE.Object3D; frameCorner: () => void; view: { scene: THREE.Scene } };
    // Where a world point is drawn in the corner: a 600 px preview gives it 30%, 420-600 px.
    const inCorner = (world: THREE.Vector3) => {
      internals.frameCorner();
      internals.view.scene.updateMatrixWorld(true);
      const point = world.project(internals.cornerCamera);
      return [420 + (point.x + 1) / 2 * 180, 420 + (1 - point.y) / 2 * 180] as const;
    };
    const drag = (from: readonly [number, number], to: readonly [number, number]) => {
      canvas.dispatchEvent(pointer('pointerdown', from[0], from[1]));
      canvas.dispatchEvent(pointer('pointermove', to[0], to[1]));
      canvas.dispatchEvent(pointer('pointerup', to[0], to[1]));
    };
    return { viewport, changes, internals, inCorner, drag };
  };

  it('drags the orbit handles there, and turns the camera everywhere else', () => {
    const { viewport, changes, internals, inCorner, drag } = setup();
    const [x, y] = inCorner(internals.handles.get('yaw')!.getWorldPosition(new THREE.Vector3()));
    drag([x, y], [x - 30, y]);
    expect(changes.some(change => 'mode.yaw' in change && !('mode.pitch' in change))).toBe(true);
    // A drag on the corner's empty space turns the corner's view, not the camera.
    changes.length = 0;
    internals.frameCorner();
    const corner = internals.cornerCamera.position.clone();
    drag([425, 425], [460, 450]);
    expect(changes).toEqual([]);
    internals.frameCorner();
    expect(internals.cornerCamera.position.distanceTo(corner)).toBeGreaterThan(0.5);
    // Reset view turns it back.
    viewport.resetView();
    internals.frameCorner();
    expect(internals.cornerCamera.position.distanceTo(corner)).toBeLessThan(1e-6);
    // Outside it, dragging still steers the camera.
    drag([100, 100], [160, 100]);
    expect(changes.length).toBeGreaterThan(0);
    viewport.remove();
  });

  it('moves the target with its arrows there', () => {
    const { viewport, changes, internals, inCorner, drag } = setup();
    viewport.setTransformGizmoMode('target');
    const [x, y] = inCorner(internals.transformProxy.getWorldPosition(new THREE.Vector3()));
    drag([x, y], [x + 25, y - 15]);
    expect(changes.some(change => 'target_x' in change)).toBe(true);
    viewport.remove();
  });

  it('gives the whole view to the camera when the handles are hidden', () => {
    const { viewport, changes, drag } = setup();
    viewport.setGizmosVisible(false);
    drag([425, 425], [460, 450]);
    expect(changes.length).toBeGreaterThan(0);
    viewport.remove();
  });
});

it('draws the roll ring the size of the yaw track, with a dot the size of the other handles', () => {
  const viewport = new CameraViewport(document.createElement('div'), 'info', () => {});
  viewport.updateInputs({ mode: 'orbit', 'mode.yaw': 35, 'mode.pitch': 25, 'mode.distance': 4 });
  const internals = viewport as unknown as { rollRing: THREE.Object3D; trackRadius: number; handles: Map<string, THREE.Object3D>; view: { scene: THREE.Scene } };
  internals.view.scene.updateMatrixWorld(true);
  const worldScale = (object: THREE.Object3D) => object.getWorldScale(new THREE.Vector3()).x;
  expect(worldScale(internals.rollRing)).toBeCloseTo(internals.trackRadius);
  expect(worldScale(internals.handles.get('roll')!)).toBeCloseTo(worldScale(internals.handles.get('yaw')!));
  viewport.remove();
});

it('gives the corner view 40% of a phone-sized preview and 30% of a larger one', () => {
  expect(cornerFraction(356)).toBe(0.4);
  expect(cornerFraction(742)).toBe(0.3);
});

describe('panning while looking through', () => {
  const event = (type: string, x: number, y: number, id: number, shiftKey = false) => {
    const e = new MouseEvent(type, { button: 0, clientX: x, clientY: y, shiftKey, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'pointerId', { value: id });
    return e;
  };
  const setup = () => {
    const container = document.createElement('div');
    const changes: CameraInputs[] = [];
    const viewport = new CameraViewport(container, 'info', values => changes.push(values));
    viewport.updateInputs({ mode: 'orbit', 'mode.yaw': 35, 'mode.pitch': 25, 'mode.distance': 4, target_x: 0, target_y: 0, target_z: 0 });
    const canvas = container.querySelector('canvas')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 600, right: 600, bottom: 600, x: 0, y: 0, toJSON() {} });
    viewport.setLookThrough(true);
    return { viewport, changes, canvas, last: () => changes.at(-1) ?? {} };
  };

  it('slides the target with two fingers, and moves in as they spread', () => {
    const { viewport, canvas, last } = setup();
    canvas.dispatchEvent(event('pointerdown', 100, 200, 1));
    canvas.dispatchEvent(event('pointerdown', 200, 200, 2));
    canvas.dispatchEvent(event('pointermove', 160, 200, 1));
    canvas.dispatchEvent(event('pointermove', 260, 200, 2));
    expect(last()).toHaveProperty('target_x');
    expect(last()).not.toHaveProperty('mode.yaw');
    expect(Number(last()['mode.distance'] ?? 4)).toBeCloseTo(4);
    canvas.dispatchEvent(event('pointermove', 360, 200, 2));
    expect(Number(last()['mode.distance'])).toBeLessThan(4);
    canvas.dispatchEvent(event('pointerup', 360, 200, 2));
    canvas.dispatchEvent(event('pointerup', 160, 200, 1));
    viewport.remove();
  });

  it('pans with shift and a mouse, and still turns without it', () => {
    const { viewport, canvas, last } = setup();
    canvas.dispatchEvent(event('pointerdown', 100, 100, 1, true));
    canvas.dispatchEvent(event('pointermove', 150, 120, 1, true));
    canvas.dispatchEvent(event('pointerup', 150, 120, 1, true));
    expect(last()).toHaveProperty('target_x');
    canvas.dispatchEvent(event('pointerdown', 100, 100, 1));
    canvas.dispatchEvent(event('pointermove', 150, 100, 1));
    canvas.dispatchEvent(event('pointerup', 150, 100, 1));
    expect(last()).toHaveProperty('mode.yaw');
    viewport.remove();
  });
});

it('keeps the yaw and pitch handles 30 degrees either side of the distance handle', () => {
  const container = document.createElement('div');
  const changes: CameraInputs[] = [];
  const viewport = new CameraViewport(container, 'info', values => changes.push(values));
  viewport.updateInputs({ mode: 'orbit', 'mode.yaw': 35, 'mode.pitch': 0, 'mode.distance': 4 });
  const internals = viewport as unknown as { handles: Map<string, THREE.Object3D>; view: { scene: THREE.Scene } };
  internals.view.scene.updateMatrixWorld(true);
  const heading = (name: string) => { const p = internals.handles.get(name)!.getWorldPosition(new THREE.Vector3()); return Math.atan2(p.x, p.z) / (Math.PI / 180); };
  expect(heading('yaw') - heading('distance')).toBeCloseTo(30);
  // The pitch arc turns the other way, clear of the distance handle.
  expect(heading('distance') - heading('pitch')).toBeCloseTo(30);
  viewport.remove();
});

it('reads pitch along the turned arc', () => {
  const container = document.createElement('div');
  const changes: CameraInputs[] = [];
  const viewport = new CameraViewport(container, 'info', values => changes.push(values));
  viewport.updateInputs({ mode: 'orbit', 'mode.yaw': 35, 'mode.pitch': 10, 'mode.distance': 4 });
  const canvas = container.querySelector('canvas')!;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 600, right: 600, bottom: 600, x: 0, y: 0, toJSON() {} });
  const internals = viewport as unknown as { handles: Map<string, THREE.Object3D>; view: { camera: THREE.Camera; scene: THREE.Scene } };
  internals.view.scene.updateMatrixWorld(true);
  const handle = internals.handles.get('pitch')!;
  const screen = (world: THREE.Vector3) => { const p = world.project(internals.view.camera); return [(p.x + 1) / 2 * 600, (1 - p.y) / 2 * 600] as const; };
  const [x0, y0] = screen(handle.getWorldPosition(new THREE.Vector3()));
  // The point on the arc for 50 degrees, in the arc's own (turned) frame.
  const [x1, y1] = screen(handle.parent!.localToWorld(new THREE.Vector3(0, 1.5 * Math.sin(50 * Math.PI / 180), 1.5 * Math.cos(50 * Math.PI / 180))));
  canvas.dispatchEvent(pointer('pointerdown', x0, y0));
  canvas.dispatchEvent(pointer('pointermove', x1, y1));
  canvas.dispatchEvent(pointer('pointerup', x1, y1));
  expect(Number(changes.at(-1)?.['mode.pitch'])).toBeCloseTo(50, 0);
  viewport.remove();
});

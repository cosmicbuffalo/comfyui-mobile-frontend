import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Viewport3d as Viewport3dType } from './Viewport3d';
import { useSwipeNavigation } from '@/hooks/useSwipeNavigation';

const managers: Array<import('three').LoadingManager> = [];
vi.mock('@sparkjsdev/spark', () => { throw new Error('splat chunk unavailable'); });

// Real viewer, viewport and OrbitControls; only WebGL and the model parse are stand-ins.
vi.mock('three', async importOriginal => {
  const three = await importOriginal<typeof import('three')>();
  class WebGLRenderer {
    domElement = document.createElement('canvas');
    private size = new three.Vector2();
    setPixelRatio() {}
    setClearColor() {}
    getSize(target: InstanceType<typeof three.Vector2>) { return target.copy(this.size); }
    setSize(width: number, height: number) { this.size.set(width, height); this.domElement.width = width; this.domElement.height = height; }
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
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', async () => {
  const three = await import('three');
  return { GLTFLoader: class {
    constructor(manager: import('three').LoadingManager) { managers.push(manager); }
    async parseAsync() { return { scene: new three.Mesh(new three.BoxGeometry(), new three.MeshBasicMaterial()), animations: [] }; }
  } };
});
const viewports: Viewport3dType[] = [];
vi.mock('./Viewport3d', async importOriginal => {
  const actual = await importOriginal<typeof import('./Viewport3d')>();
  return { ...actual, Viewport3d: class extends actual.Viewport3d {
    constructor(...args: ConstructorParameters<typeof actual.Viewport3d>) { super(...args); viewports.push(this); }
  } };
});

const THREE = await import('three');
const { default: ModelViewer } = await import('./ModelViewer');

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  viewports.length = 0;
  managers.length = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  root = createRoot(document.createElement('div'));
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); });

it('aborts the per-viewer sidecar manager when removed', async () => {
  await act(async () => root.render(<ModelViewer src="/view?filename=mesh.glb" filename="mesh.glb" />));
  const signal = managers[0].abortController.signal;
  expect(signal.aborted).toBe(false);
  act(() => root.render(null));
  expect(signal.aborted).toBe(true);
});

it('handles a speculative splat import rejection while the file fetch is pending', async () => {
  let rejectFetch!: (error: Error) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise((_resolve, reject) => { rejectFetch = reject; })));
  const onError = vi.fn();
  await act(async () => root.render(<ModelViewer src="/view?filename=cloud.splat" filename="cloud.splat" onError={onError} />));
  // Vitest also fails this test if the speculative import rejects unhandled.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  await act(async () => rejectFetch(new Error('file fetch failed')));
  expect(onError).toHaveBeenCalledOnce();
});

it('keeps a rolled orthographic output camera through controls updates and wheel zoom', async () => {
  // Core CreateCameraInfo sends the quaternion and useCustomUp, without customUp.
  const rolled = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  await act(async () => root.render(<ModelViewer src="/view?filename=mesh.glb&subfolder=&type=output" filename="mesh.glb" metadata={{ camera: {
    position: { x: 0, y: 0, z: 5 }, target: { x: 0, y: 0, z: 0 }, zoom: 1, cameraType: 'orthographic',
    quaternion: { x: rolled.x, y: rolled.y, z: rolled.z, w: rolled.w }, useCustomUp: true,
  } }} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const view = viewports[0];
  const camera = view.controls.object as InstanceType<typeof THREE.OrthographicCamera>;
  expect(camera.isOrthographicCamera).toBe(true);
  expect(camera.quaternion.angleTo(rolled)).toBeCloseTo(0, 6);

  view.controls.update();
  expect(camera.quaternion.angleTo(rolled)).toBeCloseTo(0, 6);

  view.domElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, cancelable: true }));
  view.controls.update();
  expect(camera.zoom).toBeGreaterThan(1);
  expect(camera.quaternion.angleTo(rolled)).toBeCloseTo(0, 6);
});

it('orbits on a sideways drag without swiping to another panel', async () => {
  const onSwipeLeft = vi.fn();
  function Panel() {
    useSwipeNavigation({ onSwipeLeft, enabled: true });
    return <ModelViewer src="/view?filename=mesh.glb&subfolder=&type=output" filename="mesh.glb" pageScroll />;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const panelRoot = createRoot(host);
  await act(async () => panelRoot.render(<Panel />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const touch = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: 300 }] });
    return event;
  };
  const canvas = viewports[0].domElement;
  act(() => {
    canvas.dispatchEvent(touch('touchstart', 300));
    for (const x of [270, 230, 180, 120]) canvas.dispatchEvent(touch('touchmove', x));
    canvas.dispatchEvent(touch('touchend', 0));
  });
  expect(onSwipeLeft).not.toHaveBeenCalled();
  act(() => panelRoot.unmount());
  host.remove();
});

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Model3dMetadata } from '@/utils/model3d';
type CameraState = NonNullable<Model3dMetadata['camera']>;

/**
 * OrbitControls rebuilds the orientation with lookAt on every update. Restore
 * the camera's up axis first so that update also preserves roll.
 */
export function applyCameraUp(camera: THREE.Camera, state: CameraState) {
  camera.up.set(0, 1, 0);
  if (!state.useCustomUp) return;
  const up = state.customUp ? new THREE.Vector3().copy(state.customUp) : null;
  if (up && up.lengthSq() > 0) camera.up.copy(up).normalize();
  else if (state.quaternion) camera.up.applyQuaternion(new THREE.Quaternion().copy(state.quaternion).normalize());
}

const HOME_POSITION = new THREE.Vector3(8, 6, 10);

/** A renderer whose lifetime follows the visible React preview. */
export class Viewport3d {
  readonly renderer: THREE.WebGLRenderer;
  readonly domElement: HTMLCanvasElement;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10000);
  readonly controls: OrbitControls;
  readonly grid = new THREE.GridHelper(10, 10, 0x555555, 0x333333);
  private externalCamera: THREE.Camera | null = null;
  private before = new Set<() => void>();
  private after = new Set<() => void>();
  private resizeObserver: ResizeObserver;
  private visibilityObserver: IntersectionObserver;
  private visible = true;
  private frame = 0;
  private removed = false;

  private container: HTMLElement;
  /** `pageScroll` leaves vertical swipes to the page, for previews inside a scrolling list. */
  constructor(container: HTMLElement, { pageScroll = false }: { pageScroll?: boolean } = {}) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    // Keep viewport/scissor coordinates in drawing-buffer pixels on high-DPI screens.
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x282828);
    this.domElement = this.renderer.domElement;
    this.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none';
    // A drag here orbits the camera; it must not also swipe between panels.
    this.domElement.dataset.swipeNavIgnore = 'true';
    container.append(this.domElement);
    this.scene.add(this.grid, new THREE.HemisphereLight(0xffffff, 0x555566, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(4, 8, 6);
    this.scene.add(light);
    this.camera.position.copy(HOME_POSITION);
    this.controls = new OrbitControls(this.camera, this.domElement);
    // OrbitControls claims every touch gesture; give vertical ones back to the page.
    if (pageScroll) this.domElement.style.touchAction = 'pan-y';
    this.controls.addEventListener('change', this.forceRender);
    this.domElement.addEventListener('contextmenu', this.onContextMenu);
    this.resizeObserver = new ResizeObserver(this.forceRender);
    this.resizeObserver.observe(container);
    this.visibilityObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (this.visible) this.forceRender();
    });
    this.visibilityObserver.observe(container);
    this.forceRender();
  }

  private onContextMenu = (event: Event) => event.preventDefault();
  forceRender = () => {
    if (this.removed || this.frame || !this.visible) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const width = Math.max(1, this.container.clientWidth);
      const height = Math.max(1, this.container.clientHeight);
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const renderWidth = Math.round(width * scale);
      const renderHeight = Math.round(height * scale);
      const size = this.renderer.getSize(new THREE.Vector2());
      if (size.x !== renderWidth || size.y !== renderHeight) this.renderer.setSize(renderWidth, renderHeight, false);
      const camera = this.camera;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      for (const callback of this.before) callback();
      this.scene.updateMatrixWorld(true);
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, renderWidth, renderHeight);
      this.renderer.setClearColor(0x282828);
      this.renderer.clear();
      this.renderer.render(this.scene, this.externalCamera ?? camera);
      for (const callback of this.after) callback();
    });
  };
  addPreRenderCallback(callback: () => void) { this.before.add(callback); return () => { this.before.delete(callback); }; }
  addPostRenderCallback(callback: () => void) { this.after.add(callback); return () => { this.after.delete(callback); }; }
  /** A square snapshot of the next rendered frame, center-cropped and scaled to `size` px. */
  capture(size: number): Promise<Blob | null> {
    return new Promise(resolve => {
      // Read the drawing buffer in the same task as the render; it is cleared once composited.
      const detach = this.addPostRenderCallback(() => {
        detach();
        const { width, height } = this.domElement;
        const side = Math.min(width, height);
        const out = document.createElement('canvas');
        out.width = out.height = size;
        out.getContext('2d')?.drawImage(this.domElement, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
        out.toBlob(resolve, 'image/webp', 0.85);
      });
      this.forceRender();
    });
  }
  setRenderCamera(camera: THREE.Camera | null) {
    this.externalCamera = camera;
    this.controls.enabled = camera === null;
    if (!camera) this.controls.object = this.camera;
    this.forceRender();
  }
  /** Back to where the camera started, looking at the origin. */
  resetCamera() {
    this.setCameraState({ position: HOME_POSITION.clone(), target: new THREE.Vector3(), zoom: 1, cameraType: 'perspective' });
  }
  setCameraState(state: CameraState) {
    const camera = this.camera;
    camera.position.copy(state.position);
    camera.zoom = state.zoom;
    if (state.fov !== undefined) camera.fov = state.fov;
    applyCameraUp(camera, state);
    this.controls.target.copy(state.target);
    camera.lookAt(state.target.x, state.target.y, state.target.z);
    if (state.quaternion) camera.quaternion.copy(state.quaternion).normalize();
    camera.updateProjectionMatrix();
    this.controls.update();
    this.forceRender();
  }
  remove() {
    if (this.removed) return;
    this.removed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.visibilityObserver.disconnect();
    this.controls.dispose();
    this.domElement.removeEventListener('contextmenu', this.onContextMenu);
    this.grid.geometry.dispose();
    for (const material of Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material]) material.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.domElement.remove();
  }
}

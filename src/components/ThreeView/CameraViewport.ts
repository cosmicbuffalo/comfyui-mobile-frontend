import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Viewport3d } from './Viewport3d';
import { disposeObject } from './modelAssets';
import { cameraPose, limit, lookDrag, numberInput, wheelChange, type CameraInputs, type CameraKind } from './cameraMath';

export type TransformMode = 'none' | 'target' | 'camera-translate' | 'camera-rotate';
type Handle = 'yaw' | 'pitch' | 'distance' | 'roll';

/** Camera geometry and gestures implemented from the public node input contract. */
export class CameraViewport {
  private view: Viewport3d;
  private kind: CameraKind;
  private onChange: (values: CameraInputs) => void;
  private inputs: CameraInputs = {};
  private lookingThrough = false;
  private showHandles = true;
  private transform: TransformMode = 'none';
  private sceneObjects = new THREE.Group();
  private handles = new Map<Handle, THREE.Mesh>();
  private subject: THREE.Mesh;
  private perspective = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  private orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  private subjectCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  private helper = new THREE.CameraHelper(this.perspective);
  private transformControl: TransformControls;
  private transformProxy = new THREE.Object3D();
  private transformHelper: THREE.Object3D;
  // Gestures apply the total movement to the inputs at pointerdown, so rounding
  // (CameraAngle's INT angles) never feeds back into the next step.
  private dragging: { pointer: number; x: number; y: number; handle: Handle | null; start: CameraInputs } | null = null;
  private ray = new THREE.Raycaster();
  private imageToken = 0;
  private image: THREE.Texture | null = null;
  private imageUrl: string | null = null;
  private disposed = false;
  private detachBefore: () => void;
  private detachAfter: () => void;

  constructor(container: HTMLElement, kind: CameraKind, onChange: (values: CameraInputs) => void) {
    this.kind = kind;
    this.onChange = onChange;
    this.view = new Viewport3d(container);
    this.view.scene.add(this.sceneObjects);
    this.view.grid.visible = kind === 'info';
    if (kind === 'angle') this.view.setCameraState({ position: new THREE.Vector3(12, 9, 15), target: new THREE.Vector3(), zoom: 1, cameraType: 'perspective' });
    const materials = ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'FRONT', 'BACK'].map(label => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#394150'; ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = '#596273'; ctx.strokeRect(1, 1, 126, 126);
      ctx.fillStyle = '#d2d9e5'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, 64, 70);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshStandardMaterial({ map, roughness: 0.8 });
    });
    this.subject = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials);
    this.subject.position.y = kind === 'info' ? 0.5 : 0;
    this.sceneObjects.add(this.subject, this.helper);
    const torus = (name: Handle, color: number) => {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 8, 96), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 }));
      mesh.renderOrder = 10; mesh.name = name; this.handles.set(name, mesh); this.sceneObjects.add(mesh);
    };
    torus('yaw', 0x54c9ff); torus('pitch', 0x87e5ab); torus('roll', 0xe8be6b);
    const distance = new THREE.Mesh(new THREE.SphereGeometry(0.14), new THREE.MeshBasicMaterial({ color: 0xe886cf, depthTest: false }));
    distance.name = 'distance'; distance.renderOrder = 11; this.handles.set('distance', distance); this.sceneObjects.add(distance);
    this.transformControl = new TransformControls(this.view.camera, this.view.domElement);
    this.transformControl.setSize(0.8);
    this.transformControl.attach(this.transformProxy);
    this.transformHelper = this.transformControl.getHelper();
    this.view.scene.add(this.transformProxy, this.transformHelper);
    this.transformControl.addEventListener('dragging-changed', event => { this.view.controls.enabled = !event.value && !this.lookingThrough; });
    this.transformControl.addEventListener('objectChange', this.onTransform);
    const canvas = this.view.domElement;
    canvas.addEventListener('pointerdown', this.onDown, true);
    canvas.addEventListener('pointermove', this.onMove, true);
    canvas.addEventListener('pointerup', this.onUp, true);
    canvas.addEventListener('pointercancel', this.onUp, true);
    canvas.addEventListener('wheel', this.onWheel, { passive: false, capture: true });
    this.detachBefore = this.view.addPreRenderCallback(this.resizeCamera);
    this.detachAfter = this.view.addPostRenderCallback(this.drawInset);
    this.updateInputs({});
  }

  updateInputs(inputs: CameraInputs) {
    this.inputs = { ...inputs };
    const pose = cameraPose(this.kind, inputs);
    this.subjectCamera = pose.orthographic ? this.orthographic : this.perspective;
    this.subjectCamera.position.copy(pose.position);
    this.subjectCamera.quaternion.copy(pose.quaternion);
    this.subjectCamera.zoom = pose.zoom;
    this.perspective.fov = pose.fov;
    this.subjectCamera.updateProjectionMatrix();
    this.subjectCamera.updateMatrixWorld(true);
    if (this.helper.camera !== this.subjectCamera) {
      this.sceneObjects.remove(this.helper); this.helper.dispose(); this.helper = new THREE.CameraHelper(this.subjectCamera); this.sceneObjects.add(this.helper);
    }
    this.helper.update();
    const yaw = this.handles.get('yaw')!;
    const ringRadius = Math.max(0.1, pose.distance);
    yaw.position.copy(pose.target); yaw.position.y += Math.sin(THREE.MathUtils.degToRad(pose.pitch)) * pose.distance;
    yaw.rotation.set(Math.PI / 2, 0, 0); yaw.scale.setScalar(Math.max(0.1, Math.cos(THREE.MathUtils.degToRad(pose.pitch)) * ringRadius));
    const pitch = this.handles.get('pitch')!;
    pitch.position.copy(pose.target); pitch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(THREE.MathUtils.degToRad(pose.yaw)), 0, -Math.sin(THREE.MathUtils.degToRad(pose.yaw)))); pitch.scale.setScalar(ringRadius);
    const roll = this.handles.get('roll')!;
    roll.position.copy(pose.position); roll.quaternion.copy(pose.quaternion); roll.scale.setScalar(0.5);
    this.handles.get('distance')!.position.copy(pose.position);
    this.transformProxy.position.copy(this.transform === 'target' ? pose.target : pose.position);
    this.transformProxy.quaternion.copy(pose.quaternion);
    this.transformProxy.updateMatrixWorld(true);
    this.syncVisibility();
    if (this.lookingThrough) this.view.setRenderCamera(this.subjectCamera);
    this.view.forceRender();
  }

  setViewMode(mode: string) { this.setLookThrough(mode === 'object'); }
  setLookThrough(value: boolean) {
    this.lookingThrough = value;
    this.view.setRenderCamera(value ? this.subjectCamera : null);
    this.syncVisibility();
    this.view.forceRender();
  }
  setGizmosVisible(value: boolean) { this.showHandles = value; this.syncVisibility(); this.view.forceRender(); }
  setTransformGizmoMode(mode: TransformMode) {
    this.transform = mode;
    this.transformControl.setMode(mode === 'camera-rotate' ? 'rotate' : 'translate');
    this.updateInputs(this.inputs);
  }
  async setImage(url: string | null) {
    if (this.imageUrl === url) return;
    this.imageUrl = url;
    const token = ++this.imageToken;
    let texture: THREE.Texture | null = null;
    if (url) {
      try { texture = await new THREE.TextureLoader().loadAsync(url); }
      catch { return; }
    }
    if (this.disposed || token !== this.imageToken) { texture?.dispose(); return; }
    const face = (this.subject.material as THREE.MeshStandardMaterial[])[4];
    this.image?.dispose(); this.image = texture;
    if (texture) { texture.colorSpace = THREE.SRGBColorSpace; face.map?.dispose(); face.map = texture; face.needsUpdate = true; }
    else { face.map = null; face.needsUpdate = true; }
    this.view.forceRender();
  }
  private syncVisibility() {
    const mode = String(this.inputs.mode ?? 'orbit');
    this.helper.visible = !this.lookingThrough;
    for (const [name, mesh] of this.handles) mesh.visible = this.showHandles && !this.lookingThrough && (this.kind === 'angle' ? name !== 'roll' : name === 'roll' ? mode !== 'quaternion' : mode === 'orbit');
    const enabled = this.kind === 'info' && this.showHandles && !this.lookingThrough && this.transform !== 'none' && (
      this.transform === 'target' ? mode !== 'quaternion' : this.transform === 'camera-translate' ? mode !== 'orbit' : mode === 'quaternion'
    );
    this.transformControl.enabled = enabled;
    this.transformHelper.visible = enabled;
  }
  private resizeCamera = () => {
    const aspect = this.view.domElement.width / this.view.domElement.height;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    this.orthographic.left = -aspect; this.orthographic.right = aspect; this.orthographic.updateProjectionMatrix();
    this.helper.update();
  };
  private drawInset = () => {
    if (this.lookingThrough) return;
    const { renderer, domElement } = this.view;
    const size = Math.round(Math.min(domElement.width * 0.3, domElement.height * 0.35));
    if (size < 32) return;
    const hidden = [this.helper, this.transformHelper, ...this.handles.values()];
    const visibility = hidden.map(object => object.visible);
    hidden.forEach(object => { object.visible = false; });
    const aspect = this.perspective.aspect;
    const left = this.orthographic.left, right = this.orthographic.right;
    this.perspective.aspect = 1; this.perspective.updateProjectionMatrix();
    this.orthographic.left = -1; this.orthographic.right = 1; this.orthographic.updateProjectionMatrix();
    renderer.setScissorTest(true); renderer.setScissor(domElement.width - size - 8, 8, size, size); renderer.setViewport(domElement.width - size - 8, 8, size, size);
    renderer.render(this.view.scene, this.subjectCamera);
    this.perspective.aspect = aspect; this.perspective.updateProjectionMatrix(); this.orthographic.left = left; this.orthographic.right = right; this.orthographic.updateProjectionMatrix();
    hidden.forEach((object, index) => { object.visible = visibility[index]; });
  };
  private emit(values: CameraInputs) { this.updateInputs({ ...this.inputs, ...values }); this.onChange(values); }
  private onTransform = () => {
    if (this.transform === 'target') this.emit({ target_x: this.transformProxy.position.x, target_y: this.transformProxy.position.y, target_z: this.transformProxy.position.z });
    else if (this.transform === 'camera-translate') this.emit({ 'mode.position_x': this.transformProxy.position.x, 'mode.position_y': this.transformProxy.position.y, 'mode.position_z': this.transformProxy.position.z });
    else if (this.transform === 'camera-rotate') { const q = this.transformProxy.quaternion.clone().normalize(); this.emit({ 'mode.quat_x': q.x, 'mode.quat_y': q.y, 'mode.quat_z': q.z, 'mode.quat_w': q.w }); }
  };
  private pointer(event: PointerEvent) {
    const rect = this.view.domElement.getBoundingClientRect();
    return new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
  }
  private pointRay(event: PointerEvent) {
    this.view.scene.updateMatrixWorld(true);
    this.ray.setFromCamera(this.pointer(event), this.view.camera);
  }
  /**
   * The nearest visible handle within reach of the pointer. The rings are a
   * few pixels wide on screen, so an exact hit on their geometry is too hard
   * with a finger; measure screen distance to each ring's centre line instead.
   */
  private pickHandle(event: PointerEvent): Handle | null {
    const rect = this.view.domElement.getBoundingClientRect();
    const camera = this.view.camera;
    let best: Handle | null = null;
    let nearest = event.pointerType === 'touch' ? 28 : 14;
    this.view.scene.updateMatrixWorld(true);
    for (const [name, mesh] of this.handles) {
      if (!mesh.visible) continue;
      const samples = name === 'distance' ? 1 : 128;
      for (let i = 0; i < samples; i++) {
        const angle = i / samples * Math.PI * 2;
        const point = mesh.localToWorld(name === 'distance' ? new THREE.Vector3() : new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0)).project(camera);
        if (Math.abs(point.z) > 1) continue;
        // The zoom dot sits on the rings; its own radius keeps it the closer pick there.
        const distance = Math.hypot(rect.left + (point.x + 1) / 2 * rect.width - event.clientX, rect.top + (1 - point.y) / 2 * rect.height - event.clientY) - (name === 'distance' ? 8 : 0);
        if (distance < nearest) { nearest = distance; best = name; }
      }
    }
    return best;
  }
  private onDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.dragging) return;
    // A press on the transform gizmo is the gizmo's, however close a ring is.
    if (this.transformControl.enabled) {
      // pointerHover reads x/y as device coordinates, though its typings say PointerEvent.
      this.transformControl.pointerHover(this.pointer(event) as unknown as PointerEvent);
      if (this.transformControl.axis !== null) return;
    }
    const handle = this.lookingThrough ? null : this.pickHandle(event);
    if (!handle && !this.lookingThrough) return;
    this.dragging = { pointer: event.pointerId, x: event.clientX, y: event.clientY, handle, start: { ...this.inputs } };
    this.view.domElement.setPointerCapture(event.pointerId);
    this.view.controls.enabled = false;
    event.stopImmediatePropagation();
  };
  private onMove = (event: PointerEvent) => {
    const drag = this.dragging;
    if (!drag || drag.pointer !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.handle) this.emit(lookDrag(this.kind, drag.start, dx, dy));
    else {
      const pose = cameraPose(this.kind, this.inputs);
      if (drag.handle === 'distance') this.emit(this.kind === 'angle' ? { zoom: limit(numberInput(drag.start, 'zoom', 5) - dy * 0.05, 0, 10) } : { 'mode.distance': Math.max(0.01, cameraPose(this.kind, drag.start).distance * Math.exp(dy * 0.01)) });
      else if (drag.handle === 'roll') this.emit({ roll: limit(numberInput(drag.start, 'roll', 0) + dx * 0.5, -180, 180) });
      else {
        this.pointRay(event);
        const yaw = THREE.MathUtils.degToRad(pose.yaw);
        const normal = drag.handle === 'yaw' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const center = drag.handle === 'yaw' ? this.handles.get('yaw')!.position : pose.target;
        const point = this.ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center), new THREE.Vector3());
        if (point) {
          point.sub(pose.target);
          const value = drag.handle === 'yaw' ? ((THREE.MathUtils.radToDeg(Math.atan2(point.x, point.z)) % 360) + 360) % 360 : THREE.MathUtils.radToDeg(Math.atan2(point.y, point.x * Math.sin(yaw) + point.z * Math.cos(yaw)));
          const name = this.kind === 'angle' ? drag.handle === 'yaw' ? 'horizontal_angle' : 'vertical_angle' : drag.handle === 'yaw' ? 'mode.yaw' : 'mode.pitch';
          this.emit({ [name]: this.kind === 'angle' ? Math.round(drag.handle === 'yaw' ? value : limit(value, -30, 60)) : drag.handle === 'yaw' ? value : limit(value, -89, 89) });
        }
      }
    }
    event.stopImmediatePropagation();
  };
  private onUp = (event: PointerEvent) => {
    if (this.dragging?.pointer !== event.pointerId) return;
    this.dragging = null;
    if (this.view.domElement.hasPointerCapture(event.pointerId)) this.view.domElement.releasePointerCapture(event.pointerId);
    this.view.controls.enabled = !this.lookingThrough;
    event.stopImmediatePropagation();
  };
  private onWheel = (event: WheelEvent) => {
    if (this.kind !== 'angle' && !this.lookingThrough) return;
    this.emit(wheelChange(this.kind, this.inputs, event.deltaY));
    event.preventDefault(); event.stopImmediatePropagation();
  };
  remove() {
    this.disposed = true; this.imageToken++;
    const canvas = this.view.domElement;
    canvas.removeEventListener('pointerdown', this.onDown, true); canvas.removeEventListener('pointermove', this.onMove, true); canvas.removeEventListener('pointerup', this.onUp, true); canvas.removeEventListener('pointercancel', this.onUp, true); canvas.removeEventListener('wheel', this.onWheel, true);
    this.detachBefore(); this.detachAfter(); this.transformControl.dispose(); this.helper.dispose();
    disposeObject(this.sceneObjects);
    this.view.remove();
  }
}

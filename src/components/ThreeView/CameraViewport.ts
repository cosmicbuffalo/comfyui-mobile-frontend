import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Viewport3d } from './Viewport3d';
import { disposeObject } from './modelAssets';
import { cameraPose, limit, lookDrag, numberInput, wheelChange, type CameraInputs, type CameraKind } from './cameraMath';

export type TransformMode = 'none' | 'target' | 'camera-translate' | 'camera-rotate';
type Handle = 'yaw' | 'pitch' | 'distance' | 'roll';

export function pickTransformGizmo(scene: THREE.Scene, controls: TransformControls, pointer: THREE.Vector2) {
  // Input can arrive before the next demand-rendered frame updates the picker.
  scene.updateMatrixWorld(true);
  controls.pointerHover(pointer as unknown as PointerEvent);
}

const DEG = Math.PI / 180;
// The orbit gizmo has a fixed size around the target, whatever the camera's
// real distance: a horizontal track with the yaw handle, a vertical arc with
// the pitch handle, and a line out to the distance handle.
const GIZMO_RADIUS = 1.5;
const HANDLE_RADIUS = 0.11;
const YAW_COLOR = 0x00d4ff;
const PITCH_COLOR = 0xff66ff;
const DISTANCE_COLOR = 0xffcc00;
const ROLL_COLOR = 0xe8be6b;
// CameraAngle draws its track below the subject so it never covers it, and
// shows its distance handle and camera marker inside the gizmo: zoom 0 at the
// outer of these radii, zoom 10 at the inner.
const ANGLE_TRACK_LATITUDE = -40;
const ANGLE_NEAR = 0.8;
const ANGLE_FAR = 1.1;
const ANGLE_OVERVIEW_DIRECTION = new THREE.Vector3(2.4, 1.4, 4.2).normalize();
const angleDisplayDistance = (zoom: number) => ANGLE_FAR - (ANGLE_FAR - ANGLE_NEAR) * zoom / 10;

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
  /** The orbit gizmo, at the target; `facing` turns with the camera's yaw. */
  private gizmo = new THREE.Group();
  private facing = new THREE.Group();
  private trackHeight: number;
  private trackRadius: number;
  private pitchLimits: [number, number];
  private distanceLine: THREE.Line;
  /** CameraAngle's orbit sphere and camera marker. */
  private angleGuides = new THREE.Group();
  private marker = new THREE.Group();
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
  private overviewAspect = 0;
  private detachBefore: () => void;
  private detachAfter: () => void;

  constructor(container: HTMLElement, kind: CameraKind, onChange: (values: CameraInputs) => void) {
    this.kind = kind;
    this.onChange = onChange;
    this.view = new Viewport3d(container);
    this.view.scene.add(this.sceneObjects);
    this.view.grid.visible = kind === 'info';
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
    const guide = (color: number) => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.55 });
    const latitude = (kind === 'angle' ? ANGLE_TRACK_LATITUDE : 0) * DEG;
    this.trackRadius = GIZMO_RADIUS * Math.cos(latitude);
    this.trackHeight = GIZMO_RADIUS * Math.sin(latitude);
    this.pitchLimits = kind === 'angle' ? [-30, 60] : [-85, 85];
    const track = new THREE.Mesh(new THREE.TorusGeometry(this.trackRadius, 0.025, 12, 96), guide(YAW_COLOR));
    track.rotation.x = Math.PI / 2;
    track.position.y = this.trackHeight;
    const arcPoints: THREE.Vector3[] = [];
    for (let degrees = this.pitchLimits[0]; degrees <= this.pitchLimits[1]; degrees += 5) {
      arcPoints.push(new THREE.Vector3(0, GIZMO_RADIUS * Math.sin(degrees * DEG), GIZMO_RADIUS * Math.cos(degrees * DEG)));
    }
    const arc = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arcPoints), 32, 0.025, 8, false), guide(PITCH_COLOR));
    this.distanceLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]),
      new THREE.LineBasicMaterial({ color: DISTANCE_COLOR, depthTest: false, transparent: true, opacity: 0.55 }));
    for (const object of [track, arc, this.distanceLine]) object.renderOrder = 10;
    const handle = (name: Handle, color: number) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(HANDLE_RADIUS, 24, 16), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      mesh.name = name; mesh.renderOrder = 11; this.handles.set(name, mesh);
      return mesh;
    };
    this.facing.add(arc, this.distanceLine, handle('pitch', PITCH_COLOR), handle('distance', DISTANCE_COLOR));
    this.gizmo.add(track, handle('yaw', YAW_COLOR), this.facing);
    const roll = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 8, 96), guide(ROLL_COLOR));
    roll.material.opacity = 0.85; roll.name = 'roll'; roll.renderOrder = 10; this.handles.set('roll', roll);
    this.sceneObjects.add(this.gizmo, roll);
    if (kind === 'angle') {
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(GIZMO_RADIUS, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0x8a93a6, wireframe: true, transparent: true, opacity: 0.14, depthWrite: false }));
      const markerMaterial = new THREE.MeshStandardMaterial({ color: DISTANCE_COLOR, emissive: DISTANCE_COLOR, emissiveIntensity: 0.45, roughness: 0.4 });
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.048, 0.08, 16), markerMaterial);
      lens.rotation.x = Math.PI / 2;
      lens.position.z = -0.1;
      this.marker.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.12), markerMaterial), lens);
      this.angleGuides.add(sphere, this.marker);
      this.sceneObjects.add(this.angleGuides);
    }
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
    const yawRadians = pose.yaw * DEG, pitchRadians = pose.pitch * DEG;
    this.gizmo.position.copy(pose.target);
    this.facing.rotation.y = yawRadians;
    this.handles.get('yaw')!.position.set(this.trackRadius * Math.sin(yawRadians), this.trackHeight, this.trackRadius * Math.cos(yawRadians));
    this.handles.get('pitch')!.position.set(0, GIZMO_RADIUS * Math.sin(pitchRadians), GIZMO_RADIUS * Math.cos(pitchRadians));
    const reach = this.kind === 'angle' ? angleDisplayDistance(numberInput(inputs, 'zoom', 5)) : pose.distance;
    const end = new THREE.Vector3(0, reach * Math.sin(pitchRadians), reach * Math.cos(pitchRadians));
    this.handles.get('distance')!.position.copy(end);
    this.distanceLine.geometry.setFromPoints([new THREE.Vector3(), end]);
    const roll = this.handles.get('roll')!;
    roll.position.copy(pose.position); roll.quaternion.copy(pose.quaternion); roll.scale.setScalar(0.5);
    if (this.kind === 'angle') {
      this.marker.position.copy(end).applyAxisAngle(new THREE.Vector3(0, 1, 0), yawRadians).add(pose.target);
      this.marker.quaternion.copy(pose.quaternion);
    }
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
      // A failed load clears the face rather than leaving the previous image up.
      catch { if (token === this.imageToken) this.imageUrl = null; }
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
    // CameraAngle shows its camera as a marker on the gizmo instead of a frustum.
    this.helper.visible = this.kind === 'info' && !this.lookingThrough;
    this.angleGuides.visible = !this.lookingThrough;
    const enabled = this.kind === 'info' && this.showHandles && !this.lookingThrough && this.transform !== 'none' && (
      this.transform === 'target' ? mode !== 'quaternion' : this.transform === 'camera-translate' ? mode !== 'orbit' : mode === 'quaternion'
    );
    // The roll ring circles the camera, right where the move-camera gizmo sits; it would take that gizmo's presses.
    const gizmoOnCamera = enabled && this.transform !== 'target';
    const shown = this.showHandles && !this.lookingThrough;
    this.gizmo.visible = shown && (this.kind === 'angle' || mode === 'orbit');
    this.handles.get('roll')!.visible = shown && this.kind === 'info' && mode !== 'quaternion' && !gizmoOnCamera;
    this.transformControl.enabled = enabled;
    this.transformHelper.visible = enabled;
  }
  private resizeCamera = () => {
    const aspect = this.view.domElement.width / this.view.domElement.height;
    if (this.kind === 'angle' && aspect !== this.overviewAspect) {
      // Frame the whole gizmo from a fixed direction, whatever the canvas shape.
      this.overviewAspect = aspect;
      const distance = GIZMO_RADIUS * 1.2 / (Math.tan(this.view.camera.fov / 2 * DEG) * Math.min(1, aspect));
      this.view.setCameraState({ position: ANGLE_OVERVIEW_DIRECTION.clone().multiplyScalar(distance), target: new THREE.Vector3(), zoom: 1, cameraType: 'perspective' });
    }
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
    const hidden = [this.helper, this.transformHelper, this.gizmo, this.handles.get('roll')!, this.angleGuides];
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
   * The nearest visible handle within a finger's reach of the pointer: the
   * orbit handles by their centres, the thin roll ring along its whole length.
   */
  private pickHandle(event: PointerEvent): Handle | null {
    const rect = this.view.domElement.getBoundingClientRect();
    const camera = this.view.camera;
    let best: Handle | null = null;
    let nearest = event.pointerType === 'touch' ? 28 : 14;
    this.view.scene.updateMatrixWorld(true);
    for (const [name, mesh] of this.handles) {
      const ring = name === 'roll';
      if (!(ring ? mesh.visible : this.gizmo.visible)) continue;
      const samples = ring ? 128 : 1;
      for (let i = 0; i < samples; i++) {
        const angle = i / samples * Math.PI * 2;
        const point = mesh.localToWorld(ring ? new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0) : new THREE.Vector3()).project(camera);
        if (Math.abs(point.z) > 1) continue;
        const distance = Math.hypot(rect.left + (point.x + 1) / 2 * rect.width - event.clientX, rect.top + (1 - point.y) / 2 * rect.height - event.clientY);
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
      pickTransformGizmo(this.view.scene, this.transformControl, this.pointer(event));
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
      if (drag.handle === 'roll') this.emit({ roll: limit(numberInput(drag.start, 'roll', 0) + dx * 0.5, -180, 180) });
      else {
        // Follow the pointer on the plane the handle moves in: the track's
        // horizontal plane for yaw, the vertical plane facing the camera for
        // pitch and distance.
        this.pointRay(event);
        const yaw = pose.yaw * DEG, pitch = pose.pitch * DEG;
        const plane = drag.handle === 'yaw'
          ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -(pose.target.y + this.trackHeight))
          : new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), pose.target);
        const point = this.ray.ray.intersectPlane(plane, new THREE.Vector3());
        if (point) {
          point.sub(pose.target);
          const angle = this.kind === 'angle';
          if (drag.handle === 'yaw') {
            const value = ((Math.atan2(point.x, point.z) / DEG) % 360 + 360) % 360;
            this.emit(angle ? { horizontal_angle: Math.round(value) % 360 } : { 'mode.yaw': value });
          } else if (drag.handle === 'pitch') {
            const value = limit(Math.atan2(point.y, point.x * Math.sin(yaw) + point.z * Math.cos(yaw)) / DEG, angle ? this.pitchLimits[0] : -89, angle ? this.pitchLimits[1] : 89);
            this.emit(angle ? { vertical_angle: Math.round(value) } : { 'mode.pitch': value });
          } else {
            const along = point.dot(new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)));
            this.emit(angle ? { zoom: Math.round(limit((ANGLE_FAR - along) * 10 / (ANGLE_FAR - ANGLE_NEAR), 0, 10) * 10) / 10 } : { 'mode.distance': Math.max(0.5, along) });
          }
        }
      }
    }
    event.stopImmediatePropagation();
  };
  private onUp = (event: PointerEvent) => {
    // TransformControls ignores pointercancel: a cancelled gizmo drag stayed
    // live, blocking orbit and dragging on with the next touch.
    if (event.type === 'pointercancel' && this.transformControl.dragging) this.transformControl.pointerUp(null);
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

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Viewport3d } from './Viewport3d';
import { disposeObject } from './modelAssets';
import { cameraPose, limit, lookDrag, numberInput, panDrag, wheelChange, type CameraInputs, type CameraKind } from './cameraMath';

/** What the handles move: the camera (its orbit handles and roll, or a gizmo for a placed camera), its target, or a quaternion camera's rotation. */
export type TransformMode = 'camera' | 'target' | 'rotate';
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
/** The yaw handle sits this far round its track from the camera's heading, clear of the pitch handle. */
const YAW_HANDLE_OFFSET = 30;
/** The pitch arc turns this far the other way, clear of the distance line and its handle. */
const PITCH_ARC_OFFSET = -30;
/** The transform gizmo's size, a share of the view it is drawn in: larger in the small corner. */
const GIZMO_SIZE = 1.25;
const CORNER_GIZMO_SIZE = 3;
/** The corner sees the scene from further out than the overview, so its handle dots are drawn larger. */
const CORNER_HANDLE_SCALE = 2.6;

/**
 * The corner view's share of the preview's width and height: the camera's view
 * there, or its handles while looking through it. Larger on a phone-sized
 * preview, where a third would be too small to work in.
 */
export function cornerFraction(previewWidth: number) {
  return previewWidth < 500 ? 0.4 : 0.3;
}
/** How far the frustum lines reach, in multiples of the camera's distance to its target. */
const FRUSTUM_REACH = 1.5;
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
  private transform: TransformMode = 'camera';
  /** The ring around the camera; the `roll` handle is the dot on it. */
  private rollRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
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
  /** A copy of the subject camera that only the frustum lines are drawn from, with a near far plane. */
  private frustum: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective.clone();
  private helper = new THREE.CameraHelper(this.frustum);
  private transformControl: TransformControls;
  private transformProxy = new THREE.Object3D();
  private transformHelper: THREE.Object3D;
  // Gestures apply the total movement to the inputs at pointerdown, so rounding
  // (CameraAngle's INT angles) never feeds back into the next step.
  private dragging: { pointer: number; x: number; y: number; handle: Handle | null; start: CameraInputs; rollFrame?: { inverse: THREE.Matrix4; angle: number }; gizmo?: boolean; cornerTurn?: { yaw: number; pitch: number }; pan?: { ids: number[]; spread: number } } | null = null;
  /** Pointers down on the canvas while looking through: two of them pan. */
  private pointersDown = new Map<number, { x: number; y: number }>();
  /** Looking through the camera, the handles are drawn small in the bottom-right ninth, seen by this camera. */
  private cornerCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  /** How far a drag on the corner's empty space has turned its view from the default, in degrees. */
  private cornerTurn = { yaw: 0, pitch: 0 };
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
    const pitchArc = new THREE.Group();
    pitchArc.rotation.y = PITCH_ARC_OFFSET * DEG;
    pitchArc.add(arc, handle('pitch', PITCH_COLOR));
    this.facing.add(pitchArc, this.distanceLine, handle('distance', DISTANCE_COLOR));
    this.gizmo.add(track, handle('yaw', YAW_COLOR), this.facing);
    this.rollRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 8, 96), guide(ROLL_COLOR));
    this.rollRing.material.opacity = 0.85; this.rollRing.renderOrder = 10;
    // The ring turns with the camera's roll, so the dot at its top shows the roll and is what a drag grabs.
    const rollDot = handle('roll', ROLL_COLOR);
    // The ring takes the yaw track's size; the dot keeps the other handles' size.
    rollDot.position.set(0, 1, 0); rollDot.scale.setScalar(1 / this.trackRadius);
    this.rollRing.add(rollDot);
    this.sceneObjects.add(this.gizmo, this.rollRing);
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
    // Sized for a fingertip: the arrows and rings are what a drag has to land on.
    this.transformControl.setSize(GIZMO_SIZE);
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
    if (this.frustum.type !== this.subjectCamera.type) {
      this.frustum = this.subjectCamera.clone();
      this.sceneObjects.remove(this.helper); this.helper.dispose(); this.helper = new THREE.CameraHelper(this.frustum); this.sceneObjects.add(this.helper);
    }
    // The real far plane is 1000 away, so its lines ran to the horizon: draw
    // them to a little past the target instead.
    this.syncFrustum(FRUSTUM_REACH * Math.max(1, pose.position.distanceTo(pose.target)));
    this.helper.update();
    const yawRadians = pose.yaw * DEG, pitchRadians = pose.pitch * DEG;
    this.gizmo.position.copy(pose.target);
    this.facing.rotation.y = yawRadians;
    const yawHandle = yawRadians + YAW_HANDLE_OFFSET * DEG;
    this.handles.get('yaw')!.position.set(this.trackRadius * Math.sin(yawHandle), this.trackHeight, this.trackRadius * Math.cos(yawHandle));
    this.handles.get('pitch')!.position.set(0, GIZMO_RADIUS * Math.sin(pitchRadians), GIZMO_RADIUS * Math.cos(pitchRadians));
    const reach = this.kind === 'angle' ? angleDisplayDistance(numberInput(inputs, 'zoom', 5)) : pose.distance;
    const end = new THREE.Vector3(0, reach * Math.sin(pitchRadians), reach * Math.cos(pitchRadians));
    this.handles.get('distance')!.position.copy(end);
    this.distanceLine.geometry.setFromPoints([new THREE.Vector3(), end]);
    this.rollRing.position.copy(pose.position); this.rollRing.quaternion.copy(pose.quaternion); this.rollRing.scale.setScalar(this.trackRadius);
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
    this.pointersDown.clear();
    this.transformControl.camera = value ? this.cornerCamera : this.view.camera;
    this.transformControl.setSize(value ? CORNER_GIZMO_SIZE : GIZMO_SIZE);
    this.view.setRenderCamera(value ? this.subjectCamera : null);
    this.syncVisibility();
    this.view.forceRender();
  }
  /**
   * Put the overview back where it started, or while looking through, the
   * corner: the camera itself is the node's values, not this view's.
   */
  resetView() {
    if (this.cornerShown()) {
      this.cornerTurn = { yaw: 0, pitch: 0 };
      this.view.forceRender();
      return;
    }
    if (this.kind === 'angle') {
      this.overviewAspect = 0;
      this.resizeCamera();
    } else this.view.resetCamera();
    this.view.forceRender();
  }
  setGizmosVisible(value: boolean) { this.showHandles = value; this.syncVisibility(); this.view.forceRender(); }
  setTransformGizmoMode(mode: TransformMode) {
    this.transform = mode;
    this.transformControl.setMode(mode === 'rotate' ? 'rotate' : 'translate');
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
    // CameraAngle shows its camera as a marker on the gizmo instead of a frustum.
    this.helper.visible = this.kind === 'info' && !this.lookingThrough;
    this.angleGuides.visible = !this.lookingThrough;
    // In the corner, looking through, the gizmo is driven by hand: its own
    // listeners read the whole canvas.
    const shown = this.showHandles && !this.lookingThrough;
    const sets = this.handleSets();
    this.gizmo.visible = shown && sets.orbit;
    this.rollRing.visible = shown && sets.roll;
    this.transformControl.enabled = shown && sets.gizmo;
    this.transformHelper.visible = shown && sets.gizmo;
  }
  /**
   * One set of handles at a time. Moving an orbit camera is its yaw/pitch/
   * distance handles; a placed camera (look_at, quaternion) gets a gizmo.
   */
  private handleSets() {
    const mode = String(this.inputs.mode ?? 'orbit');
    const movingCamera = this.transform === 'camera';
    return {
      orbit: this.kind === 'angle' || (mode === 'orbit' && movingCamera),
      roll: this.kind === 'info' && mode !== 'quaternion' && movingCamera,
      gizmo: this.kind === 'info' && (this.transform === 'target' ? mode !== 'quaternion' : movingCamera ? mode !== 'orbit' : mode === 'quaternion'),
    };
  }
  private cornerShown() { return this.kind === 'info' && this.lookingThrough && this.showHandles; }
  /** The corner's square on the page, in CSS pixels. */
  private cornerRect() {
    const rect = this.view.domElement.getBoundingClientRect();
    const share = cornerFraction(rect.width);
    return { left: rect.left + rect.width * (1 - share), top: rect.top + rect.height * (1 - share), width: rect.width * share, height: rect.height * share };
  }
  /** The corner's side in the canvas's own pixels, for drawing. */
  private cornerPixels() {
    const { domElement } = this.view;
    return Math.round(Math.min(domElement.width, domElement.height) * cornerFraction(domElement.clientWidth));
  }
  /**
   * Frame the active handles. An orbit's handles straddle the camera and its
   * target, so they are seen from behind the camera, above and to one side:
   * its roll ring faces the corner and the target's handles sit apart from it.
   * Anything else is seen from the overview's direction.
   */
  private frameCorner() {
    const pose = cameraPose(this.kind, this.inputs);
    const camera = this.cornerCamera;
    const overview = this.view.camera;
    const orbiting = this.transform === 'camera' && String(this.inputs.mode ?? 'orbit') === 'orbit';
    let center: THREE.Vector3, radius: number, away: THREE.Vector3;
    if (orbiting) {
      center = pose.position.clone().add(pose.target).multiplyScalar(0.5);
      radius = (pose.position.distanceTo(pose.target) / 2 + GIZMO_RADIUS) * 0.8;
      const back = new THREE.Vector3().subVectors(pose.position, pose.target);
      if (back.lengthSq() < 1e-9) back.set(0, 0, 1);
      back.normalize();
      const side = back.clone().cross(camera.up);
      if (side.lengthSq() < 1e-9) side.set(1, 0, 0);
      side.normalize();
      if (side.dot(new THREE.Vector3().subVectors(overview.position, center)) < 0) side.negate();
      // From behind the camera, its roll ring faces the corner; off to the side
      // and above, the target's handles are not hidden behind it.
      away = back.addScaledVector(side, 0.8).addScaledVector(camera.up, 0.6).normalize();
    } else {
      center = this.transform === 'target' ? pose.target : pose.position;
      radius = 1;
      away = overview.getWorldDirection(new THREE.Vector3()).negate();
    }
    away.applyAxisAngle(camera.up, this.cornerTurn.yaw * DEG);
    const tilt = Math.max(-80 * DEG - Math.asin(away.y), Math.min(80 * DEG - Math.asin(away.y), this.cornerTurn.pitch * DEG));
    away.applyAxisAngle(new THREE.Vector3().crossVectors(away, camera.up).normalize(), tilt);
    camera.position.copy(center).addScaledVector(away, radius / Math.sin(camera.fov / 2 * DEG));
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }
  /** Match the frustum copy to the subject camera, keeping its own far plane. */
  private syncFrustum(far = this.frustum.far) {
    this.frustum.copy(this.subjectCamera as never);
    this.frustum.far = far;
    this.frustum.updateProjectionMatrix();
    this.frustum.updateMatrixWorld(true);
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
    this.syncFrustum();
    this.helper.update();
  };
  private drawInset = () => {
    if (this.lookingThrough) {
      if (this.cornerShown()) this.drawCorner();
      return;
    }
    const { renderer, domElement } = this.view;
    // The same corner the handles take when looking through: the two views swap.
    const size = this.cornerPixels();
    if (size < 32) return;
    const hidden = [this.helper, this.transformHelper, this.gizmo, this.rollRing, this.angleGuides];
    const visibility = hidden.map(object => object.visible);
    hidden.forEach(object => { object.visible = false; });
    const aspect = this.perspective.aspect;
    const left = this.orthographic.left, right = this.orthographic.right;
    this.perspective.aspect = 1; this.perspective.updateProjectionMatrix();
    this.orthographic.left = -1; this.orthographic.right = 1; this.orthographic.updateProjectionMatrix();
    renderer.setScissorTest(true); renderer.setScissor(domElement.width - size, 0, size, size); renderer.setViewport(domElement.width - size, 0, size, size);
    renderer.render(this.view.scene, this.subjectCamera);
    this.perspective.aspect = aspect; this.perspective.updateProjectionMatrix(); this.orthographic.left = left; this.orthographic.right = right; this.orthographic.updateProjectionMatrix();
    hidden.forEach((object, index) => { object.visible = visibility[index]; });
  };
  /** The handles alone, small, over the bottom-right ninth of the camera's view. */
  private drawCorner() {
    const { renderer, domElement } = this.view;
    const size = this.cornerPixels();
    if (size < 32) return;
    // Held still while a handle is dragged, so it does not move under the finger.
    if ((!this.dragging || this.dragging.cornerTurn) && !this.transformControl.dragging) this.frameCorner();
    const sets = this.handleSets();
    const objects = [this.subject, this.helper, this.view.grid, this.gizmo, this.rollRing, this.transformHelper];
    const visibility = objects.map(object => object.visible);
    [this.subject, this.helper, this.view.grid].forEach(object => { object.visible = false; });
    this.gizmo.visible = sets.orbit; this.rollRing.visible = sets.roll; this.transformHelper.visible = sets.gizmo;
    const dots = [...this.handles.values()];
    dots.forEach(dot => dot.scale.multiplyScalar(CORNER_HANDLE_SCALE));
    renderer.setScissorTest(true); renderer.setScissor(domElement.width - size, 0, size, size); renderer.setViewport(domElement.width - size, 0, size, size);
    renderer.render(this.view.scene, this.cornerCamera);
    dots.forEach(dot => dot.scale.divideScalar(CORNER_HANDLE_SCALE));
    objects.forEach((object, index) => { object.visible = visibility[index]; });
  }
  private emit(values: CameraInputs) { this.updateInputs({ ...this.inputs, ...values }); this.onChange(values); }
  private onTransform = () => {
    if (this.transform === 'target') this.emit({ target_x: this.transformProxy.position.x, target_y: this.transformProxy.position.y, target_z: this.transformProxy.position.z });
    else if (this.transform === 'camera') this.emit({ 'mode.position_x': this.transformProxy.position.x, 'mode.position_y': this.transformProxy.position.y, 'mode.position_z': this.transformProxy.position.z });
    else if (this.transform === 'rotate') { const q = this.transformProxy.quaternion.clone().normalize(); this.emit({ 'mode.quat_x': q.x, 'mode.quat_y': q.y, 'mode.quat_z': q.z, 'mode.quat_w': q.w }); }
  };
  /** Where handles are drawn: the corner while looking through, else the whole view. */
  private handleView() {
    return this.lookingThrough
      ? { rect: this.cornerRect(), camera: this.cornerCamera as THREE.Camera }
      : { rect: this.view.domElement.getBoundingClientRect(), camera: this.view.camera as THREE.Camera };
  }
  private pointer(event: PointerEvent) {
    const { rect } = this.handleView();
    return new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
  }
  private pointRay(event: PointerEvent) {
    this.view.scene.updateMatrixWorld(true);
    this.ray.setFromCamera(this.pointer(event), this.handleView().camera);
  }
  /** The pointer's angle around the roll ring, in the ring frame `inverse` maps into; null edge-on. */
  private ringAngle(event: PointerEvent, inverse: THREE.Matrix4): number | null {
    this.pointRay(event);
    const center = new THREE.Vector3().setFromMatrixPosition(this.rollRing.matrixWorld);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(this.rollRing.matrixWorld);
    const point = this.ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center), new THREE.Vector3());
    if (!point) return null;
    point.applyMatrix4(inverse);
    return Math.atan2(point.y, point.x);
  }
  private midpoint(ids: number[]) {
    const points = ids.map(id => this.pointersDown.get(id)!).filter(Boolean);
    return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  }
  private spread(ids: number[]) {
    if (ids.length < 2) return 0;
    const [a, b] = ids.map(id => this.pointersDown.get(id)!);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  private inCorner(event: PointerEvent) {
    const corner = this.cornerRect();
    return event.clientX >= corner.left && event.clientY >= corner.top;
  }
  /** The nearest visible handle within a finger's reach of the pointer, by its centre. */
  private pickHandle(event: PointerEvent): Handle | null {
    const { rect, camera } = this.handleView();
    const sets = this.handleSets();
    let best: Handle | null = null;
    let nearest = event.pointerType === 'touch' ? 28 : 14;
    this.view.scene.updateMatrixWorld(true);
    for (const [name, mesh] of this.handles) {
      if (!this.showHandles || !(name === 'roll' ? sets.roll : sets.orbit)) continue;
      const point = mesh.getWorldPosition(new THREE.Vector3()).project(camera);
      if (Math.abs(point.z) > 1) continue;
      const distance = Math.hypot(rect.left + (point.x + 1) / 2 * rect.width - event.clientX, rect.top + (1 - point.y) / 2 * rect.height - event.clientY);
      if (distance < nearest) { nearest = distance; best = name; }
    }
    return best;
  }
  private onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (this.lookingThrough && this.kind === 'info') {
      this.pointersDown.set(event.pointerId, { x: event.clientX, y: event.clientY });
      // A second finger, or shift with a mouse, pans the camera across its view;
      // a turn the first finger began gives way to it.
      const turning = this.dragging && !this.dragging.handle && !this.dragging.gizmo && !this.dragging.cornerTurn && !this.dragging.pan;
      if ((this.pointersDown.size === 2 && (!this.dragging || turning)) || (!this.dragging && event.shiftKey && !this.inCorner(event))) {
        const ids = [...this.pointersDown.keys()].slice(-2);
        const panning = event.shiftKey && this.pointersDown.size === 1 ? [event.pointerId] : ids;
        const mid = this.midpoint(panning);
        this.dragging = { pointer: event.pointerId, x: mid.x, y: mid.y, handle: null, start: { ...this.inputs }, pan: { ids: panning, spread: this.spread(panning) } };
        this.view.domElement.setPointerCapture(event.pointerId);
        event.stopImmediatePropagation();
        return;
      }
    }
    if (this.dragging) return;
    // A press on the transform gizmo is the gizmo's, however close a ring is.
    if (this.transformControl.enabled) {
      // pointerHover reads x/y as device coordinates, though its typings say PointerEvent.
      pickTransformGizmo(this.view.scene, this.transformControl, this.pointer(event));
      if (this.transformControl.axis !== null) return;
    }
    let handle: Handle | null = null;
    if (this.lookingThrough && this.cornerShown() && this.inCorner(event)) {
      // The corner is the handles' own: a press there never turns the camera.
      this.frameCorner();
      if (this.handleSets().gizmo) {
        const point = this.pointer(event);
        pickTransformGizmo(this.view.scene, this.transformControl, point);
        if (this.transformControl.axis !== null) {
          this.transformControl.pointerDown({ x: point.x, y: point.y, button: 0 } as unknown as PointerEvent);
          this.dragging = { pointer: event.pointerId, x: event.clientX, y: event.clientY, handle: null, start: { ...this.inputs }, gizmo: true };
          this.view.domElement.setPointerCapture(event.pointerId);
          event.stopImmediatePropagation();
          return;
        }
      }
      handle = this.pickHandle(event);
      if (!handle) {
        // Empty space turns the corner's own view, never the camera.
        this.dragging = { pointer: event.pointerId, x: event.clientX, y: event.clientY, handle: null, start: { ...this.inputs }, cornerTurn: { ...this.cornerTurn } };
        this.view.domElement.setPointerCapture(event.pointerId);
        event.stopImmediatePropagation();
        return;
      }
    } else if (!this.lookingThrough) {
      handle = this.pickHandle(event);
      if (!handle) return;
    }
    this.dragging = { pointer: event.pointerId, x: event.clientX, y: event.clientY, handle, start: { ...this.inputs } };
    if (handle === 'roll') {
      // Measured in the ring's plane as it was at the press, so the dot follows
      // the finger around the ring however the ring is tilted on screen.
      const inverse = this.rollRing.matrixWorld.clone().invert();
      this.dragging.rollFrame = { inverse, angle: this.ringAngle(event, inverse) ?? 0 };
    }
    this.view.domElement.setPointerCapture(event.pointerId);
    this.view.controls.enabled = false;
    event.stopImmediatePropagation();
  };
  private onMove = (event: PointerEvent) => {
    if (this.pointersDown.has(event.pointerId)) this.pointersDown.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const drag = this.dragging;
    if (drag?.pan) {
      if (!drag.pan.ids.includes(event.pointerId)) return;
      const mid = this.midpoint(drag.pan.ids);
      const panned = panDrag(this.kind, drag.start, mid.x - drag.x, mid.y - drag.y, this.view.domElement.getBoundingClientRect().height);
      // Fingers spreading apart move the camera in, as a wheel would.
      const spread = this.spread(drag.pan.ids);
      const zoom = drag.pan.spread > 0 && spread > 0 ? wheelChange(this.kind, { ...drag.start, ...panned }, Math.log(drag.pan.spread / spread) / 0.0015) : {};
      this.emit({ ...panned, ...zoom });
      event.stopImmediatePropagation();
      return;
    }
    if (!drag || drag.pointer !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (drag.cornerTurn) {
      this.cornerTurn = { yaw: drag.cornerTurn.yaw - dx * 0.5, pitch: Math.max(-160, Math.min(160, drag.cornerTurn.pitch + dy * 0.5)) };
      this.view.forceRender();
    } else if (drag.gizmo) {
      const point = this.pointer(event);
      this.transformControl.pointerMove({ x: point.x, y: point.y, button: -1 } as unknown as PointerEvent);
    } else if (!drag.handle) this.emit(lookDrag(this.kind, drag.start, dx, dy));
    else {
      const pose = cameraPose(this.kind, this.inputs);
      if (drag.handle === 'roll') {
        const angle = this.ringAngle(event, drag.rollFrame!.inverse);
        if (angle !== null) {
          const turned = numberInput(drag.start, 'roll', 0) + (angle - drag.rollFrame!.angle) / DEG;
          this.emit({ roll: ((turned + 180) % 360 + 360) % 360 - 180 });
        }
      }
      else {
        // Follow the pointer on the plane the handle moves in: the track's
        // horizontal plane for yaw, the vertical plane facing the camera for
        // pitch and distance.
        this.pointRay(event);
        const yaw = pose.yaw * DEG, pitch = pose.pitch * DEG;
        // The pitch arc is turned off the camera's heading; distance runs along it.
        const facing = drag.handle === 'pitch' ? yaw + PITCH_ARC_OFFSET * DEG : yaw;
        const plane = drag.handle === 'yaw'
          ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -(pose.target.y + this.trackHeight))
          : new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing)), pose.target);
        const point = this.ray.ray.intersectPlane(plane, new THREE.Vector3());
        if (point) {
          point.sub(pose.target);
          const angle = this.kind === 'angle';
          if (drag.handle === 'yaw') {
            const value = ((Math.atan2(point.x, point.z) / DEG - YAW_HANDLE_OFFSET) % 360 + 360) % 360;
            this.emit(angle ? { horizontal_angle: Math.round(value) % 360 } : { 'mode.yaw': value });
          } else if (drag.handle === 'pitch') {
            const value = limit(Math.atan2(point.y, point.x * Math.sin(facing) + point.z * Math.cos(facing)) / DEG, angle ? this.pitchLimits[0] : -89, angle ? this.pitchLimits[1] : 89);
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
    this.pointersDown.delete(event.pointerId);
    // Lifting either panning finger ends the pan; the other turns nothing until it lifts too.
    if (this.dragging?.pan && this.dragging.pan.ids.includes(event.pointerId)) this.dragging.pointer = event.pointerId;
    if (this.dragging?.pointer !== event.pointerId) return;
    if (this.dragging.gizmo) this.transformControl.pointerUp(event.type === 'pointercancel' ? null : { button: 0 } as unknown as PointerEvent);
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

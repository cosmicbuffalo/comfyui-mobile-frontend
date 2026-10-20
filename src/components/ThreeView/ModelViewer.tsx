import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { SparkRenderer } from '@sparkjsdev/spark';
import { t as translate, useI18n } from '@/i18n';
import { MODEL_EXTENSIONS, type Model3dMetadata } from '@/utils/model3d';
import { applyCameraUp, Viewport3d } from './Viewport3d';
import { disposeObject, sidecarUrl } from './modelAssets';

const SPLAT_EXTENSIONS = new Set(['splat', 'spz', 'ksplat']);

// Spark sorts in a promise it never awaits: a GPU depth readback, then a worker
// call. Losing the WebGL context or disposing the renderer mid-sort rejects that
// promise unhandled, so stop new sorts and wait for the current one before
// tearing down. A failed sort never clears `sorting`, hence the bounded wait.
function releaseSpark(spark: SparkRenderer, done: () => void, attempts = 40) {
  spark.autoUpdate = false;
  spark.sortDirty = false;
  clearTimeout(spark.sortTimeoutId);
  spark.sortTimeoutId = -1;
  if (spark.sorting && attempts > 0) {
    setTimeout(() => releaseSpark(spark, done, attempts - 1), 50);
    return;
  }
  spark.dispose();
  done();
}

export default function ModelViewer({ src, filename, metadata, onReady, onCapture, onError, pageScroll = false, toolbarClassName = 'bottom-2 left-2 right-2' }: {
  src: string; filename: string; metadata?: Model3dMetadata; onReady?: () => void;
  /** Receives one square snapshot once the model has rendered. */
  onCapture?: (snapshot: Blob) => void;
  /** Called when the model can't be loaded; `status` is the HTTP status when the fetch failed. */
  onError?: (status?: number) => void;
  /** Leave vertical swipes to the page: a preview inside a scrolling list. */
  pageScroll?: boolean;
  /** Where the view controls sit; the full-screen viewer keeps its own actions at the bottom. */
  toolbarClassName?: string;
}) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [animated, setAnimated] = useState(false);
  const [playing, setPlaying] = useState(true);
  const playingRef = useRef(playing);
  const resumeAnimation = useRef<() => void>(() => {});
  useEffect(() => {
    playingRef.current = playing;
    if (playing) resumeAnimation.current();
  }, [playing]);
  const viewport = useRef<Viewport3d | null>(null);
  const model = useRef<THREE.Object3D | null>(null);
  const frame = useRef(0);
  const ready = useRef(onReady);
  const reset = useRef<() => void>(() => {});
  ready.current = onReady;
  const capture = useRef(onCapture);
  capture.current = onCapture;
  const failed = useRef(onError);
  failed.current = onError;
  // History refreshes rebuild output descriptors; reload only when the metadata itself changes.
  const metadataKey = JSON.stringify(metadata ?? {});

  useEffect(() => {
    if (!container.current) return;
    let removed = false;
    let object: THREE.Object3D | null = null;
    let splatDispose: ((done: () => void) => void) | undefined;
    const releaseSplat = (done: () => void = () => {}) => {
      const dispose = splatDispose;
      splatDispose = undefined;
      if (dispose) dispose(done); else done();
    };
    let mixer: THREE.AnimationMixer | undefined;
    let splatBounds: (() => THREE.Box3) | undefined;
    let sparkRenderer: SparkRenderer | undefined;
    let sidecars: THREE.LoadingManager | undefined;
    let instance: Viewport3d;
    let status: number | undefined;
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    setAnimated(false);
    const load = async () => {
      const extension = filename.split('.').pop()?.toLowerCase() ?? '';
      if (!MODEL_EXTENSIONS.has(extension)) throw new Error(translate('No preview for .{extension} files', { extension }));
      instance = new Viewport3d(container.current!, { pageScroll });
      viewport.current = instance;
      // The splat renderer is a large chunk; fetch it alongside the file when the extension already says splat.
      const sparkModule = SPLAT_EXTENSIONS.has(extension) ? import('@sparkjsdev/spark') : null;
      // The file fetch can fail or be cancelled before this speculative import
      // is awaited. Handle an early rejection now; awaiting it still reports it.
      void sparkModule?.catch(() => {});
      const response = await fetch(src, { signal: abort.signal });
      if (!response.ok) {
        status = response.status;
        throw new Error(translate('Unable to load model ({status})', { status: response.status }));
      }
      const bytes = await response.arrayBuffer();
      if (removed) return;
      // A per-viewer manager keeps the sidecar mapping out of three's global DefaultLoadingManager.
      sidecars = new THREE.LoadingManager().setURLModifier(url => sidecarUrl(src, url));
      let animations: THREE.AnimationClip[] = [];
      const plyHeader = extension === 'ply' ? new TextDecoder().decode(bytes.slice(0, 8192)).split('end_header')[0] : '';
      const splat = SPLAT_EXTENSIONS.has(extension) || /property float (?:scale_0|f_dc_0)/.test(plyHeader);
      if (splat) {
        const { SparkRenderer, SplatMesh } = await (sparkModule ?? import('@sparkjsdev/spark'));
        // Spark draws splats only through a SparkRenderer in the scene, and asks
        // for a frame whenever a sort lands, so the view renders on demand.
        const spark = new SparkRenderer({ renderer: instance.renderer, onDirty: () => instance.forceRender() });
        instance.scene.add(spark);
        sparkRenderer = spark;
        const mesh = new SplatMesh({ fileBytes: bytes, fileName: filename });
        splatDispose = done => { mesh.dispose(); instance.scene.remove(spark); releaseSpark(spark, done); };
        await mesh.initialized;
        mesh.quaternion.set(1, 0, 0, 0);
        splatBounds = () => { mesh.updateWorldMatrix(true, false); return mesh.getBoundingBox(false).clone().applyMatrix4(mesh.matrixWorld); };
        object = new THREE.Group();
        object.add(mesh);
      } else if (extension === 'glb' || extension === 'gltf') {
        const gltf = await new GLTFLoader(sidecars).parseAsync(bytes, '');
        object = gltf.scene;
        animations = gltf.animations;
      } else if (extension === 'obj') object = new OBJLoader().parse(new TextDecoder().decode(bytes));
      else if (extension === 'fbx') { object = new FBXLoader(sidecars).parse(bytes, ''); animations = object.animations; }
      else {
        const geometry = extension === 'stl' ? new STLLoader().parse(bytes) : new PLYLoader().parse(bytes);
        const vertexColors = geometry.hasAttribute('color');
        if (extension === 'ply' && !geometry.index) object = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, vertexColors }));
        else { geometry.computeVertexNormals(); object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xaaaaaa, vertexColors, side: THREE.DoubleSide })); }
      }
      if (removed) { releaseSplat(); disposeObject(object); return; }
      model.current = object;
      instance.scene.add(object);
      const { camera, transform } = JSON.parse(metadataKey) as Model3dMetadata;
      if (transform) {
        object.position.copy(transform.position);
        object.quaternion.copy(transform.quaternion).normalize();
        object.scale.copy(transform.scale);
      }
      const bounds = splatBounds?.() ?? new THREE.Box3().setFromObject(object);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z, 1);
      reset.current = () => {
        instance.setRenderCamera(null);
        instance.setCameraState({ position: center.clone().add(new THREE.Vector3(radius, radius * 0.65, radius * 1.8)), target: center, zoom: 1, cameraType: 'perspective' });
      };
      reset.current();
      if (camera) {
        if (camera.cameraType === 'orthographic') {
          // Core sends no frustum: keep its height (or the model's) and follow the canvas aspect.
          const half = camera.frustum ? (camera.frustum.top - camera.frustum.bottom) / 2 : radius;
          const ortho = new THREE.OrthographicCamera(-half, half, half, -half, camera.near ?? 0.01, camera.far ?? 10000);
          ortho.position.copy(camera.position);
          applyCameraUp(ortho, camera);
          ortho.lookAt(camera.target.x, camera.target.y, camera.target.z);
          if (camera.quaternion) ortho.quaternion.copy(camera.quaternion).normalize();
          ortho.zoom = camera.zoom;
          instance.addPreRenderCallback(() => {
            const aspect = instance.domElement.width / instance.domElement.height;
            ortho.left = -half * aspect;
            ortho.right = half * aspect;
            ortho.updateProjectionMatrix();
          });
          instance.setRenderCamera(ortho);
          instance.controls.object = ortho;
          instance.controls.target.copy(camera.target);
          instance.controls.enabled = true;
        } else instance.setCameraState(camera);
      }
      if (animations.length) {
        mixer = new THREE.AnimationMixer(object);
        mixer.clipAction(animations[0]).play();
        setAnimated(true);
        const clock = new THREE.Clock();
        // Advance only while playing; resuming restarts the loop.
        const animate = () => {
          frame.current = 0;
          if (removed || !playingRef.current) return;
          mixer!.update(clock.getDelta());
          instance.forceRender();
          frame.current = requestAnimationFrame(animate);
        };
        resumeAnimation.current = () => {
          if (removed || frame.current) return;
          clock.getDelta();
          animate();
        };
        animate();
      }
      instance.forceRender();
      setLoading(false);
      ready.current?.();
      if (capture.current) {
        // Splats appear only once Spark's first depth sort has landed.
        for (let wait = 0; sparkRenderer && wait < 30 && (wait < 3 || sparkRenderer.sorting || sparkRenderer.sortDirty); wait++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (removed) return;
        }
        const snapshot = await instance.capture(256);
        if (snapshot && !removed) capture.current?.(snapshot);
      }
    };
    void load().catch(cause => {
      releaseSplat();
      if (removed) return;
      setError(cause instanceof Error ? cause.message : translate('Unable to load model'));
      setLoading(false);
      ready.current?.();
      failed.current?.(status);
    });
    return () => {
      removed = true;
      abort.abort();
      sidecars?.abort();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      resumeAnimation.current = () => {};
      mixer?.stopAllAction();
      if (object) { mixer?.uncacheRoot(object); instance?.scene.remove(object); disposeObject(object); }
      viewport.current = null;
      model.current = null;
      releaseSplat(() => instance?.remove());
    };
  }, [src, filename, metadataKey, pageScroll]);

  useEffect(() => {
    model.current?.traverse(child => {
      const material = (child as THREE.Mesh).material;
      for (const entry of Array.isArray(material) ? material : material ? [material] : []) if ('wireframe' in entry) entry.wireframe = wireframe;
    });
    viewport.current?.forceRender();
  }, [wireframe, loading]);

  return <div className="relative h-full min-h-64" data-model-viewer>
    <div ref={container} className="absolute inset-0" />
    {loading && <span className="absolute inset-0 grid place-items-center pointer-events-none text-sm">{t('Loading 3D model…')}</span>}
    {error && <p role="status" className="absolute inset-0 grid place-items-center bg-slate-900 p-4 text-sm">{error}</p>}
    <div className={`absolute ${toolbarClassName} flex flex-wrap gap-2 text-xs`}>
      <button type="button" className="rounded bg-slate-900/90 p-2" onClick={() => reset.current()}>{t('Reset view')}</button>
      <button type="button" className="rounded bg-slate-900/90 p-2" aria-pressed={wireframe} onClick={() => setWireframe(!wireframe)}>{t('Wireframe')}</button>
      {animated && <button type="button" className="rounded bg-slate-900/90 p-2" aria-pressed={playing} onClick={() => setPlaying(!playing)}>{t('Animation')}</button>}
    </div>
  </div>;
}

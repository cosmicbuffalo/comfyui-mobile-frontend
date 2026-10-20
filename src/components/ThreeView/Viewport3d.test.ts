import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Model3dMetadata } from '@/utils/model3d';
import { Viewport3d } from './Viewport3d';

type CameraState = NonNullable<Model3dMetadata['camera']>;
const controlsToDispose: OrbitControls[] = [];

afterEach(() => {
  for (const controls of controlsToDispose.splice(0)) controls.dispose();
});

function makeViewport() {
  const camera = new THREE.PerspectiveCamera();
  const controls = new OrbitControls(camera, document.createElement('canvas'));
  controlsToDispose.push(controls);
  // Exercise the real restore method and controls without allocating WebGL.
  const view = Object.assign(Object.create(Viewport3d.prototype) as Viewport3d, {
    camera, controls, forceRender: vi.fn(),
  });
  return { view, camera, controls };
}

function rolledState(): CameraState {
  // Core CreateCameraInfo sends the quaternion and useCustomUp, without customUp.
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(4, 3, 5);
  const target = new THREE.Vector3(1, -1, 0);
  camera.lookAt(target);
  camera.rotateZ(Math.PI / 2);
  return {
    cameraType: 'perspective', position: camera.position.clone(), target,
    zoom: 1.5, fov: 50, quaternion: camera.quaternion.clone(), useCustomUp: true,
  };
}

describe('perspective output camera restoration', () => {
  it('preserves core camera roll through restoration and subsequent controls updates', () => {
    const { view, camera, controls } = makeViewport();
    const state = rolledState();
    const expected = new THREE.Quaternion().copy(state.quaternion!);
    view.setCameraState(state);
    controls.update();
    expect(camera.quaternion.angleTo(expected)).toBeCloseTo(0, 6);
    expect(camera.up.distanceTo(new THREE.Vector3(0, 1, 0).applyQuaternion(expected))).toBeCloseTo(0, 6);
    expect(camera.position.distanceTo(new THREE.Vector3().copy(state.position))).toBeCloseTo(0, 6);
    expect(controls.target.distanceTo(new THREE.Vector3().copy(state.target))).toBeCloseTo(0, 6);
    expect(camera.zoom).toBe(1.5);
    expect(camera.fov).toBe(50);
  });

  it('uses a saved custom up axis even when no quaternion is supplied', () => {
    const { view, camera, controls } = makeViewport();
    view.setCameraState({
      cameraType: 'perspective', position: { x: 0, y: 0, z: 5 },
      target: { x: 0, y: 0, z: 0 }, zoom: 1,
      useCustomUp: true, customUp: { x: -2, y: 0, z: 0 },
    });
    controls.update();
    expect(camera.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2))).toBeCloseTo(0, 6);
    expect(camera.up.toArray()).toEqual([-1, 0, 0]);
  });

  it.each([undefined, false])('resets the up axis for an upright state with useCustomUp=%s', useCustomUp => {
    const { view, camera, controls } = makeViewport();
    const state = rolledState();
    view.setCameraState(state);
    view.setCameraState({ ...state, useCustomUp });
    controls.update();
    const upright = new THREE.PerspectiveCamera();
    upright.position.copy(state.position);
    upright.lookAt(state.target.x, state.target.y, state.target.z);
    expect(camera.quaternion.angleTo(upright.quaternion)).toBeCloseTo(0, 6);
    expect(camera.up.toArray()).toEqual([0, 1, 0]);
  });

  it('falls back to the core quaternion when a custom up vector is zero', () => {
    const { view, camera } = makeViewport();
    const state = { ...rolledState(), customUp: { x: 0, y: 0, z: 0 } };
    view.setCameraState(state);
    expect(camera.quaternion.angleTo(new THREE.Quaternion().copy(state.quaternion!))).toBeCloseTo(0, 6);
  });
});

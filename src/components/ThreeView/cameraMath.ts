import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';

export type CameraInputs = Record<string, unknown>;
export type CameraKind = 'angle' | 'info';
export const limit = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function numberInput(inputs: CameraInputs, name: string, fallback: number): number {
  const value = inputs[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
export function orbitPosition(yaw: number, pitch: number, radius: number, target: Vector3): Vector3 {
  const azimuth = MathUtils.degToRad(yaw);
  const elevation = MathUtils.degToRad(pitch);
  return target.clone().add(new Vector3(
    radius * Math.cos(elevation) * Math.sin(azimuth),
    radius * Math.sin(elevation),
    radius * Math.cos(elevation) * Math.cos(azimuth),
  ));
}
export function cameraPose(kind: CameraKind, inputs: CameraInputs) {
  const angle = kind === 'angle';
  const mode = angle ? 'orbit' : String(inputs.mode ?? 'orbit');
  const target = angle ? new Vector3() : new Vector3(numberInput(inputs, 'target_x', 0), numberInput(inputs, 'target_y', 0), numberInput(inputs, 'target_z', 0));
  const yaw = numberInput(inputs, angle ? 'horizontal_angle' : 'mode.yaw', angle ? 0 : 35);
  const pitch = numberInput(inputs, angle ? 'vertical_angle' : 'mode.pitch', angle ? 0 : 30);
  const distance = angle ? 6 : numberInput(inputs, 'mode.distance', 4);
  const position = mode === 'orbit' ? orbitPosition(yaw, pitch, distance, target) : new Vector3(
    numberInput(inputs, 'mode.position_x', 4), numberInput(inputs, 'mode.position_y', 4), numberInput(inputs, 'mode.position_z', 4),
  );
  const fov = angle ? 35 : numberInput(inputs, 'fov', 35);
  const zoom = angle ? 1 + 0.875 * numberInput(inputs, 'zoom', 5) / 10 : numberInput(inputs, 'zoom', 1);
  const camera = new PerspectiveCamera();
  camera.position.copy(position);
  camera.lookAt(target);
  if (mode === 'quaternion') {
    camera.quaternion.set(numberInput(inputs, 'mode.quat_x', 0), numberInput(inputs, 'mode.quat_y', 0), numberInput(inputs, 'mode.quat_z', 0), numberInput(inputs, 'mode.quat_w', 1)).normalize();
  } else camera.rotateZ(MathUtils.degToRad(numberInput(inputs, 'roll', 0)));
  return { position, target, quaternion: camera.quaternion.clone(), fov, zoom, yaw, pitch, distance, mode, orthographic: !angle && inputs.camera_type === 'orthographic' };
}

export function lookDrag(kind: CameraKind, inputs: CameraInputs, dx: number, dy: number): CameraInputs {
  if (kind === 'angle') return {
    horizontal_angle: Math.round(((numberInput(inputs, 'horizontal_angle', 0) - dx * 0.5) % 360 + 360) % 360),
    vertical_angle: Math.round(limit(numberInput(inputs, 'vertical_angle', 0) + dy * 0.5, -30, 60)),
  };
  const sensitivity = MathUtils.radToDeg(0.005);
  if (inputs.mode === 'look_at' || inputs.mode === 'quaternion') {
    const pose = cameraPose(kind, inputs);
    const offset = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -dx * 0.005);
    if (inputs.mode === 'quaternion') {
      const q = pose.quaternion.premultiply(offset).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -dy * 0.005)).normalize();
      return { 'mode.quat_x': q.x, 'mode.quat_y': q.y, 'mode.quat_z': q.z, 'mode.quat_w': q.w };
    }
    const relative = pose.target.clone().sub(pose.position);
    const yaw = MathUtils.radToDeg(Math.atan2(relative.x, relative.z)) - dx * sensitivity;
    const pitch = limit(MathUtils.radToDeg(Math.atan2(relative.y, Math.hypot(relative.x, relative.z))) - dy * sensitivity, -89, 89);
    const p = orbitPosition(yaw, pitch, relative.length(), pose.position);
    return { target_x: p.x, target_y: p.y, target_z: p.z };
  }
  return { 'mode.yaw': ((numberInput(inputs, 'mode.yaw', 35) - dx * sensitivity) % 360 + 360) % 360, 'mode.pitch': limit(numberInput(inputs, 'mode.pitch', 30) - dy * sensitivity, -89, 89) };
}

export function wheelChange(kind: CameraKind, inputs: CameraInputs, delta: number): CameraInputs {
  if (kind === 'angle') return { zoom: limit(numberInput(inputs, 'zoom', 5) - delta * 0.01, 0, 10) };
  const pose = cameraPose(kind, inputs);
  const multiplier = Math.exp(delta * 0.0015);
  if (pose.orthographic) return { zoom: limit(pose.zoom / multiplier, 0.05, 100) };
  if (pose.mode === 'orbit') return { 'mode.distance': limit(pose.distance * multiplier, 0.5, 100) };
  let position: Vector3;
  if (pose.mode === 'quaternion') position = pose.position.clone().add(new Vector3(0, 0, -1).applyQuaternion(pose.quaternion).multiplyScalar(-delta * 0.01));
  else {
    const offset = pose.position.clone().sub(pose.target);
    const distance = offset.length();
    if (distance < 1e-6) return {};
    position = pose.target.clone().add(offset.multiplyScalar(limit(distance * multiplier, 0.5, 100) / distance));
  }
  return { 'mode.position_x': position.x, 'mode.position_y': position.y, 'mode.position_z': position.z };
}

import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { cameraPose, lookDrag, orbitPosition, wheelChange } from './cameraMath';

describe('camera node contracts', () => {
  it('places the angle camera six units in front and applies the backend zoom scale', () => {
    const pose = cameraPose('angle', { horizontal_angle: 0, vertical_angle: 0, zoom: 5 });
    expect(pose.position.toArray()).toEqual([0, 0, 6]);
    expect(pose.zoom).toBe(1.4375);
    expect(pose.fov).toBe(35);
  });
  it('orbits around a translated target in right-handed Y-up space', () => {
    const position = orbitPosition(90, 0, 4, new Vector3(1, 2, 3));
    expect(position.x).toBeCloseTo(5);
    expect(position.y).toBeCloseTo(2);
    expect(position.z).toBeCloseTo(3);
  });
  it('uses explicit quaternion position and normalizes an empty rotation', () => {
    const pose = cameraPose('info', { mode: 'quaternion', 'mode.position_x': 8, 'mode.quat_x': 0, 'mode.quat_y': 0, 'mode.quat_z': 0, 'mode.quat_w': 0 });
    expect(pose.position.x).toBe(8);
    expect(pose.quaternion.toArray()).toEqual([0, 0, 0, 1]);
  });
  it('rolls about the camera local positive Z axis', () => {
    const pose = cameraPose('info', { mode: 'look_at', 'mode.position_x': 0, 'mode.position_y': 0, 'mode.position_z': 4, roll: 90 });
    expect(pose.quaternion.z).toBeCloseTo(Math.SQRT1_2);
    expect(pose.quaternion.w).toBeCloseTo(Math.SQRT1_2);
  });
  it('wraps angle dragging and keeps elevation within the node limits', () => {
    expect(lookDrag('angle', { horizontal_angle: 5, vertical_angle: 58 }, 20, 20)).toEqual({ horizontal_angle: 355, vertical_angle: 60 });
  });
  it('turns the orbit camera with the stock look-through sensitivity and signs', () => {
    const change = lookDrag('info', { mode: 'orbit', 'mode.yaw': 35, 'mode.pitch': 30 }, 40, 20);
    expect(change['mode.yaw']).toBeCloseTo(35 - 0.2 * 180 / Math.PI);
    expect(lookDrag('info', { mode: 'orbit', 'mode.yaw': 5 }, 40, 0)['mode.yaw']).toBeCloseTo(5 - 0.2 * 180 / Math.PI + 360);
    expect(change['mode.pitch']).toBeCloseTo(30 - 0.1 * 180 / Math.PI);
  });
  it('looks around from a fixed look-at position by moving the target', () => {
    const inputs = { mode: 'look_at', 'mode.position_x': 0, 'mode.position_y': 0, 'mode.position_z': 4 };
    const change = lookDrag('info', inputs, 10, 0);
    expect(change).not.toHaveProperty('mode.position_x');
    const target = new Vector3(Number(change.target_x), Number(change.target_y), Number(change.target_z));
    expect(target.distanceTo(new Vector3(0, 0, 4))).toBeCloseTo(4);
  });
  it('keeps quaternion look-through rotations normalized', () => {
    const change = lookDrag('info', { mode: 'quaternion', 'mode.quat_w': 1 }, 30, 20);
    expect(Math.hypot(...Object.values(change).map(Number))).toBeCloseTo(1);
  });
  it('changes orthographic zoom without moving the camera', () => {
    const change = wheelChange('info', { mode: 'orbit', camera_type: 'orthographic', zoom: 1 }, 100);
    expect(Object.keys(change)).toEqual(['zoom']);
    expect(change.zoom).toBeCloseTo(Math.exp(-0.15));
  });
  it('dollies explicit quaternion cameras along their local view direction', () => {
    expect(wheelChange('info', { mode: 'quaternion', 'mode.position_x': 0, 'mode.position_y': 0, 'mode.position_z': 4 }, 100)).toEqual({ 'mode.position_x': 0, 'mode.position_y': 0, 'mode.position_z': 5 });
  });
  it('bounds interactive orbit distance and lens zoom', () => {
    expect(wheelChange('info', { 'mode.distance': 1 }, -10000)).toEqual({ 'mode.distance': 0.5 });
    expect(wheelChange('angle', { zoom: 9 }, -1000)).toEqual({ zoom: 10 });
  });
});

import { describe, expect, it } from 'vitest';
import {
  catmullRomSpline,
  getEffectiveBrushSize,
  getEffectiveHardness,
  resampleSegment,
  smoothPath,
  stampSpacing,
} from '../brush';

describe('effective brush size and hardness', () => {
  it('leaves a fully hard brush alone', () => {
    expect(getEffectiveBrushSize(10, 1)).toBe(10);
    expect(getEffectiveHardness(10, 1, 10)).toBe(1);
  });

  it('grows a soft brush so the falloff has room', () => {
    expect(getEffectiveBrushSize(10, 0)).toBeCloseTo(15);
  });

  it('keeps the solid core at the radius the user asked for', () => {
    // The whole point of the pair: the stamp gets bigger, but `size * hardness`
    // pixels of it stay fully opaque, so the brush does not feel like it grew.
    const size = 20;
    const hardness = 0.5;
    const effective = getEffectiveBrushSize(size, hardness);
    const adjusted = getEffectiveHardness(size, hardness, effective);
    expect(effective * adjusted).toBeCloseTo(size * hardness);
  });

  it('returns zero hardness for a degenerate size rather than dividing by zero', () => {
    expect(getEffectiveHardness(0, 1, 0)).toBe(0);
  });
});

describe('stampSpacing', () => {
  it('scales with the radius', () => {
    expect(stampSpacing(100, 10)).toBe(10);
    expect(stampSpacing(10, 10)).toBe(1);
  });

  it('never returns zero', () => {
    // A zero step would stamp forever in one place and hang the stroke.
    expect(stampSpacing(1, 1)).toBeGreaterThan(0);
    expect(stampSpacing(0, 0)).toBe(0.5);
  });
});

describe('resampleSegment', () => {
  it('places points at even spacing along a straight line', () => {
    const { points } = resampleSegment([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2, 0);
    expect(points.map((p) => p.x)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('carries the leftover distance into the next call', () => {
    // Without the carry, stamps restart at every pointer event and bunch up
    // wherever the browser happened to sample the touch.
    const first = resampleSegment([{ x: 0, y: 0 }, { x: 5, y: 0 }], 2, 0);
    expect(first.remainder).toBe(1);

    const second = resampleSegment([{ x: 5, y: 0 }, { x: 10, y: 0 }], 2, first.remainder);
    expect(second.points[0].x).toBe(6);
  });

  it('handles a zero-length segment without looping forever', () => {
    const { points } = resampleSegment([{ x: 1, y: 1 }, { x: 1, y: 1 }], 2, 0);
    expect(points).toEqual([{ x: 1, y: 1 }]);
  });

  it('returns the offset untouched for an empty path', () => {
    expect(resampleSegment([], 2, 3)).toEqual({ points: [], remainder: 3 });
  });
});

describe('catmullRomSpline', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 1, y: 0 };
  const p2 = { x: 2, y: 0 };
  const p3 = { x: 3, y: 0 };

  it('passes through its two inner control points', () => {
    expect(catmullRomSpline(p0, p1, p2, p3, 0).x).toBeCloseTo(1);
    expect(catmullRomSpline(p0, p1, p2, p3, 1).x).toBeCloseTo(2);
  });

  it('stays on a straight line for collinear points', () => {
    expect(catmullRomSpline(p0, p1, p2, p3, 0.5).y).toBeCloseTo(0);
  });

  it('does not overshoot the segment', () => {
    // The centripetal parameterisation is chosen precisely so a fast flick
    // cannot loop back on itself.
    const curve = { x: 1, y: 5 };
    for (let t = 0; t <= 1; t += 0.1) {
      const point = catmullRomSpline(p0, p1, curve, p3, t);
      expect(point.x).toBeGreaterThanOrEqual(-0.01);
      expect(point.x).toBeLessThanOrEqual(3.01);
    }
  });

  it('survives coincident control points', () => {
    const point = catmullRomSpline(p1, p1, p1, p1, 0.5);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});

describe('smoothPath', () => {
  it('leaves a path too short to spline alone', () => {
    const short = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(smoothPath(short)).toEqual(short);
  });

  it('densifies a longer path', () => {
    const path = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 0 }, { x: 3, y: 2 }];
    expect(smoothPath(path, 4).length).toBeGreaterThan(path.length);
  });
});

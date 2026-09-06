import type { Point } from './types';

/**
 * Brush geometry, ported from ComfyUI's `brushUtils.ts` and `splineUtils.ts`.
 *
 * The desktop editor has a WebGPU stamping path with a 2D-canvas fallback; we
 * only port the geometry, because the mobile editor stamps on a plain 2D
 * context. What has to match is the *shape* of a stamp and the *spacing* of
 * stamps along a stroke — get either wrong and a mask drawn on a phone has
 * visibly different edges from the same stroke drawn on a desktop.
 */

/** Scale applied to the radius at zero hardness, so a soft brush has room to fall off. */
const MAX_SOFTNESS_SCALE = 1.5;

/**
 * A softer brush is drawn larger so the falloff has somewhere to go.
 * `getEffectiveHardness` then shrinks the hardness to keep the solid core at
 * the radius the user actually asked for.
 */
export function getEffectiveBrushSize(size: number, hardness: number): number {
  return size * (1.0 + (1.0 - hardness) * (MAX_SOFTNESS_SCALE - 1.0));
}

export function getEffectiveHardness(
  size: number,
  hardness: number,
  effectiveSize: number,
): number {
  if (effectiveSize <= 0) return 0;
  return (size * hardness) / effectiveSize;
}

/**
 * Centripetal Catmull-Rom spline (alpha = 0.5), evaluated between `p1` and `p2`.
 *
 * The centripetal parameterisation is the reason upstream uses this rather than
 * a uniform Catmull-Rom: it cannot form cusps or overshoot, so a fast flick
 * across the screen smooths instead of looping back on itself.
 */
export function catmullRomSpline(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const alpha = 0.5;
  const nextT = (prev: number, a: Point, b: Point) => prev + Math.hypot(b.x - a.x, b.y - a.y) ** alpha;

  const t0 = 0;
  const t1 = nextT(t0, p0, p1);
  const t2 = nextT(t1, p1, p2);
  const t3 = nextT(t2, p2, p3);

  const tInterp = t1 + (t2 - t1) * t;

  // Barry-Goldman pyramidal evaluation. Coincident control points make some of
  // these spans zero-length, hence the guard.
  const interp = (a: Point, b: Point, ta: number, tb: number, at: number): Point => {
    if (Math.abs(tb - ta) < 0.0001) return a;
    const k = (at - ta) / (tb - ta);
    return { x: a.x * (1 - k) + b.x * k, y: a.y * (1 - k) + b.y * k };
  };

  const a1 = interp(p0, p1, t0, t1, tInterp);
  const a2 = interp(p1, p2, t1, t2, tInterp);
  const a3 = interp(p2, p3, t2, t3, tInterp);
  const b1 = interp(a1, a2, t0, t2, tInterp);
  const b2 = interp(a2, a3, t1, t3, tInterp);
  return interp(b1, b2, t1, t2, tInterp);
}

/**
 * Walk a polyline placing a point every `spacing` units.
 *
 * `startOffset` carries the leftover distance from the previous segment, and
 * the returned `remainder` feeds the next call. Without that carry, stamps
 * would restart at every pointer event and bunch up wherever the browser
 * happened to sample the touch.
 */
export function resampleSegment(
  points: Point[],
  spacing: number,
  startOffset: number,
): { points: Point[]; remainder: number } {
  if (points.length === 0) return { points: [], remainder: startOffset };

  const result: Point[] = [];
  let currentDist = 0;
  let nextSampleDist = startOffset;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const segmentLen = Math.hypot(dx, dy);

    if (segmentLen < 0.0001) {
      while (nextSampleDist <= currentDist) {
        result.push(p1);
        nextSampleDist += spacing;
      }
      continue;
    }

    while (nextSampleDist <= currentDist + segmentLen) {
      const t = (nextSampleDist - currentDist) / segmentLen;
      result.push({ x: p1.x + t * dx, y: p1.y + t * dy });
      nextSampleDist += spacing;
    }

    currentDist += segmentLen;
  }

  return { points: result, remainder: nextSampleDist - currentDist };
}

/**
 * Smooth a raw pointer path into a denser polyline before resampling.
 *
 * Touch input is sampled coarsely and unevenly, so drawing straight between raw
 * points gives visibly faceted curves. Fewer than four points cannot define a
 * Catmull-Rom segment, so those are returned unchanged.
 */
export function smoothPath(points: Point[], subdivisions = 8): Point[] {
  if (points.length < 4) return [...points];

  const out: Point[] = [points[0]];
  for (let i = 0; i < points.length - 3; i++) {
    for (let step = 1; step <= subdivisions; step++) {
      out.push(catmullRomSpline(points[i], points[i + 1], points[i + 2], points[i + 3], step / subdivisions));
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Distance between stamps along a stroke.
 *
 * `stepSize` is a percentage of the radius, so a large brush strides further
 * than a small one for the same setting. Clamped to at least half a pixel: a
 * zero step would stamp forever in one place.
 */
export function stampSpacing(radius: number, stepSize: number): number {
  return Math.max(0.5, (radius * stepSize) / 100);
}

/**
 * Render one brush stamp into an offscreen canvas.
 *
 * A round brush is a radial alpha ramp: solid out to `radius * hardness`, then
 * linearly to zero at the rim. A square brush is flat — upstream draws it as a
 * plain rect, with no falloff.
 *
 * Callers should cache these per (radius, hardness, colour, opacity, shape);
 * building one is a full pixel loop.
 */
export function buildBrushStamp(
  radius: number,
  hardness: number,
  color: { r: number; g: number; b: number },
  opacity: number,
  shape: 'arc' | 'rect',
): HTMLCanvasElement {
  const size = Math.max(1, Math.ceil(radius * 2));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  if (shape === 'rect') {
    ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${opacity})`;
    ctx.fillRect(0, 0, size, size);
    return canvas;
  }

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;
  const center = size / 2;
  const hardRadius = radius * hardness;
  const fadeRange = radius - hardRadius;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
      let alpha: number;
      if (distance <= hardRadius) {
        alpha = 1;
      } else if (distance <= radius) {
        // fadeRange is zero only when hardness === 1, and that case is already
        // handled by the branch above, so this cannot divide by zero.
        alpha = 1 - (distance - hardRadius) / fadeRange;
      } else {
        alpha = 0;
      }

      const index = (y * size + x) * 4;
      data[index] = color.r;
      data[index + 1] = color.g;
      data[index + 2] = color.b;
      data[index + 3] = Math.round(alpha * opacity * 255);
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

import type { ColorComparisonMethod, Rgb } from './types';

/**
 * Colour-distance predicates for the Color Select tool, ported from ComfyUI's
 * `useCanvasTools.ts`.
 *
 * All three methods take the same `tolerance` on a 0-255 scale even though HSL
 * and LAB live in very different units — upstream normalizes each distance back
 * onto 0-255 so one slider drives all three. Keeping that normalization is what
 * makes a tolerance value mean the same thing here as it does on the desktop.
 */

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** sRGB -> CIE L*a*b* via XYZ, D65 white point. */
export function rgbToLab(rgb: Rgb): { l: number; a: number; b: number } {
  const linearize = (channel: number) => {
    const v = channel / 255;
    return (v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92) * 100;
  };

  const r = linearize(rgb.r);
  const g = linearize(rgb.g);
  const b = linearize(rgb.b);

  const x = r * 0.4124 + g * 0.3576 + b * 0.1805;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = r * 0.0193 + g * 0.1192 + b * 0.9505;

  const xyz = [x / 95.047, y / 100.0, z / 108.883].map((v) =>
    v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116,
  );

  return {
    l: 116 * xyz[1] - 16,
    a: 500 * (xyz[0] - xyz[1]),
    b: 200 * (xyz[1] - xyz[2]),
  };
}

function inRangeSimple(pixel: Rgb, target: Rgb, tolerance: number): boolean {
  const distance = Math.sqrt(
    (pixel.r - target.r) ** 2 + (pixel.g - target.g) ** 2 + (pixel.b - target.b) ** 2,
  );
  return distance <= tolerance;
}

function inRangeHsl(pixel: Rgb, target: Rgb, tolerance: number): boolean {
  const p = rgbToHsl(pixel.r, pixel.g, pixel.b);
  const t = rgbToHsl(target.r, target.g, target.b);

  // Each axis is rescaled onto 0-255 before the euclidean distance so the
  // tolerance slider reads the same as it does for the simple method.
  const hueDiff = Math.abs(p.h - t.h);
  const satDiff = Math.abs(p.s - t.s);
  const lightDiff = Math.abs(p.l - t.l);

  const distance = Math.sqrt(
    ((hueDiff / 360) * 255) ** 2 + ((satDiff / 100) * 255) ** 2 + ((lightDiff / 100) * 255) ** 2,
  );
  return distance <= tolerance;
}

function inRangeLab(pixel: Rgb, target: Rgb, tolerance: number): boolean {
  const p = rgbToLab(pixel);
  const t = rgbToLab(target);
  const deltaE = Math.sqrt((p.l - t.l) ** 2 + (p.a - t.a) ** 2 + (p.b - t.b) ** 2);
  return (deltaE / 100) * 255 <= tolerance;
}

export function isPixelInRange(
  pixel: Rgb,
  target: Rgb,
  tolerance: number,
  method: ColorComparisonMethod,
): boolean {
  switch (method) {
    case 'hsl':
      return inRangeHsl(pixel, target, tolerance);
    case 'lab':
      return inRangeLab(pixel, target, tolerance);
    default:
      return inRangeSimple(pixel, target, tolerance);
  }
}

/** Parse `#rgb` / `#rrggbb` into channels. Falls back to red, upstream's default paint colour. */
export function hexToRgb(hex: string): Rgb {
  const normalized = hex.trim().replace(/^#/, '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((c) => c + c).join('')
    : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return { r: 255, g: 0, b: 0 };
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

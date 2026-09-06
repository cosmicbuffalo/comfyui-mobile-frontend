import { describe, expect, it } from 'vitest';
import { colorSelectFill, invertMask, paintBucketFill } from '../fill';
import { isPixelInRange, rgbToHsl, rgbToLab } from '../color';

const BLACK = { r: 0, g: 0, b: 0 };

/**
 * The fill functions only ever read `data`, `width` and `height`, so a plain
 * object stands in for ImageData -- the test environment has no canvas and
 * therefore no ImageData constructor.
 */
function makeImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

/** A blank W x H mask: transparent everywhere. */
function blankMask(width: number, height: number): ImageData {
  return makeImageData(new Uint8ClampedArray(width * height * 4), width, height);
}

/** Build an image from a per-pixel colour function. */
function image(width: number, height: number, at: (x: number, y: number) => [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = at(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return makeImageData(data, width, height);
}

function alphaAt(data: ImageData, x: number, y: number): number {
  return data.data[(y * data.width + x) * 4 + 3];
}

function setAlpha(data: ImageData, x: number, y: number, alpha: number): void {
  data.data[(y * data.width + x) * 4 + 3] = alpha;
}

describe('paintBucketFill', () => {
  it('fills the whole canvas from an empty mask', () => {
    const mask = blankMask(4, 4);
    const changed = paintBucketFill(mask, { x: 0, y: 0 }, {
      tolerance: 0, fillOpacity: 100, maskColor: BLACK,
    });
    expect(changed).toBe(true);
    expect(alphaAt(mask, 3, 3)).toBe(255);
  });

  it('respects fill opacity', () => {
    const mask = blankMask(2, 2);
    paintBucketFill(mask, { x: 0, y: 0 }, { tolerance: 0, fillOpacity: 50, maskColor: BLACK });
    expect(alphaAt(mask, 1, 1)).toBe(127);
  });

  it('erases the contiguous masked blob when the tapped pixel is masked', () => {
    // Upstream's isFillMode: tapping a fully masked pixel clears rather than
    // fills. Without it the bucket could only ever add.
    const mask = blankMask(3, 1);
    setAlpha(mask, 0, 0, 255);
    setAlpha(mask, 1, 0, 255);
    paintBucketFill(mask, { x: 0, y: 0 }, { tolerance: 0, fillOpacity: 100, maskColor: BLACK });
    expect(alphaAt(mask, 0, 0)).toBe(0);
    expect(alphaAt(mask, 1, 0)).toBe(0);
  });

  it('does not cross a fully masked wall', () => {
    const mask = blankMask(3, 1);
    setAlpha(mask, 1, 0, 255);
    paintBucketFill(mask, { x: 0, y: 0 }, { tolerance: 0, fillOpacity: 100, maskColor: BLACK });
    expect(alphaAt(mask, 0, 0)).toBe(255);
    expect(alphaAt(mask, 2, 0)).toBe(0);
  });

  it('ignores a tap outside the canvas', () => {
    const mask = blankMask(2, 2);
    expect(paintBucketFill(mask, { x: -1, y: 0 }, {
      tolerance: 0, fillOpacity: 100, maskColor: BLACK,
    })).toBe(false);
  });
});

describe('colorSelectFill', () => {
  const baseOptions = {
    tolerance: 10,
    method: 'simple' as const,
    selectionOpacity: 100,
    maskColor: BLACK,
    applyWholeImage: false,
    maskBoundary: false,
    maskTolerance: 0,
  };

  it('selects the contiguous region matching the tapped colour', () => {
    // Left half red, right half blue.
    const img = image(4, 1, (x) => (x < 2 ? [255, 0, 0] : [0, 0, 255]));
    const mask = blankMask(4, 1);
    colorSelectFill(mask, img, { x: 0, y: 0 }, baseOptions);
    expect(alphaAt(mask, 0, 0)).toBe(255);
    expect(alphaAt(mask, 1, 0)).toBe(255);
    expect(alphaAt(mask, 2, 0)).toBe(0);
  });

  it('does not jump a gap unless applyWholeImage is set', () => {
    // Red, blue, red — the far red is the same colour but not connected.
    const img = image(3, 1, (x) => (x === 1 ? [0, 0, 255] : [255, 0, 0]));

    const contiguous = blankMask(3, 1);
    colorSelectFill(contiguous, img, { x: 0, y: 0 }, baseOptions);
    expect(alphaAt(contiguous, 2, 0)).toBe(0);

    const global = blankMask(3, 1);
    colorSelectFill(global, img, { x: 0, y: 0 }, { ...baseOptions, applyWholeImage: true });
    expect(alphaAt(global, 2, 0)).toBe(255);
  });

  it('widens the selection as tolerance rises', () => {
    const img = image(2, 1, (x) => (x === 0 ? [100, 100, 100] : [120, 100, 100]));

    const tight = blankMask(2, 1);
    colorSelectFill(tight, img, { x: 0, y: 0 }, { ...baseOptions, tolerance: 5 });
    expect(alphaAt(tight, 1, 0)).toBe(0);

    const loose = blankMask(2, 1);
    colorSelectFill(loose, img, { x: 0, y: 0 }, { ...baseOptions, tolerance: 40 });
    expect(alphaAt(loose, 1, 0)).toBe(255);
  });

  it('stops at an existing mask edge when asked', () => {
    const img = image(3, 1, () => [255, 0, 0]);
    const mask = blankMask(3, 1);
    setAlpha(mask, 1, 0, 255);
    colorSelectFill(mask, img, { x: 0, y: 0 }, { ...baseOptions, maskBoundary: true });
    expect(alphaAt(mask, 0, 0)).toBe(255);
    // Blocked by the pre-existing mask at x=1, so x=2 is never reached.
    expect(alphaAt(mask, 2, 0)).toBe(0);
  });

  it('spreads past that edge when the boundary option is off', () => {
    const img = image(3, 1, () => [255, 0, 0]);
    const mask = blankMask(3, 1);
    setAlpha(mask, 1, 0, 255);
    colorSelectFill(mask, img, { x: 0, y: 0 }, baseOptions);
    expect(alphaAt(mask, 2, 0)).toBe(255);
  });
});

describe('invertMask', () => {
  it('swaps masked and unmasked', () => {
    const mask = blankMask(2, 1);
    setAlpha(mask, 0, 0, 255);
    invertMask(mask, BLACK);
    expect(alphaAt(mask, 0, 0)).toBe(0);
    expect(alphaAt(mask, 1, 0)).toBe(255);
  });

  it('gives newly-revealed pixels a real colour', () => {
    // A transparent pixel's RGB is undefined; leaving it at zero would paint an
    // opaque black rectangle when the overlay colour is white.
    const mask = blankMask(2, 1);
    invertMask(mask, { r: 255, g: 255, b: 255 });
    expect([mask.data[0], mask.data[1], mask.data[2]]).toEqual([255, 255, 255]);
  });

  it('reuses the existing overlay colour when the mask has one', () => {
    const mask = blankMask(2, 1);
    mask.data[4] = 12; mask.data[5] = 34; mask.data[6] = 56; mask.data[7] = 255;
    invertMask(mask, BLACK);
    expect([mask.data[0], mask.data[1], mask.data[2]]).toEqual([12, 34, 56]);
  });
});

describe('colour comparison methods', () => {
  it('agrees that identical colours match under every method', () => {
    for (const method of ['simple', 'hsl', 'lab'] as const) {
      expect(isPixelInRange({ r: 10, g: 20, b: 30 }, { r: 10, g: 20, b: 30 }, 0, method)).toBe(true);
    }
  });

  it('normalizes every method onto the same 0-255 tolerance scale', () => {
    // The point of upstream's rescaling: one slider has to mean roughly the
    // same thing for all three, or switching method silently changes the
    // selection out from under the user.
    const a = { r: 0, g: 0, b: 0 };
    const b = { r: 255, g: 255, b: 255 };
    for (const method of ['simple', 'hsl', 'lab'] as const) {
      expect(isPixelInRange(a, b, 0, method)).toBe(false);
      expect(isPixelInRange(a, b, 500, method)).toBe(true);
    }
  });

  it('converts known colours correctly', () => {
    expect(rgbToHsl(255, 0, 0)).toEqual({ h: 0, s: 100, l: 50 });
    const white = rgbToLab({ r: 255, g: 255, b: 255 });
    expect(white.l).toBeCloseTo(100, 1);
    expect(white.a).toBeCloseTo(0, 1);
    expect(white.b).toBeCloseTo(0, 1);
  });

  it('separates hue-only differences under HSL but not lightness-only ones', () => {
    const red = { r: 200, g: 0, b: 0 };
    const green = { r: 0, g: 200, b: 0 };
    expect(isPixelInRange(red, green, 60, 'hsl')).toBe(false);
    expect(isPixelInRange(red, green, 200, 'hsl')).toBe(true);
  });
});

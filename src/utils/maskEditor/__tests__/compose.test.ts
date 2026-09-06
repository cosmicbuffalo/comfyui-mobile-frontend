import { describe, expect, it } from 'vitest';
import { applyMaskAlphaInPlace, readMaskAlphaInPlace } from '../compose';

function makeImageData(pixels: Array<[number, number, number, number]>): ImageData {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  });
  return { data, width: pixels.length, height: 1, colorSpace: 'srgb' } as ImageData;
}

function alphas(data: ImageData): number[] {
  return [...data.data].filter((_, i) => i % 4 === 3);
}

/**
 * ComfyUI's mask convention, which is the single easiest thing in this feature
 * to get backwards: the editor paints opaque where the user wants the mask, and
 * `LoadImage` reads a masked region as transparent. Inverting either direction
 * makes every inpaint run on the complement of what was selected — and it would
 * still *look* plausible on screen, which is why it is pinned here.
 */
describe('applyMaskAlphaInPlace', () => {
  it('makes painted (opaque) mask pixels transparent in the output', () => {
    const image = makeImageData([[10, 20, 30, 255], [10, 20, 30, 255]]);
    const mask = makeImageData([[0, 0, 0, 255], [0, 0, 0, 0]]);

    applyMaskAlphaInPlace(image, mask);

    expect(alphas(image)).toEqual([0, 255]);
  });

  it('leaves the colour channels alone', () => {
    const image = makeImageData([[10, 20, 30, 255]]);
    applyMaskAlphaInPlace(image, makeImageData([[0, 0, 0, 255]]));
    expect([image.data[0], image.data[1], image.data[2]]).toEqual([10, 20, 30]);
  });

  it('carries partial mask opacity through as partial transparency', () => {
    const image = makeImageData([[0, 0, 0, 255]]);
    applyMaskAlphaInPlace(image, makeImageData([[0, 0, 0, 100]]));
    expect(image.data[3]).toBe(155);
  });
});

/**
 * Build what `/view?channel=a` actually returns for a given alpha channel.
 *
 * NOT a greyscale picture. ComfyUI's view_image does:
 *
 *     alpha_img = Image.new('RGBA', img.size)   # transparent black
 *     alpha_img.putalpha(a)
 *
 * so every pixel is R=G=B=0 and only the alpha channel carries the value.
 * Reading red instead would give 0 everywhere -- and `255 - 0` is a fully
 * masked canvas, for every image ever opened.
 */
function viewChannelARender(alphaValues: number[]): ImageData {
  return makeImageData(alphaValues.map((a) => [0, 0, 0, a] as [number, number, number, number]));
}

describe('readMaskAlphaInPlace', () => {
  it('is the exact inverse of applyMaskAlphaInPlace', () => {
    // Round-tripping is what makes re-opening a saved edit show the same mask
    // the user drew, rather than its complement.
    const original = makeImageData([[0, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 100]]);
    const image = makeImageData([[9, 9, 9, 255], [9, 9, 9, 255], [9, 9, 9, 255]]);
    applyMaskAlphaInPlace(image, original);

    const restored = makeImageData([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
    readMaskAlphaInPlace(restored, viewChannelARender(alphas(image)), { r: 0, g: 0, b: 0 });

    expect(alphas(restored)).toEqual(alphas(original));
  });

  it('reads the alpha channel, not the colour channels', () => {
    // The regression that made every image open fully masked: RGB is all zeros
    // in what the server sends, so sampling red inverted to 255 everywhere.
    const target = makeImageData([[0, 0, 0, 0], [0, 0, 0, 0]]);
    readMaskAlphaInPlace(target, viewChannelARender([255, 0]), { r: 0, g: 0, b: 0 });
    expect(alphas(target)).toEqual([0, 255]);
  });

  it('writes the display colour into the mask channels', () => {
    const target = makeImageData([[0, 0, 0, 0]]);
    readMaskAlphaInPlace(target, viewChannelARender([255]), { r: 255, g: 255, b: 255 });
    expect([target.data[0], target.data[1], target.data[2]]).toEqual([255, 255, 255]);
  });

  it('reads a fully opaque source image as an EMPTY mask', () => {
    // A plain photo has no alpha, so ComfyUI synthesises a=255 everywhere.
    // Opening one must not start the user off with the whole canvas masked.
    const target = makeImageData([[0, 0, 0, 0], [0, 0, 0, 0]]);
    readMaskAlphaInPlace(target, viewChannelARender([255, 255]), { r: 0, g: 0, b: 0 });
    expect(alphas(target)).toEqual([0, 0]);
  });
});

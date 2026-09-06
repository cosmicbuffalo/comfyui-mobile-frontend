import { isPixelInRange } from './color';
import type { ColorComparisonMethod, Point, Rgb } from './types';

/**
 * The two flood-fill tools, ported from ComfyUI's `useCanvasTools.ts`.
 *
 * Both operate on raw `ImageData` rather than on canvases so they can be tested
 * without a DOM and so the caller controls when the result is committed to the
 * canvas (and to the undo history).
 */

function getAlpha(data: Uint8ClampedArray, x: number, y: number, width: number): number {
  return data[(y * width + x) * 4 + 3];
}

function getColor(data: Uint8ClampedArray, x: number, y: number, width: number): Rgb {
  const index = (y * width + x) * 4;
  return { r: data[index], g: data[index + 1], b: data[index + 2] };
}

function setPixel(
  data: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  alpha: number,
  color: Rgb,
): void {
  const index = (y * width + x) * 4;
  data[index] = color.r;
  data[index + 1] = color.g;
  data[index + 2] = color.b;
  data[index + 3] = alpha;
}

export interface PaintBucketOptions {
  tolerance: number;
  /** 0-100; the alpha written into filled pixels. */
  fillOpacity: number;
  maskColor: Rgb;
}

/**
 * Flood fill on the mask's own alpha channel.
 *
 * Note what this is NOT: it does not look at the image at all. It fills a
 * contiguous run of pixels that share a *mask* state. Tapping unmasked pixels
 * fills them; tapping masked pixels erases the contiguous masked blob. That is
 * upstream's `isFillMode` flag, derived from whether the tapped pixel is
 * already fully masked.
 *
 * Mutates `maskData` in place and returns whether anything changed.
 */
export function paintBucketFill(
  maskData: ImageData,
  point: Point,
  options: PaintBucketOptions,
): boolean {
  const { width, height, data } = maskData;
  const startX = Math.floor(point.x);
  const startY = Math.floor(point.y);
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return false;

  const targetAlpha = getAlpha(data, startX, startY, width);
  const isFillMode = targetAlpha !== 255;
  const tolerance = options.tolerance;
  const fillAlpha = Math.floor((options.fillOpacity / 100) * 255);

  const shouldProcess = (alpha: number): boolean =>
    isFillMode
      ? alpha !== 255 && Math.abs(alpha - targetAlpha) <= tolerance
      : alpha === 255 || Math.abs(alpha - targetAlpha) <= tolerance;

  if (!shouldProcess(targetAlpha)) return false;

  const visited = new Uint8Array(width * height);
  const stack: Array<[number, number]> = [[startX, startY]];
  let changed = false;

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const visitedIndex = y * width + x;
    if (visited[visitedIndex]) continue;
    if (!shouldProcess(getAlpha(data, x, y, width))) continue;

    visited[visitedIndex] = 1;
    setPixel(data, x, y, width, isFillMode ? fillAlpha : 0, options.maskColor);
    changed = true;

    const push = (nx: number, ny: number) => {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
      if (visited[ny * width + nx]) return;
      if (!shouldProcess(getAlpha(data, nx, ny, width))) return;
      stack.push([nx, ny]);
    };

    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }

  return changed;
}

export interface ColorSelectOptions {
  tolerance: number;
  method: ColorComparisonMethod;
  /** 0-100; the alpha written into selected pixels. */
  selectionOpacity: number;
  maskColor: Rgb;
  /**
   * When true, every pixel in the image within tolerance is selected, not just
   * the contiguous region. Upstream calls this "apply to whole image"; it turns
   * the magic wand into a global colour selection.
   */
  applyWholeImage: boolean;
  /** Stop the flood at pixels that are already masked. */
  maskBoundary: boolean;
  /** How close to fully masked a pixel must be to count as a boundary. */
  maskTolerance: number;
}

/**
 * The magic wand: select by the colour of the *underlying image*, and write the
 * result into the mask.
 *
 * Mutates `maskData` in place; `imageData` is read only. Both must share
 * dimensions — they are the two layers of the same editor canvas.
 */
export function colorSelectFill(
  maskData: ImageData,
  imageData: ImageData,
  point: Point,
  options: ColorSelectOptions,
): boolean {
  const { width, height } = maskData;
  const maskArray = maskData.data;
  const imageArray = imageData.data;

  const startX = Math.floor(point.x);
  const startY = Math.floor(point.y);
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) return false;

  const target = getColor(imageArray, startX, startY, width);
  const selectionAlpha = Math.floor((options.selectionOpacity / 100) * 255);
  const matches = (x: number, y: number) =>
    isPixelInRange(getColor(imageArray, x, y, width), target, options.tolerance, options.method);

  if (options.applyWholeImage) {
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (matches(x, y)) {
          setPixel(maskArray, x, y, width, selectionAlpha, options.maskColor);
          changed = true;
        }
      }
    }
    return changed;
  }

  const visited = new Uint8Array(width * height);
  const stack: Array<[number, number]> = [[startX, startY]];
  let changed = false;

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    const visitedIndex = y * width + x;
    if (visited[visitedIndex] || !matches(x, y)) continue;

    visited[visitedIndex] = 1;
    setPixel(maskArray, x, y, width, selectionAlpha, options.maskColor);
    changed = true;

    const push = (nx: number, ny: number) => {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
      if (visited[ny * width + nx]) return;
      if (!matches(nx, ny)) return;
      // An existing mask edge stops the spread, so you can wand a region that
      // is already bounded by hand-painted mask without leaking past it.
      if (
        options.maskBoundary &&
        255 - getAlpha(maskArray, nx, ny, width) <= options.maskTolerance
      ) {
        return;
      }
      stack.push([nx, ny]);
    };

    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }

  return changed;
}

/**
 * Invert the mask in place.
 *
 * The RGB channels of a fully transparent pixel are undefined, so upstream
 * seeds them from the first painted pixel it finds; otherwise inverting an
 * all-transparent mask would produce an opaque black rectangle instead of the
 * current overlay colour.
 */
export function invertMask(maskData: ImageData, fallbackColor: Rgb): void {
  const data = maskData.data;

  let color = fallbackColor;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) {
      color = { r: data[i], g: data[i + 1], b: data[i + 2] };
      break;
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    data[i + 3] = 255 - alpha;
    if (alpha === 0) {
      data[i] = color.r;
      data[i + 1] = color.g;
      data[i + 2] = color.b;
    }
  }
}

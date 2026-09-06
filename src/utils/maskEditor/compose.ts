/**
 * Composition of the four layers a save writes, ported from ComfyUI's
 * `useMaskEditorSaver.ts`.
 *
 * The editor holds three live canvases — the base image, the RGB paint layer,
 * and the mask — and flattens them into four uploads:
 *
 *   maskedImage        base            + mask as alpha
 *   paint              paint strokes alone (kept so a later edit can restore them)
 *   paintedImage       base + paint    , fully opaque
 *   paintedMaskedImage base + paint    + mask as alpha   <- what the node points at
 *
 * The paint layer is uploaded on its own purely so re-opening the image can put
 * the strokes back on their own canvas; nothing executes against it.
 */

/**
 * Write a mask into an image's alpha channel, in place.
 *
 * The inversion is the crux of ComfyUI's mask convention and the single
 * easiest thing to get backwards: the editor paints *opaque* pixels where the
 * user wants the mask, but `LoadImage` reads a masked region as *transparent*.
 * So the output alpha is `255 - maskAlpha`. Invert this and every inpaint runs
 * on the complement of what the user selected.
 *
 * Pure and separated from the canvas plumbing so the convention itself stays
 * under test -- see `compose.test.ts`.
 */
export function applyMaskAlphaInPlace(imageData: ImageData, maskData: ImageData): void {
  for (let i = 3; i < imageData.data.length; i += 4) {
    imageData.data[i] = 255 - maskData.data[i];
  }
}

/**
 * The inverse: turn a `/view?channel=a` render back into mask pixels.
 *
 * Read the ALPHA channel, not RGB. ComfyUI does not return the alpha as a
 * greyscale picture; `view_image` builds `Image.new('RGBA', size)` and calls
 * `putalpha(a)`, so what comes back is transparent BLACK carrying the original
 * alpha -- R=G=B=0 for every pixel. Sampling red here would read 0 everywhere
 * and hand back `255 - 0`, i.e. a fully-masked canvas for every image opened.
 *
 * The inversion on top of that is the editor's own convention: the file's alpha
 * is 255 where the image is opaque, i.e. NOT masked.
 *
 * `maskColor` fills the RGB channels, which are display-only.
 */
export function readMaskAlphaInPlace(
  target: ImageData,
  alphaRender: ImageData,
  maskColor: { r: number; g: number; b: number },
): void {
  for (let i = 0; i < alphaRender.data.length; i += 4) {
    target.data[i] = maskColor.r;
    target.data[i + 1] = maskColor.g;
    target.data[i + 2] = maskColor.b;
    target.data[i + 3] = 255 - alphaRender.data[i + 3];
  }
}

function applyMaskAsAlpha(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  maskCanvas: HTMLCanvasElement,
): void {
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return;

  const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  const imageData = ctx.getImageData(0, 0, width, height);
  applyMaskAlphaInPlace(imageData, maskData);
  ctx.putImageData(imageData, 0, 0);
}

function createCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D context for the mask editor output canvas');
  return { canvas, ctx };
}

export interface ComposedLayers {
  maskedImage: HTMLCanvasElement;
  paint: HTMLCanvasElement;
  paintedImage: HTMLCanvasElement;
  paintedMaskedImage: HTMLCanvasElement;
}

export function composeOutputLayers(
  imgCanvas: HTMLCanvasElement,
  paintCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
): ComposedLayers {
  const { width, height } = imgCanvas;

  const masked = createCanvas(width, height);
  masked.ctx.drawImage(imgCanvas, 0, 0);
  applyMaskAsAlpha(masked.ctx, width, height, maskCanvas);

  const paint = createCanvas(width, height);
  paint.ctx.drawImage(paintCanvas, 0, 0);

  const painted = createCanvas(width, height);
  painted.ctx.drawImage(imgCanvas, 0, 0);
  painted.ctx.drawImage(paintCanvas, 0, 0);

  const paintedMasked = createCanvas(width, height);
  paintedMasked.ctx.drawImage(imgCanvas, 0, 0);
  paintedMasked.ctx.drawImage(paintCanvas, 0, 0);
  applyMaskAsAlpha(paintedMasked.ctx, width, height, maskCanvas);

  return {
    maskedImage: masked.canvas,
    paint: paint.canvas,
    paintedImage: painted.canvas,
    paintedMaskedImage: paintedMasked.canvas,
  };
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the canvas as a PNG'))),
      'image/png',
    );
  });
}

/** Draw a loaded alpha-channel render into a mask canvas at the editor's resolution. */
export function readMaskFromAlphaImage(
  maskCtx: CanvasRenderingContext2D,
  alphaImage: CanvasImageSource,
  width: number,
  height: number,
  maskColor: { r: number; g: number; b: number },
): void {
  const scratch = createCanvas(width, height);
  scratch.ctx.drawImage(alphaImage, 0, 0, width, height);
  const source = scratch.ctx.getImageData(0, 0, width, height);

  const target = maskCtx.createImageData(width, height);
  readMaskAlphaInPlace(target, source, maskColor);
  maskCtx.putImageData(target, 0, 0);
}

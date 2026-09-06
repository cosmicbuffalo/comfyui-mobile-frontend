import {
  buildBrushStamp,
  getEffectiveBrushSize,
  getEffectiveHardness,
  resampleSegment,
  smoothPath,
  stampSpacing,
} from '@/utils/maskEditor/brush';
import { hexToRgb } from '@/utils/maskEditor/color';
import { composeOutputLayers, readMaskFromAlphaImage } from '@/utils/maskEditor/compose';
import { colorSelectFill, invertMask, paintBucketFill } from '@/utils/maskEditor/fill';
import { maskHistoryLimitForDimensions } from '@/utils/maskEditor/historyLimit';
import {
  layerForTool,
  maskColorForBlendMode,
  type Brush,
  type ColorComparisonMethod,
  type EditorLayer,
  type MaskBlendMode,
  type Point,
  type Tool,
} from '@/utils/maskEditor/types';

/**
 * The mask editor's canvas engine.
 *
 * Three layers are held at full image resolution and never scaled: the base
 * image, the RGB paint layer, and the mask. Everything the user does writes to
 * one of those, and a separate display canvas is redrawn from them through a
 * pan/zoom transform. Keeping the edit buffers at native resolution is what
 * makes the saved mask pixel-exact regardless of how far the user was zoomed
 * out when they painted it.
 *
 * Deliberately framework-free — React only owns the settings and the lifecycle.
 */

export interface EngineSettings {
  tool: Tool;
  brush: Brush;
  maskBlendMode: MaskBlendMode;
  maskOpacity: number;
  rgbColor: string;
  paintBucketTolerance: number;
  fillOpacity: number;
  colorSelectTolerance: number;
  colorComparisonMethod: ColorComparisonMethod;
  selectionOpacity: number;
  applyWholeImage: boolean;
  maskBoundary: boolean;
  maskTolerance: number;
}

export interface HistoryEntry {
  mask: ImageData;
  paint: ImageData;
}

function createLayer(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get a 2D context for a mask editor layer');
  return { canvas, ctx };
}

export class MaskCanvasEngine {
  readonly width: number;
  readonly height: number;

  private readonly img: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
  private readonly paint: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
  private readonly mask: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

  private display: HTMLCanvasElement | null = null;
  private settings: EngineSettings;

  /** Image pixels per display pixel. */
  private scale = 1;
  private offset: Point = { x: 0, y: 0 };

  private history: HistoryEntry[] = [];
  private historyIndex = -1;
  /** Large images keep fewer full-resolution snapshots to stay within a pixel budget. */
  private readonly historyLimit: number;

  private strokePoints: Point[] = [];
  private strokeRemainder = 0;
  private strokeActive = false;
  /** Index of the last stroke point the stamping has painted through. */
  private strokeStampedIndex = 0;

  private stampCache = new Map<string, HTMLCanvasElement>();

  /**
   * The layer the eraser works on.
   *
   * Upstream has no dedicated erase-both mode: `drawShape` erases whichever
   * layer is active, and the active layer follows the last tool that set one
   * (`newActiveLayerOnSet` -- the paint pen selects rgb, every mask tool
   * selects mask). So picking the eraser right after painting rubs out paint,
   * and right after masking rubs out mask.
   */
  private eraseLayer: EditorLayer = 'mask';

  /** Called whenever undo/redo availability changes, so the UI can re-render. */
  onHistoryChange: (() => void) | null = null;
  /** Called whenever the view transform changes, so the zoom readout can update. */
  onViewChange: (() => void) | null = null;

  constructor(
    baseImage: CanvasImageSource,
    width: number,
    height: number,
    settings: EngineSettings,
  ) {
    this.width = width;
    this.height = height;
    this.historyLimit = maskHistoryLimitForDimensions(width, height);
    this.settings = settings;

    this.img = createLayer(width, height);
    this.paint = createLayer(width, height);
    this.mask = createLayer(width, height);

    this.img.ctx.drawImage(baseImage, 0, 0, width, height);
    // Seed the history here rather than relying on loadExistingLayers being
    // called: without an initial entry the first stroke has nothing to undo
    // back into, and pushHistory would fold the pre-stroke state away.
    this.resetHistory();
  }

  /**
   * Restore a mask from a `/view?channel=a` render of a previous save, and the
   * paint strokes from the sibling paint layer. Both are optional: a first-time
   * edit of an ordinary image has neither.
   */
  loadExistingLayers(alphaImage: CanvasImageSource | null, paintImage: CanvasImageSource | null): void {
    if (alphaImage) {
      readMaskFromAlphaImage(
        this.mask.ctx,
        alphaImage,
        this.width,
        this.height,
        maskColorForBlendMode(this.settings.maskBlendMode),
      );
    }
    if (paintImage) {
      this.paint.ctx.drawImage(paintImage, 0, 0, this.width, this.height);
    }
    this.resetHistory();
  }

  updateSettings(settings: EngineSettings): void {
    const blendChanged = settings.maskBlendMode !== this.settings.maskBlendMode;
    // The eraser itself does not change the active layer, so it keeps erasing
    // whatever the previously selected tool was working on.
    if (settings.tool !== 'eraser') {
      this.eraseLayer = layerForTool(settings.tool);
    }
    this.settings = settings;
    if (blendChanged) {
      // The blend mode changes the mask's RGB channels, which are display-only.
      // Recolouring in place keeps the alpha (the part that is actually saved)
      // untouched, and deliberately does NOT create a history entry.
      this.recolorMask();
    }
    this.render();
  }

  private recolorMask(): void {
    const color = maskColorForBlendMode(this.settings.maskBlendMode);
    const data = this.mask.ctx.getImageData(0, 0, this.width, this.height);
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = color.r;
      data.data[i + 1] = color.g;
      data.data[i + 2] = color.b;
    }
    this.mask.ctx.putImageData(data, 0, 0);
  }

  // ---------------------------------------------------------------- display

  attachDisplay(canvas: HTMLCanvasElement): void {
    this.display = canvas;
    this.render();
  }

  /** Size the backing store to the element's box at device resolution. */
  resizeDisplay(cssWidth: number, cssHeight: number): void {
    if (!this.display) return;
    const dpr = window.devicePixelRatio || 1;
    this.display.width = Math.max(1, Math.round(cssWidth * dpr));
    this.display.height = Math.max(1, Math.round(cssHeight * dpr));
    this.render();
  }

  /** Fit the whole image in view and centre it. */
  fitToView(): void {
    if (!this.display) return;
    const dpr = window.devicePixelRatio || 1;
    const viewW = this.display.width / dpr;
    const viewH = this.display.height / dpr;
    if (viewW <= 0 || viewH <= 0) return;

    this.scale = Math.min(viewW / this.width, viewH / this.height);
    this.offset = {
      x: (viewW - this.width * this.scale) / 2,
      y: (viewH - this.height * this.scale) / 2,
    };
    this.onViewChange?.();
    this.render();
  }

  getScale(): number {
    return this.scale;
  }

  /** Pan by a delta in CSS pixels. */
  panBy(dx: number, dy: number): void {
    this.offset = { x: this.offset.x + dx, y: this.offset.y + dy };
    this.onViewChange?.();
    this.render();
  }

  /**
   * Zoom about a fixed point in CSS pixels, so a pinch keeps the pixel under
   * the fingers stationary.
   */
  zoomAt(anchor: Point, factor: number): void {
    const next = Math.min(40, Math.max(0.02, this.scale * factor));
    const applied = next / this.scale;
    this.offset = {
      x: anchor.x - (anchor.x - this.offset.x) * applied,
      y: anchor.y - (anchor.y - this.offset.y) * applied,
    };
    this.scale = next;
    this.onViewChange?.();
    this.render();
  }

  /** Map a point in CSS pixels of the display element into image space. */
  toImageSpace(point: Point): Point {
    return {
      x: (point.x - this.offset.x) / this.scale,
      y: (point.y - this.offset.y) / this.scale,
    };
  }

  /** True when a point in image space falls outside the image itself. */
  isOutsideImage(imagePoint: Point): boolean {
    return imagePoint.x < 0 || imagePoint.y < 0
      || imagePoint.x >= this.width || imagePoint.y >= this.height;
  }

  render(): void {
    const display = this.display;
    if (!display) return;
    const ctx = display.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, display.width / dpr, display.height / dpr);

    ctx.save();
    ctx.translate(this.offset.x, this.offset.y);
    ctx.scale(this.scale, this.scale);

    // Nearest-neighbour when magnified past 1:1, so individual mask pixels stay
    // legible while working on a fine edge.
    ctx.imageSmoothingEnabled = this.scale < 1;

    // The mask's meaning depends on what is behind it, so the backdrop matches
    // the blend mode exactly as upstream sets `canvasBackground`.
    ctx.fillStyle = this.settings.maskBlendMode === 'black' ? '#000000' : '#ffffff';
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.drawImage(this.img.canvas, 0, 0);
    ctx.drawImage(this.paint.canvas, 0, 0);

    if (this.settings.maskBlendMode === 'negative') {
      // Upstream uses CSS `mix-blend-mode: difference` at full opacity; the
      // canvas composite operation of the same name is the direct equivalent.
      ctx.globalCompositeOperation = 'difference';
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = this.settings.maskOpacity;
    }
    ctx.drawImage(this.mask.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  // ------------------------------------------------------------------ tools

  private activeLayerCtx(): CanvasRenderingContext2D {
    return layerForTool(this.settings.tool) === 'rgb' ? this.paint.ctx : this.mask.ctx;
  }

  private stampFor(erasing: boolean): { stamp: HTMLCanvasElement; radius: number } {
    const { brush, tool, maskBlendMode, rgbColor } = this.settings;
    const radius = getEffectiveBrushSize(brush.size, brush.hardness);
    const hardness = getEffectiveHardness(brush.size, brush.hardness, radius);
    const color = tool === 'rgbPaint' ? hexToRgb(rgbColor) : maskColorForBlendMode(maskBlendMode);

    // The eraser punches alpha out via destination-out, where only the stamp's
    // alpha matters — but the colour still goes in the cache key so switching
    // tools can never hand back a stamp built for the other one.
    const key = [
      radius.toFixed(2), hardness.toFixed(3), brush.opacity.toFixed(3),
      brush.type, color.r, color.g, color.b, erasing ? 'e' : 'd',
    ].join('|');

    let stamp = this.stampCache.get(key);
    if (!stamp) {
      stamp = buildBrushStamp(radius, hardness, color, brush.opacity, brush.type);
      // Bounded so a user dragging the size slider cannot grow this without end.
      if (this.stampCache.size > 24) this.stampCache.clear();
      this.stampCache.set(key, stamp);
    }
    return { stamp, radius };
  }

  beginStroke(imagePoint: Point): void {
    const { tool } = this.settings;

    if (tool === 'paintBucket') {
      this.applyPaintBucket(imagePoint);
      return;
    }
    if (tool === 'colorSelect') {
      this.applyColorSelect(imagePoint);
      return;
    }

    this.strokeActive = true;
    this.strokePoints = [imagePoint];
    this.strokeStampedIndex = 0;
    // Stamp immediately so a tap marks a dot rather than nothing. The dot IS
    // the sample at distance zero, so start the resampling phase one spacing
    // in — otherwise the first segment stamps the same spot again.
    this.strokeRemainder = 0;
    this.stampAt([imagePoint]);
    const { radius } = this.stampFor(this.settings.tool === 'eraser');
    this.strokeRemainder = stampSpacing(radius, this.settings.brush.stepSize);
    this.render();
  }

  extendStroke(imagePoint: Point): void {
    if (!this.strokeActive) return;
    this.strokePoints.push(imagePoint);
    const points = this.strokePoints;
    const count = points.length;

    // Each segment is stamped exactly once: re-stamping a trailing window on
    // every move compounds alpha wherever opacity or hardness is below 1, so
    // a slow stroke came out darker and harder than the same stroke drawn
    // fast. Smoothing needs a point on each side of a segment, so the stamp
    // trails the finger by one point and endStroke flushes the tail.
    if (count === 2) {
      // p0→p1 has no earlier neighbour to smooth against; paint it raw.
      this.stampAt([points[0], points[1]]);
      this.strokeStampedIndex = 1;
    } else if (count >= 4) {
      // The window (p_{n-3}, p_{n-2}, p_{n-1}, p_n) defines the smoothed
      // segment p_{n-2}→p_{n-1}; smoothPath brackets its spline samples with
      // the raw window endpoints, so trim those and lead with the segment's
      // own start.
      const window = points.slice(-4);
      this.stampAt([window[1], ...smoothPath(window).slice(1, -1)]);
      this.strokeStampedIndex = count - 2;
    }
    // count === 3 stamps nothing: p1→p2 becomes smoothable on the next point
    // (or is flushed raw by endStroke).
    this.render();
  }

  endStroke(): void {
    if (!this.strokeActive) return;
    // Flush the un-stamped tail the smoothing lag left behind.
    if (this.strokeStampedIndex < this.strokePoints.length - 1) {
      this.stampAt(this.strokePoints.slice(this.strokeStampedIndex));
      this.render();
    }
    this.strokeActive = false;
    this.strokePoints = [];
    this.strokeRemainder = 0;
    this.strokeStampedIndex = 0;
    this.pushHistory();
  }

  private stampAt(path: Point[]): void {
    if (path.length === 0) return;

    const erasing = this.settings.tool === 'eraser';
    const { stamp, radius } = this.stampFor(erasing);
    const spacing = stampSpacing(radius, this.settings.brush.stepSize);

    let points: Point[];
    if (path.length === 1) {
      points = path;
    } else {
      const resampled = resampleSegment(path, spacing, this.strokeRemainder);
      this.strokeRemainder = resampled.remainder;
      points = resampled.points;
    }
    if (points.length === 0) return;

    const eraseCtx = this.eraseLayer === 'rgb' ? this.paint.ctx : this.mask.ctx;
    const targets = [erasing ? eraseCtx : this.activeLayerCtx()];

    for (const ctx of targets) {
      ctx.save();
      ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
      for (const point of points) {
        ctx.drawImage(stamp, point.x - radius, point.y - radius, radius * 2, radius * 2);
      }
      ctx.restore();
    }
  }

  private applyPaintBucket(point: Point): void {
    const maskData = this.mask.ctx.getImageData(0, 0, this.width, this.height);
    const changed = paintBucketFill(maskData, point, {
      tolerance: this.settings.paintBucketTolerance,
      fillOpacity: this.settings.fillOpacity,
      maskColor: maskColorForBlendMode(this.settings.maskBlendMode),
    });
    if (!changed) return;
    this.mask.ctx.putImageData(maskData, 0, 0);
    this.pushHistory();
    this.render();
  }

  private applyColorSelect(point: Point): void {
    const maskData = this.mask.ctx.getImageData(0, 0, this.width, this.height);
    const imageData = this.img.ctx.getImageData(0, 0, this.width, this.height);
    const changed = colorSelectFill(maskData, imageData, point, {
      tolerance: this.settings.colorSelectTolerance,
      method: this.settings.colorComparisonMethod,
      selectionOpacity: this.settings.selectionOpacity,
      maskColor: maskColorForBlendMode(this.settings.maskBlendMode),
      applyWholeImage: this.settings.applyWholeImage,
      maskBoundary: this.settings.maskBoundary,
      maskTolerance: this.settings.maskTolerance,
    });
    if (!changed) return;
    this.mask.ctx.putImageData(maskData, 0, 0);
    this.pushHistory();
    this.render();
  }

  invertMask(): void {
    const data = this.mask.ctx.getImageData(0, 0, this.width, this.height);
    invertMask(data, maskColorForBlendMode(this.settings.maskBlendMode));
    this.mask.ctx.putImageData(data, 0, 0);
    this.pushHistory();
    this.render();
  }

  clearAll(): void {
    this.mask.ctx.clearRect(0, 0, this.width, this.height);
    this.paint.ctx.clearRect(0, 0, this.width, this.height);
    this.pushHistory();
    this.render();
  }

  // ---------------------------------------------------------------- history

  resetHistory(): void {
    this.history = [this.snapshot()];
    this.historyIndex = 0;
    this.onHistoryChange?.();
  }

  private snapshot(): HistoryEntry {
    return {
      mask: this.mask.ctx.getImageData(0, 0, this.width, this.height),
      paint: this.paint.ctx.getImageData(0, 0, this.width, this.height),
    };
  }

  private pushHistory(): void {
    if (this.historyIndex === -1) {
      this.resetHistory();
      return;
    }
    // Anything ahead of the cursor is a redo branch the user has now abandoned.
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(this.snapshot());
    if (this.history.length > this.historyLimit) {
      this.history.shift();
    }
    this.historyIndex = this.history.length - 1;
    this.onHistoryChange?.();
  }

  /** Hand this session's history to the cross-session cache. */
  exportHistory(): { entries: HistoryEntry[]; index: number } {
    return { entries: this.history, index: this.historyIndex };
  }

  /**
   * Continue a history retained from an earlier opening of the same image.
   *
   * The tip is re-pointed at the state actually loaded from disk rather than
   * trusted from the cache: the two should agree (the cache is only written on
   * save, and the load reads that save back), but a PNG round-trip is not
   * guaranteed to be byte-identical, and the canvas must match its own history
   * or the first undo would jump somewhere the user never was.
   */
  adoptHistory(entries: HistoryEntry[], index: number): void {
    if (entries.length === 0 || index < 0 || index >= entries.length) return;
    // Defensive: the engine caps its own history, but if an over-long list ever
    // arrives, dropping from the front shifts the cursor rather than clamping it.
    const dropped = Math.max(0, entries.length - this.historyLimit);
    this.history = entries.slice(dropped);
    this.historyIndex = Math.max(0, index - dropped);
    this.history[this.historyIndex] = this.snapshot();
    this.onHistoryChange?.();
  }

  canUndo(): boolean {
    return this.historyIndex > 0;
  }

  canRedo(): boolean {
    return this.historyIndex >= 0 && this.historyIndex < this.history.length - 1;
  }

  undo(): void {
    if (!this.canUndo()) return;
    this.historyIndex -= 1;
    this.restore(this.history[this.historyIndex]);
  }

  redo(): void {
    if (!this.canRedo()) return;
    this.historyIndex += 1;
    this.restore(this.history[this.historyIndex]);
  }

  private restore(entry: HistoryEntry): void {
    this.mask.ctx.putImageData(entry.mask, 0, 0);
    this.paint.ctx.putImageData(entry.paint, 0, 0);
    this.onHistoryChange?.();
    this.render();
  }

  // ------------------------------------------------------------------- save

  /** True when there is nothing to save — no mask and no paint. */
  isEmpty(): boolean {
    const check = (ctx: CanvasRenderingContext2D) => {
      const { data } = ctx.getImageData(0, 0, this.width, this.height);
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) return false;
      }
      return true;
    };
    return check(this.mask.ctx) && check(this.paint.ctx);
  }

  composeLayers() {
    return composeOutputLayers(this.img.canvas, this.paint.canvas, this.mask.canvas);
  }
}

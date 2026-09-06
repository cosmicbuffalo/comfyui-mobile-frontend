/**
 * Shared vocabulary for the mask editor, kept 1:1 with ComfyUI's desktop
 * frontend (`src/extensions/core/maskeditor/types.ts`) so a workflow masked on
 * a phone and one masked on a desktop are indistinguishable downstream.
 *
 * The string values matter: they are what we persist in this device's editor
 * preferences, and matching upstream keeps the two readable side by side.
 */

export const TOOLS = ['pen', 'rgbPaint', 'eraser', 'paintBucket', 'colorSelect'] as const;
export type Tool = (typeof TOOLS)[number];

export type BrushShape = 'arc' | 'rect';

/**
 * How the mask is *displayed*. Purely cosmetic — the saved mask is always the
 * alpha channel, so switching this never changes what the backend receives.
 */
export type MaskBlendMode = 'black' | 'white' | 'negative';

export type ColorComparisonMethod = 'simple' | 'hsl' | 'lab';

/** The layer a tool writes to. Mask tools write alpha; the paint pen writes RGB. */
export type EditorLayer = 'mask' | 'rgb';

export interface Point {
  x: number;
  y: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Brush {
  type: BrushShape;
  /** Radius in image pixels. */
  size: number;
  /** 0..1 */
  opacity: number;
  /** 0..1; 1 is a hard edge. */
  hardness: number;
  /** Spacing between stamps along a stroke, as a percentage of the radius. */
  stepSize: number;
}

/** Upstream's defaults, so a first-run mobile brush behaves like a first-run desktop one. */
export const DEFAULT_BRUSH: Brush = {
  type: 'arc',
  size: 10,
  opacity: 0.7,
  hardness: 1,
  stepSize: 10,
};

/** Upstream clamps the brush radius to this range (`setBrushSize`). */
export const BRUSH_SIZE_MIN = 1;
export const BRUSH_SIZE_MAX = 250;

export const DEFAULT_PAINT_BUCKET_TOLERANCE = 5;
export const DEFAULT_FILL_OPACITY = 100;
export const DEFAULT_COLOR_SELECT_TOLERANCE = 20;
export const DEFAULT_SELECTION_OPACITY = 100;
export const DEFAULT_MASK_TOLERANCE = 0;
export const DEFAULT_MASK_OPACITY = 0.8;
export const DEFAULT_RGB_COLOR = '#FF0000';

/**
 * Which tool writes to which layer. Upstream models this as
 * `newActiveLayerOnSet` in each tool's internal settings; selecting the paint
 * pen switches the active layer to rgb, and every other tool switches back.
 */
export function layerForTool(tool: Tool): EditorLayer {
  return tool === 'rgbPaint' ? 'rgb' : 'mask';
}

/**
 * The colour written into the mask's RGB channels.
 *
 * Only the alpha channel is ever read back out, so this is purely what the
 * overlay looks like while editing. Upstream's `maskColor` computed: black for
 * the default blend mode, white for the other two.
 */
export function maskColorForBlendMode(mode: MaskBlendMode): Rgb {
  return mode === 'black' ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
}

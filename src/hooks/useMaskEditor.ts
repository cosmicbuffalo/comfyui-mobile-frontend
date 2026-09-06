import { create } from 'zustand';
import type { ImageRef } from '@/utils/maskEditor/clipspace';
import {
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  DEFAULT_BRUSH,
  DEFAULT_COLOR_SELECT_TOLERANCE,
  DEFAULT_FILL_OPACITY,
  DEFAULT_MASK_OPACITY,
  DEFAULT_MASK_TOLERANCE,
  DEFAULT_PAINT_BUCKET_TOLERANCE,
  DEFAULT_RGB_COLOR,
  DEFAULT_SELECTION_OPACITY,
  type Brush,
  type ColorComparisonMethod,
  type MaskBlendMode,
  type Tool,
} from '@/utils/maskEditor/types';

/**
 * What the editor was opened on, and where a successful save writes back.
 *
 * The editor is only ever opened on a LoadImage-style node's input image --
 * the desktop-equivalent flow, where the saved image replaces that node's
 * `image` widget value. A result has no node to write back to, so it is not
 * maskable.
 */
export interface MaskEditorTarget {
  itemKey: string;
  nodeId: number;
  nodeTitle: string;
  ref: ImageRef;
}

const SETTINGS_STORAGE_KEY = 'mobile-mask-editor-settings';

/** Settings that outlive one editing session, mirroring what desktop caches. */
interface PersistedSettings {
  brush: Brush;
  tool: Tool;
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

const DEFAULT_SETTINGS: PersistedSettings = {
  brush: { ...DEFAULT_BRUSH },
  tool: 'pen',
  maskBlendMode: 'black',
  maskOpacity: DEFAULT_MASK_OPACITY,
  rgbColor: DEFAULT_RGB_COLOR,
  paintBucketTolerance: DEFAULT_PAINT_BUCKET_TOLERANCE,
  fillOpacity: DEFAULT_FILL_OPACITY,
  colorSelectTolerance: DEFAULT_COLOR_SELECT_TOLERANCE,
  colorComparisonMethod: 'simple',
  selectionOpacity: DEFAULT_SELECTION_OPACITY,
  applyWholeImage: false,
  maskBoundary: false,
  maskTolerance: DEFAULT_MASK_TOLERANCE,
};

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    // Merge rather than replace: a settings blob written by an older build is
    // missing whatever was added since, and a partial brush would render the
    // editor unusable.
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      brush: { ...DEFAULT_BRUSH, ...(parsed.brush ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persistSettings(settings: PersistedSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode / quota — the editor works fine, it just won't remember.
  }
}

export interface MaskEditorState extends PersistedSettings {
  target: MaskEditorTarget | null;
  open: (target: MaskEditorTarget) => void;
  close: () => void;
  setTool: (tool: Tool) => void;
  setBrush: (patch: Partial<Brush>) => void;
  setMaskBlendMode: (mode: MaskBlendMode) => void;
  setMaskOpacity: (opacity: number) => void;
  setRgbColor: (color: string) => void;
  setPaintBucketTolerance: (tolerance: number) => void;
  setFillOpacity: (opacity: number) => void;
  setColorSelectTolerance: (tolerance: number) => void;
  setColorComparisonMethod: (method: ColorComparisonMethod) => void;
  setSelectionOpacity: (opacity: number) => void;
  setApplyWholeImage: (value: boolean) => void;
  setMaskBoundary: (value: boolean) => void;
  setMaskTolerance: (tolerance: number) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const useMaskEditorStore = create<MaskEditorState>((set, get) => {
  /** Every setter routes through here so nothing can change without being saved. */
  const update = (patch: Partial<PersistedSettings>) => {
    set(patch as Partial<MaskEditorState>);
    const { target: _target, ...rest } = get();
    void _target;
    persistSettings(rest as unknown as PersistedSettings);
  };

  return {
    ...loadSettings(),
    target: null,

    open: (target) => set({ target }),
    close: () => set({ target: null }),

    setTool: (tool) => update({ tool }),
    setBrush: (patch) => {
      const next = { ...get().brush, ...patch };
      next.size = clamp(next.size, BRUSH_SIZE_MIN, BRUSH_SIZE_MAX);
      next.opacity = clamp(next.opacity, 0, 1);
      next.hardness = clamp(next.hardness, 0, 1);
      next.stepSize = clamp(next.stepSize, 1, 100);
      update({ brush: next });
    },
    setMaskBlendMode: (maskBlendMode) => update({ maskBlendMode }),
    setMaskOpacity: (maskOpacity) => update({ maskOpacity: clamp(maskOpacity, 0, 1) }),
    setRgbColor: (rgbColor) => update({ rgbColor }),
    setPaintBucketTolerance: (v) => update({ paintBucketTolerance: clamp(v, 0, 255) }),
    setFillOpacity: (v) => update({ fillOpacity: clamp(v, 0, 100) }),
    setColorSelectTolerance: (v) => update({ colorSelectTolerance: clamp(v, 0, 255) }),
    setColorComparisonMethod: (colorComparisonMethod) => update({ colorComparisonMethod }),
    setSelectionOpacity: (v) => update({ selectionOpacity: clamp(v, 0, 100) }),
    setApplyWholeImage: (applyWholeImage) => update({ applyWholeImage }),
    setMaskBoundary: (maskBoundary) => update({ maskBoundary }),
    setMaskTolerance: (v) => update({ maskTolerance: clamp(v, 0, 255) }),
  };
});

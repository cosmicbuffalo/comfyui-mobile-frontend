import { create } from 'zustand';
import { ensureViewerImageIdentity, type ViewerImage } from '@/utils/viewerImages';

/**
 * An offer to take the item currently on screen and hand it back to whoever
 * opened the viewer.
 *
 * The input picker sets this when a long press opens its browse list full
 * screen: from there you page through inputs and outputs at full size, and the
 * whole point of looking is to choose one. Without it the only way back to the
 * picker's own grid was to close the viewer and find the file again by
 * thumbnail.
 *
 * Cleared whenever the viewer closes, so a later viewer opened from the queue
 * or the outputs panel can never inherit a picker's callback.
 */
export interface ViewerPickAction {
  /** Button label, already translated by whoever registered the action. */
  label: string;
  /** False for an item this picker cannot accept (wrong media type, a folder). */
  canPick?: (item: ViewerImage) => boolean;
  onPick: (item: ViewerImage) => void;
}

interface ImageViewerState {
  viewerOpen: boolean;
  viewerImages: ViewerImage[];
  viewerIndex: number;
  viewerScale: number;
  viewerTranslate: { x: number; y: number };
  // True when the viewer's overlays have faded out after the idle timeout.
  // Surfaced from MediaViewer so siblings (e.g. the bottom bar) can fade in sync.
  viewerIdle: boolean;
  viewerPickAction: ViewerPickAction | null;
  // Shared by every fullscreen-viewer video. Keep this outside MediaViewer's
  // component state so swiping between clips (or closing and reopening the
  // viewer) never creates competing playback-rate values.
  videoPlaybackRate: number;
  setVideoPlaybackRate: (rate: number) => void;
  setViewerPickAction: (action: ViewerPickAction | null) => void;
  setViewerState: (
    next: Partial<Pick<ImageViewerState, 'viewerOpen' | 'viewerImages' | 'viewerIndex' | 'viewerScale' | 'viewerTranslate' | 'viewerIdle'>>
  ) => void;
}

export const useImageViewerStore = create<ImageViewerState>()((set) => ({
  viewerOpen: false,
  viewerImages: [],
  viewerIndex: 0,
  viewerScale: 1,
  viewerTranslate: { x: 0, y: 0 },
  viewerIdle: false,
  viewerPickAction: null,
  videoPlaybackRate: 1,
  setVideoPlaybackRate: (rate) => {
    if (!Number.isFinite(rate)) return;
    set({ videoPlaybackRate: Math.min(2, Math.max(0.1, rate)) });
  },
  setViewerPickAction: (action) => set({ viewerPickAction: action }),
  setViewerState: (next) => {
    set((state) => {
      // Every list entering the viewer passes through here, which makes it the
      // one place that can promise each item knows which file it is. Producers
      // that already attach `file`/`filename` are handed straight back
      // unchanged, and the ARRAY is handed back unchanged too when none of its
      // items needed filling in — the equality check below is what stops the
      // viewer's own list-extension effects from re-firing on their own writes,
      // and a freshly mapped array would defeat it every time.
      const nextImages = next.viewerImages
        ? (() => {
            const mapped = next.viewerImages.map(ensureViewerImageIdentity);
            return mapped.every((item, i) => item === next.viewerImages![i])
              ? next.viewerImages
              : mapped;
          })()
        : undefined;
      const candidate = {
        viewerOpen: next.viewerOpen ?? state.viewerOpen,
        viewerImages: nextImages ?? state.viewerImages,
        viewerIndex: next.viewerIndex ?? state.viewerIndex,
        viewerScale: next.viewerScale ?? state.viewerScale,
        viewerTranslate: next.viewerTranslate ?? state.viewerTranslate,
        viewerIdle: next.viewerIdle ?? state.viewerIdle,
      };
      const isSame =
        candidate.viewerOpen === state.viewerOpen &&
        candidate.viewerIndex === state.viewerIndex &&
        candidate.viewerScale === state.viewerScale &&
        candidate.viewerTranslate.x === state.viewerTranslate.x &&
        candidate.viewerTranslate.y === state.viewerTranslate.y &&
        candidate.viewerImages === state.viewerImages &&
        candidate.viewerIdle === state.viewerIdle;

      if (isSame) return state;
      // A closing viewer takes the pick offer with it: the action belongs to
      // the surface that opened this viewing session, not to the viewer.
      return candidate.viewerOpen
        ? { ...state, ...candidate }
        : { ...state, ...candidate, viewerPickAction: null };
    });
  },
}));

import { create } from 'zustand';
import type { ViewerImage } from '@/utils/viewerImages';

interface ImageViewerState {
  viewerOpen: boolean;
  viewerImages: ViewerImage[];
  viewerIndex: number;
  viewerScale: number;
  viewerTranslate: { x: number; y: number };
  // True when the viewer's overlays have faded out after the idle timeout.
  // Surfaced from MediaViewer so siblings (e.g. the bottom bar) can fade in sync.
  viewerIdle: boolean;
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
  setViewerState: (next) => {
    set((state) => {
      const candidate = {
        viewerOpen: next.viewerOpen ?? state.viewerOpen,
        viewerImages: next.viewerImages ?? state.viewerImages,
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

      return isSame ? state : { ...state, ...candidate };
    });
  },
}));

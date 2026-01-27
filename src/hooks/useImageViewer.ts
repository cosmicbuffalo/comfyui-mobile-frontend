import { create } from 'zustand';
import type { ViewerImage } from '@/utils/viewerImages';

interface ImageViewerState {
  viewerOpen: boolean;
  viewerImages: ViewerImage[];
  viewerIndex: number;
  viewerScale: number;
  viewerTranslate: { x: number; y: number };
  setViewerState: (
    next: Partial<Pick<ImageViewerState, 'viewerOpen' | 'viewerImages' | 'viewerIndex' | 'viewerScale' | 'viewerTranslate'>>
  ) => void;
}

export const useImageViewerStore = create<ImageViewerState>()((set) => ({
  viewerOpen: false,
  viewerImages: [],
  viewerIndex: 0,
  viewerScale: 1,
  viewerTranslate: { x: 0, y: 0 },
  setViewerState: (next) => {
    set((state) => {
      const candidate = {
        viewerOpen: next.viewerOpen ?? state.viewerOpen,
        viewerImages: next.viewerImages ?? state.viewerImages,
        viewerIndex: next.viewerIndex ?? state.viewerIndex,
        viewerScale: next.viewerScale ?? state.viewerScale,
        viewerTranslate: next.viewerTranslate ?? state.viewerTranslate,
      };
      const isSame =
        candidate.viewerOpen === state.viewerOpen &&
        candidate.viewerIndex === state.viewerIndex &&
        candidate.viewerScale === state.viewerScale &&
        candidate.viewerTranslate.x === state.viewerTranslate.x &&
        candidate.viewerTranslate.y === state.viewerTranslate.y &&
        candidate.viewerImages === state.viewerImages;

      return isSame ? state : { ...state, ...candidate };
    });
  },
}));

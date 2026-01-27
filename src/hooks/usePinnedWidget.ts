import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Workflow } from '@/api/types';

export interface PinnedWidget {
  nodeId: number;
  widgetIndex: number;
  widgetName: string;
  widgetType: string;
  options?: Record<string, unknown> | unknown[];
}

interface PinnedWidgetState {
  pinnedWidgets: Record<string, PinnedWidget>;
  pinnedWidget: PinnedWidget | null;
  pinOverlayOpen: boolean;
  setPinnedWidget: (pin: PinnedWidget | null, cacheKey?: string | null) => void;
  setPinOverlayOpen: (open: boolean) => void;
  togglePinOverlay: () => void;
  clearPinnedWidgetForKey: (cacheKey: string | null | undefined) => void;
  restorePinnedWidgetForWorkflow: (cacheKey: string | null | undefined, workflow: Workflow) => void;
  clearCurrentPin: () => void;
}

export const usePinnedWidgetStore = create<PinnedWidgetState>()(
  persist(
    (set, get) => ({
      pinnedWidgets: {},
      pinnedWidget: null,
      pinOverlayOpen: false,

      setPinnedWidget: (pin, cacheKey) => {
        const { pinnedWidgets } = get();
        if (cacheKey && pin) {
          set({
            pinnedWidget: pin,
            pinnedWidgets: { ...pinnedWidgets, [cacheKey]: pin }
          });
        } else if (cacheKey && !pin) {
          const nextPinnedWidgets = { ...pinnedWidgets };
          delete nextPinnedWidgets[cacheKey];
          set({
            pinnedWidget: null,
            pinnedWidgets: nextPinnedWidgets
          });
        } else {
          set({ pinnedWidget: pin });
        }
      },

      setPinOverlayOpen: (open) => {
        set({ pinOverlayOpen: open });
      },

      togglePinOverlay: () => {
        set((state) => ({ pinOverlayOpen: !state.pinOverlayOpen }));
      },

      clearPinnedWidgetForKey: (cacheKey) => {
        if (!cacheKey) {
          set({ pinnedWidget: null, pinOverlayOpen: false });
          return;
        }
        set((state) => {
          const nextPinnedWidgets = { ...state.pinnedWidgets };
          delete nextPinnedWidgets[cacheKey];
          return {
            pinnedWidgets: nextPinnedWidgets,
            pinnedWidget: null,
            pinOverlayOpen: false
          };
        });
      },

      restorePinnedWidgetForWorkflow: (cacheKey, workflow) => {
        if (!cacheKey) {
          set({ pinnedWidget: null, pinOverlayOpen: false });
          return;
        }
        const cachedPin = get().pinnedWidgets[cacheKey];
        if (!cachedPin) {
          set({ pinnedWidget: null, pinOverlayOpen: false });
          return;
        }
        const nodeExists = workflow.nodes.some((node) => node.id === cachedPin.nodeId);
        set({
          pinnedWidget: nodeExists ? cachedPin : null,
          pinOverlayOpen: false
        });
      },

      clearCurrentPin: () => {
        set({ pinnedWidget: null, pinOverlayOpen: false });
      }
    }),
    {
      name: 'pinned-widget-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        pinnedWidgets: state.pinnedWidgets,
        pinnedWidget: state.pinnedWidget,
        pinOverlayOpen: state.pinOverlayOpen
      })
    }
  )
);

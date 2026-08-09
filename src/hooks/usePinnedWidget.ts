import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Workflow } from '@/api/types';

export interface PinnedWidget {
  nodeId: number;
  widgetIndex: number;
  widgetName: string;
  /** Canonical schema name when the display name is shortened or decorated. */
  inputName?: string;
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
  /**
   * Re-point or drop pins on `nodeId` after its widget slots changed (e.g. a
   * DynamicCombo branch switch). `resolveIndex` returns the widget's new slot,
   * or null when the pinned input no longer exists on the node.
   */
  reconcilePinsForNode: (
    nodeId: number,
    cacheKey: string | null | undefined,
    resolveIndex: (pin: PinnedWidget) => number | null,
  ) => void;
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
      },

      reconcilePinsForNode: (nodeId, cacheKey, resolveIndex) => {
        set((state) => {
          const reconcile = (pin: PinnedWidget | null): PinnedWidget | null => {
            if (!pin || pin.nodeId !== nodeId) return pin;
            const index = resolveIndex(pin);
            if (index === null) return null;
            return index === pin.widgetIndex ? pin : { ...pin, widgetIndex: index };
          };

          const next: Partial<PinnedWidgetState> = {};
          const current = reconcile(state.pinnedWidget);
          if (current !== state.pinnedWidget) {
            next.pinnedWidget = current;
            if (!current) next.pinOverlayOpen = false;
          }
          if (cacheKey) {
            const cached = state.pinnedWidgets[cacheKey] ?? null;
            const reconciled = reconcile(cached);
            if (reconciled !== cached) {
              const nextPinnedWidgets = { ...state.pinnedWidgets };
              if (reconciled) nextPinnedWidgets[cacheKey] = reconciled;
              else delete nextPinnedWidgets[cacheKey];
              next.pinnedWidgets = nextPinnedWidgets;
            }
          }
          return next;
        });
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

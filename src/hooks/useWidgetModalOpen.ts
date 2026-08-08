import { create } from 'zustand';

// Tracks how many FullscreenWidgetModal instances are currently open so
// unrelated chrome (e.g. the execution progress card in BottomStatusOverlay)
// can hide itself while the user is editing a widget. A count (rather than a
// boolean) keeps things correct when modals stack (e.g. a file picker opened
// from inside another widget editor).
interface WidgetModalOpenState {
  openCount: number;
  widgetModalOpened: () => void;
  widgetModalClosed: () => void;
}

export const useWidgetModalOpenStore = create<WidgetModalOpenState>()((set) => ({
  openCount: 0,
  widgetModalOpened: () => set((state) => ({ openCount: state.openCount + 1 })),
  widgetModalClosed: () =>
    set((state) => ({ openCount: Math.max(0, state.openCount - 1) })),
}));

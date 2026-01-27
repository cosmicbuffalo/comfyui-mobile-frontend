import { create } from 'zustand';

interface AppMenuState {
  appMenuOpen: boolean;
  setAppMenuOpen: (open: boolean) => void;
}

export const useAppMenuStore = create<AppMenuState>((set) => ({
  appMenuOpen: false,
  setAppMenuOpen: (open) => set({ appMenuOpen: open })
}));

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The server logs window lives at the app root, outside the menu and panels,
// so it stays open while the user closes the menu or switches panels. Whether
// it's open, and where the user last put it on desktop, survive reloads.
interface ServerLogsWindowState {
  open: boolean;
  setOpen: (open: boolean) => void;
  geometry: WindowGeometry | null;
  setGeometry: (geometry: WindowGeometry) => void;
}

export const useServerLogsWindowStore = create<ServerLogsWindowState>()(
  persist(
    (set) => ({
      open: false,
      setOpen: (open) => set({ open }),
      geometry: null,
      setGeometry: (geometry) => set({ geometry }),
    }),
    {
      name: 'server-logs-window',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ open: state.open, geometry: state.geometry }),
    },
  ),
);

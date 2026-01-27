import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type PanelMode = 'workflow' | 'queue' | 'outputs';

interface NavigationState {
  currentPanel: PanelMode;
  setCurrentPanel: (panel: PanelMode) => void;
}

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set) => ({
      currentPanel: 'workflow',
      setCurrentPanel: (panel) => {
        set({ currentPanel: panel });
      }
    }),
    {
      name: 'navigation-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentPanel: state.currentPanel
      })
    }
  )
);

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemeMode = 'dark' | 'light';

interface ThemeState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'dark',
      setTheme: (theme) => {
        void theme;
        set({ theme: 'dark' });
      },
      toggleTheme: () => {
        set(() => ({ theme: 'dark' }));
      }
    }),
    {
      name: 'theme-storage',
      storage: createJSONStorage(() => localStorage),
      // TEMPORARY: keep UI locked to dark mode while we fix color tuning.
      // Light mode is intentionally disabled for now and will be restored later.
      onRehydrateStorage: () => (state) => {
        state?.setTheme('dark');
      },
    }
  )
);

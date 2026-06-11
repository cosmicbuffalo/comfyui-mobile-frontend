import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Device-local favorites for workflow templates, keyed by "moduleName/templateName"
 * (a template is only unique within its module). Mirrors the workflow-favorites
 * persistence pattern. Templates can't be renamed/moved/deleted from here, so this
 * store is just a flat toggle list — no rename/remove plumbing needed.
 */
interface TemplateFavoritesState {
  favorites: string[];
  toggleFavorite: (key: string) => void;
}

/** Stable favorites key for a template. */
export function templateFavoriteKey(moduleName: string, templateName: string): string {
  return `${moduleName}/${templateName}`;
}

export const useTemplateFavoritesStore = create<TemplateFavoritesState>()(
  persist(
    (set) => ({
      favorites: [],

      toggleFavorite: (key) => {
        if (!key) return;
        set((s) => ({
          favorites: s.favorites.includes(key)
            ? s.favorites.filter((k) => k !== key)
            : [...s.favorites, key],
        }));
      },
    }),
    {
      name: 'template-favorites-storage',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

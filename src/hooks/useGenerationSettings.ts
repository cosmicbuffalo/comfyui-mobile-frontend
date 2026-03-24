import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type PreviewMethod = 'none' | 'latent2rgb' | 'taesd';

interface GenerationSettingsState {
  previewMethod: PreviewMethod;
  setPreviewMethod: (method: PreviewMethod) => void;
}

export const useGenerationSettingsStore = create<GenerationSettingsState>()(
  persist(
    (set) => ({
      previewMethod: 'none',
      setPreviewMethod: (method) => set({ previewMethod: method }),
    }),
    {
      name: 'generation-settings-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

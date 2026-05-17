import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type PreviewMethod = 'none' | 'latent2rgb' | 'taesd';

interface GenerationSettingsState {
  infiniteModeEnabled: boolean;
  setInfiniteModeEnabled: (value: boolean) => void;
  previewMethod: PreviewMethod;
  setPreviewMethod: (method: PreviewMethod) => void;
  followIntoSubgraphs: boolean;
  setFollowIntoSubgraphs: (value: boolean) => void;
}

export const useGenerationSettingsStore = create<GenerationSettingsState>()(
  persist(
    (set) => ({
      infiniteModeEnabled: false,
      setInfiniteModeEnabled: (value) => set({ infiniteModeEnabled: value }),
      previewMethod: 'none',
      setPreviewMethod: (method) => set({ previewMethod: method }),
      followIntoSubgraphs: true,
      setFollowIntoSubgraphs: (value) => set({ followIntoSubgraphs: value }),
    }),
    {
      name: 'generation-settings-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

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
  // When on (default), image previews/thumbnails load a fast on-the-fly WebP
  // re-encode instead of the full PNG. Opt out to always load original files.
  webpPreviewEnabled: boolean;
  setWebpPreviewEnabled: (value: boolean) => void;
  hideBottomBarWhenViewerIdle: boolean;
  setHideBottomBarWhenViewerIdle: (value: boolean) => void;
  autoRestoreLostQueueJobs: boolean;
  setAutoRestoreLostQueueJobs: (value: boolean) => void;
  obfuscateSharedInputPaths: boolean;
  setObfuscateSharedInputPaths: (value: boolean) => void;
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
      webpPreviewEnabled: true,
      setWebpPreviewEnabled: (value) => set({ webpPreviewEnabled: value }),
      hideBottomBarWhenViewerIdle: false,
      setHideBottomBarWhenViewerIdle: (value) => set({ hideBottomBarWhenViewerIdle: value }),
      autoRestoreLostQueueJobs: false,
      setAutoRestoreLostQueueJobs: (value) => set({ autoRestoreLostQueueJobs: value }),
      obfuscateSharedInputPaths: false,
      setObfuscateSharedInputPaths: (value) => set({ obfuscateSharedInputPaths: value }),
    }),
    {
      name: 'generation-settings-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

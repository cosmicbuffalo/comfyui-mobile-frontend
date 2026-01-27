import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as api from '@/api/client';

export interface QueueItem {
  number: number;
  prompt_id: string;
  prompt: Record<string, unknown>;
  extra: Record<string, unknown>;
  outputs_to_execute: string[];
}

interface QueueState {
  running: QueueItem[];
  pending: QueueItem[];
  isLoading: boolean;
  lastExecutedId: string | null;
  queueItemExpanded: Record<string, boolean>;
  queueItemUserToggled: Record<string, boolean>;
  queueItemHideImages: Record<string, boolean>;
  showQueueMetadata: boolean;
  previewVisibility: Record<string, boolean>;
  previewVisibilityDefault: boolean;

  // Actions
  fetchQueue: () => Promise<void>;
  clearQueue: () => Promise<void>;
  deleteItem: (promptId: string) => Promise<void>;
  interrupt: () => Promise<void>;
  updateFromStatus: (queueRemaining: number) => void;
  setQueueItemExpanded: (promptId: string, expanded: boolean) => void;
  setQueueItemUserToggled: (promptId: string, toggled: boolean) => void;
  setQueueItemHideImages: (promptId: string, hidden: boolean) => void;
  toggleQueueItemHideImages: (promptId: string) => void;
  setShowQueueMetadata: (show: boolean) => void;
  toggleShowQueueMetadata: () => void;
  setPreviewVisibility: (promptId: string, visible: boolean) => void;
  togglePreviewVisibility: (promptId: string) => void;
  setPreviewVisibilityDefault: (visible: boolean) => void;
}

export const useQueueStore = create<QueueState>()(
  persist(
    (set, get) => ({
      running: [],
      pending: [],
      isLoading: false,
      lastExecutedId: null,
      queueItemExpanded: {},
      queueItemUserToggled: {},
      queueItemHideImages: {},
      showQueueMetadata: false,
      previewVisibility: {},
      previewVisibilityDefault: false,

      fetchQueue: async () => {
        const { running: oldRunning } = get();
        set({ isLoading: true });
        try {
          const queue = await api.getQueue();

          const running = queue.queue_running.map((item) => ({
            number: item[0],
            prompt_id: item[1],
            prompt: item[2] as Record<string, unknown>,
            extra: item[3],
            outputs_to_execute: item[4]
          }));

          const pending = queue.queue_pending.map((item) => ({
            number: item[0],
            prompt_id: item[1],
            prompt: item[2] as Record<string, unknown>,
            extra: item[3],
            outputs_to_execute: item[4]
          }));

          // Detect finished items
          if (oldRunning.length > 0 && running.length === 0) {
            set({ lastExecutedId: oldRunning[0].prompt_id });
            // Clear after a delay to allow Toast to notice
            setTimeout(() => set({ lastExecutedId: null }), 100);
          }

          set({ running, pending });
        } catch (err) {
          console.error('Failed to fetch queue:', err);
        } finally {
          set({ isLoading: false });
        }
      },

      clearQueue: async () => {
        try {
          await api.clearQueue();
          set({ pending: [] });
        } catch (err) {
          console.error('Failed to clear queue:', err);
        }
      },

      deleteItem: async (promptId) => {
        try {
          await api.deleteQueueItem(promptId);
          set((state) => ({
            pending: state.pending.filter((item) => item.prompt_id !== promptId)
          }));
        } catch (err) {
          console.error('Failed to delete queue item:', err);
        }
      },

      interrupt: async () => {
        try {
          await api.interruptExecution();
        } catch (err) {
          console.error('Failed to interrupt execution:', err);
        }
      },

      updateFromStatus: (queueRemaining) => {
        // Quick update based on status message
        // Will be corrected by next fetchQueue call
        const { pending } = get();
        if (queueRemaining !== pending.length) {
          get().fetchQueue();
        }
      },

      setQueueItemExpanded: (promptId, expanded) => {
        set((state) => ({
          queueItemExpanded: { ...state.queueItemExpanded, [promptId]: expanded }
        }));
      },

      setQueueItemUserToggled: (promptId, toggled) => {
        set((state) => ({
          queueItemUserToggled: { ...state.queueItemUserToggled, [promptId]: toggled }
        }));
      },

      setQueueItemHideImages: (promptId, hidden) => {
        set((state) => ({
          queueItemHideImages: { ...state.queueItemHideImages, [promptId]: hidden }
        }));
      },

      toggleQueueItemHideImages: (promptId) => {
        set((state) => ({
          queueItemHideImages: {
            ...state.queueItemHideImages,
            [promptId]: !state.queueItemHideImages[promptId]
          }
        }));
      },

      setShowQueueMetadata: (show) => {
        set({ showQueueMetadata: show });
      },

      toggleShowQueueMetadata: () => {
        set((state) => ({ showQueueMetadata: !state.showQueueMetadata }));
      },

      setPreviewVisibility: (promptId, visible) => {
        set((state) => ({
          previewVisibility: { ...state.previewVisibility, [promptId]: visible }
        }));
      },

      togglePreviewVisibility: (promptId) => {
        set((state) => ({
          previewVisibility: {
            ...state.previewVisibility,
            [promptId]: !state.previewVisibility[promptId]
          }
        }));
      },

      setPreviewVisibilityDefault: (visible) => {
        set({ previewVisibilityDefault: visible });
      }
    }),
    {
      name: 'queue-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        queueItemExpanded: state.queueItemExpanded,
        queueItemUserToggled: state.queueItemUserToggled,
        queueItemHideImages: state.queueItemHideImages,
        showQueueMetadata: state.showQueueMetadata,
        previewVisibility: state.previewVisibility,
        previewVisibilityDefault: state.previewVisibilityDefault
      })
    }
  )
);

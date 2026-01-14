import { create } from 'zustand';
import * as api from '@/api/client';

interface QueueItem {
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

  // Actions
  fetchQueue: () => Promise<void>;
  clearQueue: () => Promise<void>;
  deleteItem: (promptId: string) => Promise<void>;
  interrupt: () => Promise<void>;
  updateFromStatus: (queueRemaining: number) => void;
}

export const useQueueStore = create<QueueState>((set, get) => ({
  running: [],
  pending: [],
  isLoading: false,

  fetchQueue: async () => {
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
  }
}));

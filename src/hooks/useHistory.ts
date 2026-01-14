import { create } from 'zustand';
import * as api from '@/api/client';
import type { HistoryOutputImage, Workflow } from '@/api/types';
import { useWorkflowStore, getWorkflowSignature } from '@/hooks/useWorkflow';

interface HistoryEntry {
  prompt_id: string;
  timestamp: number;
  durationSeconds?: number;
  success?: boolean;
  outputs: {
    images: HistoryOutputImage[];
  };
  prompt: Record<string, unknown>;
  workflow?: Workflow;
}

interface HistoryState {
  history: HistoryEntry[];
  isLoading: boolean;

  // Actions
  fetchHistory: () => Promise<void>;
  deleteItem: (promptId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  clearEmptyItems: () => Promise<void>;
  addHistoryEntry: (entry: HistoryEntry) => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: [],
  isLoading: false,

  addHistoryEntry: (entry) => {
    set((state) => {
      // Check if exists
      if (state.history.some(h => h.prompt_id === entry.prompt_id)) {
        return state;
      }
      // Add to top
      return { history: [entry, ...state.history] };
    });
    const workflowStore = useWorkflowStore.getState();
    if (workflowStore.queueItemExpanded[entry.prompt_id] === undefined) {
      workflowStore.setQueueItemExpanded(entry.prompt_id, true);
    }
    if (entry.workflow && entry.durationSeconds) {
      const signature = getWorkflowSignature(entry.workflow);
      workflowStore.updateWorkflowDuration(signature, entry.durationSeconds * 1000);
    }
  },

  fetchHistory: async () => {
    set({ isLoading: true });
    try {
      const data = await api.getHistory(50); // Get last 50 items

      const entries: HistoryEntry[] = Object.entries(data).map(([prompt_id, item]) => {
        // Collect all images from all output nodes
        const images: HistoryOutputImage[] = [];
        for (const output of Object.values(item.outputs)) {
          if (output.images) {
            images.push(...output.images);
          }
          if (output.gifs) {
            images.push(...output.gifs);
          }
          if (output.videos) {
            images.push(...output.videos);
          }
        }

        // Extract timestamp and duration from status messages if available
        let timestamp = Date.now();
        let startTime: number | null = null;
        let endTime: number | null = null;
        let failed = false;
        if (item.status?.messages) {
          for (const [msgType, msgData] of item.status.messages) {
            if (msgType === 'execution_start' && msgData.timestamp) {
              timestamp = msgData.timestamp as number;
              startTime = msgData.timestamp as number;
            }
            if ((msgType === 'execution_end' || msgType === 'execution_success') && msgData.timestamp) {
              endTime = msgData.timestamp as number;
            }
            if (msgType === 'execution_error') {
              failed = true;
            }
          }
        }

        if (startTime === null && timestamp) {
          startTime = timestamp;
        }

        const durationSeconds = (startTime !== null && endTime !== null && endTime >= startTime)
          ? (endTime - startTime) / 1000
          : undefined;
        const statusStr = item.status?.status_str?.toLowerCase() || '';
        const success = !failed && item.status?.completed !== false && !statusStr.includes('error');
        const workflow = (item.prompt?.[3] as { extra_pnginfo?: { workflow?: Workflow } } | undefined)?.extra_pnginfo?.workflow;

        return {
          prompt_id,
          timestamp,
          durationSeconds,
          success,
          outputs: { images },
          prompt: item.prompt[2] as Record<string, unknown>,
          workflow
        };
      });

      // Sort by timestamp, newest first
      entries.sort((a, b) => b.timestamp - a.timestamp);

      set({ history: entries });
      const workflowStore = useWorkflowStore.getState();
      for (const entry of entries) {
        if (workflowStore.queueItemExpanded[entry.prompt_id] === undefined) {
          workflowStore.setQueueItemExpanded(entry.prompt_id, true);
        }
        if (entry.workflow && entry.durationSeconds) {
          const signature = getWorkflowSignature(entry.workflow);
          workflowStore.updateWorkflowDuration(signature, entry.durationSeconds * 1000);
        }
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  deleteItem: async (promptId) => {
    try {
      await api.deleteHistoryItem(promptId);
      set((state) => ({
        history: state.history.filter((item) => item.prompt_id !== promptId)
      }));
    } catch (err) {
      console.error('Failed to delete history item:', err);
    }
  },

  clearHistory: async () => {
    try {
      await api.clearHistory();
    } catch (err) {
      console.error('Failed to clear history:', err);
      try {
        const promptIds = get().history.map((item) => item.prompt_id);
        await api.deleteHistoryItems(promptIds);
      } catch (deleteErr) {
        console.error('Failed to delete history items:', deleteErr);
      }
    } finally {
      set({ history: [] });
    }
  },
  clearEmptyItems: async () => {
    const promptIds = get().history
      .filter((item) => item.outputs.images.length === 0)
      .map((item) => item.prompt_id);
    if (promptIds.length === 0) return;
    try {
      await api.deleteHistoryItems(promptIds);
      set((state) => ({
        history: state.history.filter((item) => !promptIds.includes(item.prompt_id))
      }));
    } catch (err) {
      console.error('Failed to delete empty history items:', err);
    }
  }
}));

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as api from '@/api/client';
import type { HistoryOutputImage } from '@/api/types';
import type { QueuePromptMetadata } from '@/api/client';
import type { QueueWorkflowDiff } from '@/utils/workflowDiff';
import { idbStorage } from '@/utils/idbStorage';
import { createQueueDisplaySlice } from './useQueue/displaySlice';
import { createQueueRecoverySlice } from './useQueue/recoverySlice';
import { capWorkflowDiffs, makeShadowJobFromQueueItem } from './useQueue/queueHelpers';

export interface QueueItem {
  number: number;
  prompt_id: string;
  prompt: Record<string, unknown>;
  extra: Record<string, unknown>;
  outputs_to_execute: string[];
}

// Identity-stable polling helpers: a queue item's content is immutable for a
// given prompt_id, so comparing ids + numbers in order detects any change.
function sameQueueItems(a: QueueItem[], b: QueueItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (item, index) =>
      item.prompt_id === b[index].prompt_id && item.number === b[index].number,
  );
}

function shallowEqualNumberRecord(
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

export interface ShadowQueueJob {
  originalPromptId: string;
  prompt: Record<string, unknown>;
  extraData?: Record<string, unknown>;
  outputsToExecute: string[];
  number: number;
  status: 'pending' | 'running';
  queuedAt: number;
  sessionId?: string | null;
}

export interface QueueState {
  running: QueueItem[];
  pending: QueueItem[];
  // Running items retained between leaving the backend queue and appearing in
  // history, so the queue card can hand off without disappearing.
  completing: QueueItem[];
  // When each `completing` item entered that state, so a card whose history
  // never arrives (e.g. it rolled out of the fetched window under heavy load)
  // can be TTL-pruned instead of becoming a permanent "running" zombie.
  completingStartedAt: Record<string, number>;
  // Locally measured duration available during the brief completing-to-history
  // handoff, before the authoritative history duration arrives.
  completionDurations: Record<string, number>;
  isLoading: boolean;
  // User-visible failure from a queue action (cancel/delete/interrupt);
  // surfaced as a toast by the queue panel and cleared after display.
  actionError: string | null;
  setActionError: (message: string | null) => void;
  lastExecutedId: string | null;
  // Prompt ordering for follow-queue live outputs. Locally enqueued prompts are
  // registered at submit time; prompts from another client are registered when
  // their first live output arrives over the websocket.
  localPromptOrder: Record<string, number>;
  nextLocalPromptOrder: number;
  livePromptOutputs: Record<string, HistoryOutputImage[]>;
  queueItemExpanded: Record<string, boolean>;
  queueItemUserToggled: Record<string, boolean>;
  queueItemHideImages: Record<string, boolean>;
  showQueueMetadata: boolean;
  showQueueTimestamps: boolean;
  showPromptPreview: boolean;
  previewVisibility: Record<string, boolean>;
  previewVisibilityDefault: boolean;
  // Per-prompt workflow diff/prompt-preview, computed at enqueue time.
  workflowDiffs: Record<string, QueueWorkflowDiff>;
  shadowQueueJobs: Record<string, ShadowQueueJob>;
  recoverableJobIds: string[];
  autoRestoredPromptIds: Record<string, string>;
  isRestoringLostJobs: boolean;
  queueMetadata: Record<string, QueuePromptMetadata>;

  // Actions
  fetchQueue: () => Promise<void>;
  clearQueue: () => Promise<void>;
  deleteItem: (promptId: string) => Promise<void>;
  interrupt: () => Promise<void>;
  updateFromStatus: (queueRemaining: number) => void;
  registerLocalPrompt: (promptId: string) => void;
  addLivePromptOutputs: (promptId: string, images: HistoryOutputImage[]) => void;
  clearLivePromptOutputs: (promptId?: string) => void;
  markPromptCompleting: (promptId: string, durationSeconds?: number) => void;
  // Optimistically drop a finished prompt from `running` so consumers keyed on
  // the running list (e.g. the progress overlays via runKey) update immediately
  // on the execution-finished event, instead of waiting for fetchQueue to
  // re-read an emptied queue (which can race the backend and leave it stuck).
  removeRunning: (promptId: string) => void;
  setQueueItemExpanded: (promptId: string, expanded: boolean) => void;
  setQueueItemUserToggled: (promptId: string, toggled: boolean) => void;
  setQueueItemHideImages: (promptId: string, hidden: boolean) => void;
  toggleQueueItemHideImages: (promptId: string) => void;
  setShowQueueMetadata: (show: boolean) => void;
  toggleShowQueueMetadata: () => void;
  setShowQueueTimestamps: (show: boolean) => void;
  toggleShowQueueTimestamps: () => void;
  setShowPromptPreview: (show: boolean) => void;
  toggleShowPromptPreview: () => void;
  recordWorkflowDiff: (promptId: string, diff: QueueWorkflowDiff) => void;
  fetchQueueMetadata: (promptIds: string[]) => Promise<void>;
  setPreviewVisibility: (promptId: string, visible: boolean) => void;
  togglePreviewVisibility: (promptId: string) => void;
  setPreviewVisibilityDefault: (visible: boolean) => void;
  recordQueuedPrompt: (
    promptId: string,
    request: api.PromptQueueRequest,
    options?: { number?: number; outputsToExecute?: string[]; sessionId?: string | null },
  ) => void;
  markPromptCompleted: (promptId: string) => void;
  detectRecoverableJobs: (completedPromptIds?: Iterable<string>) => string[];
  clearRecoverableJobs: () => void;
  restoreLostJobs: (
    options?: {
      auto?: boolean;
      onRestored?: (params: { oldPromptId: string; newPromptId: string; job: ShadowQueueJob }) => void;
    },
  ) => Promise<void>;
}

// A queue card sits in `completing` only during the brief hand-off from the
// backend queue to the history record. If its history never lands within this
// window (e.g. >50 prompts completed between two history fetches under load),
// treat it as done and drop it so it can't become a permanent "running" zombie.
const COMPLETING_TTL_MS = 30_000;

// In-flight fetchQueue promise, so an overlapping call (reconnect + the 2s poll)
// awaits the same fetch instead of racing a second one.
let fetchQueueInFlight: Promise<void> | null = null;


export const useQueueStore = create<QueueState>()(
  persist(
    (set, get, store) => ({
      ...createQueueDisplaySlice(set, get, store),
      ...createQueueRecoverySlice(set, get, store),
      running: [],
      pending: [],
      completing: [],
      completingStartedAt: {},
      completionDurations: {},
      isLoading: false,
      actionError: null,
      setActionError: (message) => set({ actionError: message }),
      lastExecutedId: null,
      localPromptOrder: {},
      nextLocalPromptOrder: 1,
      livePromptOutputs: {},
      queueMetadata: {},

      fetchQueue: async () => {
        if (fetchQueueInFlight) return fetchQueueInFlight;
        let resolveInFlight!: () => void;
        fetchQueueInFlight = new Promise<void>((resolve) => { resolveInFlight = resolve; });
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

          set((state) => {
            // This runs on every 2s poll during a run; reuse previous
            // references whenever content is unchanged so subscribers don't
            // re-render on identical payloads (identity-stable polling).
            let shadowChanged = false;
            const shadowQueueJobs = { ...state.shadowQueueJobs };
            const activePromptIds = new Set([
              ...running.map((item) => item.prompt_id),
              ...pending.map((item) => item.prompt_id),
            ]);
            const completingById = new Map(
              state.completing
                .filter((item) => !activePromptIds.has(item.prompt_id))
                .map((item) => [item.prompt_id, item]),
            );
            for (const item of oldRunning) {
              if (!activePromptIds.has(item.prompt_id)) {
                completingById.set(item.prompt_id, item);
              }
            }
            for (const item of pending) {
              const existing = shadowQueueJobs[item.prompt_id];
              if (!existing) {
                shadowQueueJobs[item.prompt_id] = makeShadowJobFromQueueItem(item, 'pending');
                shadowChanged = true;
              } else if (existing.status !== 'pending') {
                shadowQueueJobs[item.prompt_id] = { ...existing, status: 'pending' };
                shadowChanged = true;
              }
            }
            for (const item of running) {
              const existing = shadowQueueJobs[item.prompt_id];
              if (existing && existing.status !== 'running') {
                shadowQueueJobs[item.prompt_id] = { ...existing, status: 'running' };
                shadowChanged = true;
              }
            }
            // Stamp newly-completing items and TTL-prune ones whose history never
            // arrived: drop the stuck card and its per-prompt display maps so it
            // can't become a permanent "running" zombie or leak. Shadow jobs /
            // recoverable ids are intentionally left for the lost-job recovery
            // path to handle.
            const now = Date.now();
            const completingStartedAt: Record<string, number> = {};
            let mapsChanged = false;
            const livePromptOutputs = { ...state.livePromptOutputs };
            const localPromptOrder = { ...state.localPromptOrder };
            const completionDurations = { ...state.completionDurations };
            for (const id of [...completingById.keys()]) {
              const startedAt = state.completingStartedAt[id] ?? now;
              if (now - startedAt > COMPLETING_TTL_MS) {
                completingById.delete(id);
                delete livePromptOutputs[id];
                delete localPromptOrder[id];
                delete completionDurations[id];
                mapsChanged = true;
              } else {
                completingStartedAt[id] = startedAt;
              }
            }
            const completing = Array.from(completingById.values());
            return {
              running: sameQueueItems(state.running, running) ? state.running : running,
              pending: sameQueueItems(state.pending, pending) ? state.pending : pending,
              completing: sameQueueItems(state.completing, completing)
                ? state.completing
                : completing,
              completingStartedAt: shallowEqualNumberRecord(
                state.completingStartedAt,
                completingStartedAt,
              )
                ? state.completingStartedAt
                : completingStartedAt,
              livePromptOutputs: mapsChanged ? livePromptOutputs : state.livePromptOutputs,
              localPromptOrder: mapsChanged ? localPromptOrder : state.localPromptOrder,
              completionDurations: mapsChanged
                ? completionDurations
                : state.completionDurations,
              shadowQueueJobs: shadowChanged ? shadowQueueJobs : state.shadowQueueJobs,
            };
          });
          void get().fetchQueueMetadata([
            ...running.map((item) => item.prompt_id),
            ...pending.map((item) => item.prompt_id),
          ]);
        } catch (err) {
          console.error('Failed to fetch queue:', err);
        } finally {
          set({ isLoading: false });
          fetchQueueInFlight = null;
          resolveInFlight();
        }
      },

      clearQueue: async () => {
        try {
          await api.clearQueue();
          set((state) => {
            const pendingIds = new Set(state.pending.map((item) => item.prompt_id));
            const shadowQueueJobs = { ...state.shadowQueueJobs };
            for (const promptId of pendingIds) {
              delete shadowQueueJobs[promptId];
            }
            return {
              pending: [],
              shadowQueueJobs,
              recoverableJobIds: state.recoverableJobIds.filter((id) => !pendingIds.has(id)),
            };
          });
        } catch (err) {
          console.error('Failed to clear queue:', err);
          set({ actionError: 'Failed to cancel pending generations' });
        }
      },

      deleteItem: async (promptId) => {
        try {
          await api.deleteQueueItem(promptId);
          set((state) => {
            const localPromptOrder = { ...state.localPromptOrder };
            const livePromptOutputs = { ...state.livePromptOutputs };
            delete localPromptOrder[promptId];
            delete livePromptOutputs[promptId];
            const shadowQueueJobs = { ...state.shadowQueueJobs };
            delete shadowQueueJobs[promptId];
            const autoRestoredPromptIds = { ...state.autoRestoredPromptIds };
            delete autoRestoredPromptIds[promptId];
            const workflowDiffs = { ...state.workflowDiffs };
            delete workflowDiffs[promptId];
            return {
              pending: state.pending.filter((item) => item.prompt_id !== promptId),
              localPromptOrder,
              livePromptOutputs,
              shadowQueueJobs,
              autoRestoredPromptIds,
              workflowDiffs,
              recoverableJobIds: state.recoverableJobIds.filter((id) => id !== promptId),
            };
          });
        } catch (err) {
          console.error('Failed to delete queue item:', err);
          set({ actionError: 'Failed to cancel the queued generation' });
        }
      },

      interrupt: async () => {
        try {
          await api.interruptExecution();
        } catch (err) {
          console.error('Failed to interrupt execution:', err);
          set({ actionError: 'Failed to interrupt the running generation' });
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

      registerLocalPrompt: (promptId) => {
        if (!promptId) return;
        set((state) => ({
          localPromptOrder: {
            ...state.localPromptOrder,
            [promptId]: state.localPromptOrder[promptId] ?? state.nextLocalPromptOrder,
          },
          nextLocalPromptOrder: state.localPromptOrder[promptId]
            ? state.nextLocalPromptOrder
            : state.nextLocalPromptOrder + 1,
        }));
      },

      addLivePromptOutputs: (promptId, images) => {
        if (!promptId || images.length === 0) return;
        set((state) => {
          const existingOrder = state.localPromptOrder[promptId];
          const nextOrder = existingOrder ?? state.nextLocalPromptOrder;
          return {
            localPromptOrder: {
              ...state.localPromptOrder,
              [promptId]: nextOrder,
            },
            nextLocalPromptOrder: existingOrder == null
              ? state.nextLocalPromptOrder + 1
              : state.nextLocalPromptOrder,
            livePromptOutputs: {
              ...state.livePromptOutputs,
              [promptId]: [
                ...(state.livePromptOutputs[promptId] ?? []),
                ...images,
              ],
            },
          };
        });
      },

      clearLivePromptOutputs: (promptId) => {
        if (!promptId) {
          set({
            livePromptOutputs: {},
            localPromptOrder: {},
            nextLocalPromptOrder: 1,
          });
          return;
        }
        set((state) => {
          const livePromptOutputs = { ...state.livePromptOutputs };
          const localPromptOrder = { ...state.localPromptOrder };
          delete livePromptOutputs[promptId];
          delete localPromptOrder[promptId];
          return { livePromptOutputs, localPromptOrder };
        });
      },

      removeRunning: (promptId) => {
        if (!promptId) return;
        set((state) => {
          if (!state.running.some((item) => item.prompt_id === promptId)) return {};
          return { running: state.running.filter((item) => item.prompt_id !== promptId) };
        });
      },

      markPromptCompleting: (promptId, durationSeconds) => {
        if (!promptId) return;
        set((state) => {
          const withDuration = (base: Record<string, number>) =>
            Number.isFinite(durationSeconds)
              ? { ...base, [promptId]: durationSeconds as number }
              : base;
          if (state.completing.some((item) => item.prompt_id === promptId)) {
            return { completionDurations: withDuration(state.completionDurations) };
          }
          const shadow = state.shadowQueueJobs[promptId];
          const item = state.running.find((candidate) => candidate.prompt_id === promptId)
            ?? state.pending.find((candidate) => candidate.prompt_id === promptId)
            ?? (shadow
              ? {
                  number: shadow.number ?? 0,
                  prompt_id: promptId,
                  prompt: shadow.prompt ?? {},
                  extra: shadow.extraData ?? {},
                  outputs_to_execute: shadow.outputsToExecute ?? [],
                }
              : null);
          // No locally-known job for this prompt (e.g. a generation started from
          // another client). ComfyUI broadcasts executing(null) to every socket,
          // so synthesizing a card here would flash a blank "completing" entry for
          // a foreign prompt. Only record completions we can attribute to our own
          // queued/shadow-tracked jobs.
          if (!item) {
            return { completionDurations: withDuration(state.completionDurations) };
          }
          return {
            completing: [...state.completing, item],
            completingStartedAt: { ...state.completingStartedAt, [promptId]: Date.now() },
            completionDurations: withDuration(state.completionDurations),
          };
        });
      },

      fetchQueueMetadata: async (promptIds) => {
        // Queue-prompt metadata is written once at enqueue time and never
        // mutates afterward, so skip ids we've already fetched. This stops the
        // panel from re-POSTing the entire (growing) queue on every list change.
        // Ids the server didn't have yet won't be in queueMetadata, so they're
        // naturally retried on the next call.
        const existing = get().queueMetadata;
        const uniqueIds = Array.from(new Set(promptIds.filter(Boolean))).filter(
          (id) => !existing[id],
        );
        if (uniqueIds.length === 0) return;
        try {
          const metadata = await api.getQueuePromptMetadata(uniqueIds);
          set((state) => ({
            queueMetadata: {
              ...state.queueMetadata,
              ...metadata,
            },
            workflowDiffs: capWorkflowDiffs({
              ...state.workflowDiffs,
              ...Object.fromEntries(
                Object.entries(metadata)
                  .filter(([, entry]) => Boolean(entry.workflowDiff))
                  .map(([promptId, entry]) => [promptId, entry.workflowDiff as QueueWorkflowDiff]),
              ),
            }),
          }));
        } catch (err) {
          console.warn('Failed to fetch mobile queue metadata:', err);
        }
      },

    }),
    {
      name: 'queue-storage',
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({
        queueItemExpanded: state.queueItemExpanded,
        queueItemUserToggled: state.queueItemUserToggled,
        queueItemHideImages: state.queueItemHideImages,
        showQueueMetadata: state.showQueueMetadata,
        showQueueTimestamps: state.showQueueTimestamps,
        showPromptPreview: state.showPromptPreview,
        previewVisibility: state.previewVisibility,
        previewVisibilityDefault: state.previewVisibilityDefault,
        workflowDiffs: state.workflowDiffs,
        shadowQueueJobs: state.shadowQueueJobs,
        recoverableJobIds: state.recoverableJobIds,
        autoRestoredPromptIds: state.autoRestoredPromptIds,
      })
    }
  )
);

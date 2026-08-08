import { create } from 'zustand';
import * as api from '@/api/client';
import type { HistoryOutputImage, Workflow } from '@/api/types';
import type { PromptQueueRequest } from '@/api/client';
import { useWorkflowStore, getWorkflowSignature } from '@/hooks/useWorkflow';
import { useQueueStore } from '@/hooks/useQueue';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { HIDDEN_WORKFLOW_EXTRA_DATA_KEY } from '@/utils/workflowHidden';
import { useOutputsStore } from '@/hooks/useOutputs';
import { bustImageCache } from '@/utils/imageCacheBust';
import { getHistoryImageFileId } from '@/utils/viewerImages';

// Invalidate the browser cache for a deleted entry's output images so a later
// generation that reuses the same filename doesn't show the stale deleted image.
function bustHistoryEntryImages(entry: HistoryEntry | undefined): void {
  if (!entry) return;
  for (const image of entry.outputs.images) {
    bustImageCache(image.filename, image.subfolder, image.type);
  }
}

// Cheap content signature for a history list. Used to skip the `set({history})`
// when a poll rebuilt an identical list — otherwise every ~2s poll during a run
// hands all queue cards new object identities and re-renders the whole list.
function historySignature(entries: HistoryEntry[]): string {
  const parts: string[] = [];
  for (const e of entries) {
    const imgs = e.outputs.images
      .map((i) => `${i.filename}/${i.subfolder}/${i.type}`)
      .join(',');
    parts.push(
      `${e.prompt_id}:${e.timestamp}:${e.success ? 1 : 0}:${e.interrupted ? 1 : 0}:${e.hidden ? 1 : 0}:${e.errorMessage ?? ''}:${imgs}`,
    );
  }
  return parts.join('|');
}

export interface HistoryEntry {
  prompt_id: string;
  timestamp: number;
  durationSeconds?: number;
  success?: boolean;
  interrupted?: boolean;
  errorMessage?: string | null;
  outputs: {
    images: HistoryOutputImage[];
  };
  prompt: Record<string, unknown>;
  workflow?: Workflow;
  hidden?: boolean;
  queueRequest?: PromptQueueRequest;
  outputsToExecute?: string[];
}

interface HistoryState {
  history: HistoryEntry[];
  isLoading: boolean;
  // Current number of newest history items being loaded. Grows as the user
  // scrolls the queue (the /history endpoint takes max_items, not an offset, so
  // "load more" refetches a larger newest-N window).
  historyLimit: number;
  // False once the server returned fewer items than requested — no older items
  // remain to load.
  hasMoreHistory: boolean;
  // Real total run count from the backend (independent of how many pages are
  // loaded). Null until first resolved / when the count endpoint is unavailable.
  historyTotal: number | null;

  // Actions
  // Resolves true only after a response was fetched and processed. Failures are
  // reported as false (rather than thrown) because websocket handlers also call
  // this fire-and-forget; the queue panel uses the flag to retry initial load.
  fetchHistory: (maxItems?: number) => Promise<boolean>;
  // Grow the loaded window by one page and refetch.
  loadMoreHistory: () => Promise<void>;
  // Internal: the actual fetch body, wrapped by fetchHistory's in-flight dedupe.
  _runFetchHistory: (maxItems: number) => Promise<boolean>;
  deleteItem: (promptId: string) => Promise<void>;
  // Reverse lookup for deleted output files. Given the file ids
  // (`type/subfolder/filename`, matching getHistoryImageFileId) of outputs that
  // have been deleted, drop those images from every history entry that holds
  // them. Entries left with no images are deleted outright (server + store) so
  // no orphaned queue card lingers; entries that still have images are updated
  // in place so the card re-renders with only the survivors.
  removeOutputImages: (fileIds: string[]) => Promise<void>;
  clearHistory: () => Promise<void>;
  clearEmptyItems: () => Promise<void>;
  addHistoryEntry: (entry: HistoryEntry) => void;
}

// Two-phase history load: paint the newest few items immediately, then backfill
// the rest in the background. The full /history payload carries every embedded
// workflow and is parsed + post-processed on the main thread, which dominated
// the queue's ~16s initial load.
export const INITIAL_HISTORY_PAGE_SIZE = 10;
// How many more items each "load more" (scroll near the bottom) pulls in.
const HISTORY_PAGE_SIZE = 10;

// Only one history payload may be in flight, regardless of requested page size.
// The endpoint returns a newest-N window, so racing (for example) N=10 and N=20
// wastes bandwidth and can let the smaller response overwrite the larger one.
// A larger request waits for the active smaller request, then runs; a smaller
// request simply shares the active larger result.
let historyFetchInFlight: { limit: number; promise: Promise<boolean> } | null = null;

// Cheap signature of the latest RAW /history payload, so the recurring
// ~2s poll during a run can bail out before the expensive part — building ~50
// HistoryEntry objects (each parsing an embedded workflow), the per-entry
// side-effect pass, and the two list signatures — whenever nothing changed.
// Captures exactly the fields that gate that work: which prompts exist, their
// completion status, and their output count. A real change (a run finishing,
// an item cleared) flips the signature and the full rebuild runs as before.
// Keep only the active window. Retaining one full signature for every 10-item
// pagination step made memory grow quadratically as users scrolled deep history.
// A single entry is sufficient only because refreshes go through
// fetchHistory() with no explicit size (the current window): a smaller-limit
// refetch would both miss this cache and truncate the loaded list.
let lastRawHistorySignature: { limit: number; value: string } | null = null;

function rawHistorySignature(data: Record<string, { status?: { status_str?: string; completed?: boolean }; outputs?: Record<string, unknown> }>): string {
  const parts: string[] = [];
  for (const id of Object.keys(data)) {
    const item = data[id];
    const status = item.status;
    const completed = status?.completed === false ? 0 : 1;
    const outputCount = item.outputs ? Object.keys(item.outputs).length : 0;
    parts.push(`${id}:${status?.status_str ?? ''}:${completed}:${outputCount}`);
  }
  return parts.join('|');
}

type DeferredDurationStat = { workflow: Workflow; durationMs: number };

const scheduleIdle: (cb: () => void) => void =
  typeof requestIdleCallback === 'function'
    ? (cb) => { requestIdleCallback(() => cb(), { timeout: 1000 }); }
    : (cb) => { setTimeout(cb, 0); };

// Duration stats only feed run-time estimates, never first paint. Each one is a
// full-workflow sort + JSON.stringify (getWorkflowSignature), so doing ~50 of
// them inline during fetchHistory blocked the load. Defer + chunk them off the
// critical path instead.
function scheduleDurationStatUpdates(updates: DeferredDurationStat[]): void {
  if (updates.length === 0) return;
  const queue = updates.slice();
  const process = () => {
    const store = useWorkflowStore.getState();
    const CHUNK = 8;
    for (let i = 0; i < CHUNK && queue.length > 0; i++) {
      const { workflow, durationMs } = queue.shift()!;
      store.updateWorkflowDuration(getWorkflowSignature(workflow), durationMs);
    }
    if (queue.length > 0) scheduleIdle(process);
  };
  scheduleIdle(process);
}

// Bounded so a long-running session with repeated failures can't leak; it only
// needs to dedupe error toasts for recent prompts.
const NOTIFIED_FAILED_CAP = 200;
const notifiedFailedHistoryPromptIds = new Set<string>();
const markedHiddenOutputIds = new Set<string>();
const pendingHiddenOutputIds = new Set<string>();
// Keys whose write was given up on. Kept separately from the marked set: these
// were never persisted, so they must not be reported as hidden — they only need
// to stop being retried for the rest of the session.
const abandonedHiddenOutputIds = new Set<string>();
const MARKED_HIDDEN_OUTPUT_CAP = 1000;
const HIDDEN_OUTPUT_RETRY_DELAYS_MS = [100, 250, 500, 1000, 2000, 4000, 8000] as const;
// ≈10 minutes at the capped delay — generous for slow/remote storage, but a
// write that still fails by then (e.g. the file was deleted out-of-band) will
// never succeed, and retrying it for the rest of the session is pure waste.
const MAX_HIDDEN_OUTPUT_PERSIST_ATTEMPTS = 75;

function markFailedNotified(promptId: string): void {
  notifiedFailedHistoryPromptIds.add(promptId);
  // Sets preserve insertion order, so the first entry is the oldest to evict.
  while (notifiedFailedHistoryPromptIds.size > NOTIFIED_FAILED_CAP) {
    const oldest = notifiedFailedHistoryPromptIds.values().next().value;
    if (oldest === undefined) break;
    notifiedFailedHistoryPromptIds.delete(oldest);
  }
}

function persistHiddenOutput(key: string, path: string, attempt = 0): void {
  if (markedHiddenOutputIds.has(key) || abandonedHiddenOutputIds.has(key)) {
    pendingHiddenOutputIds.delete(key);
    return;
  }
  pendingHiddenOutputIds.add(key);
  void api.setFileState('output', path, 'hidden', true)
    .then(() => {
      pendingHiddenOutputIds.delete(key);
      markedHiddenOutputIds.add(key);
      while (markedHiddenOutputIds.size > MARKED_HIDDEN_OUTPUT_CAP) {
        const oldest = markedHiddenOutputIds.values().next().value;
        if (oldest === undefined) break;
        markedHiddenOutputIds.delete(oldest);
      }
      useOutputsStore.getState().markItemHiddenLocally(key);
    })
    .catch((error) => {
      // File creation can lag history substantially on slow disks or remote
      // storage. After the fast retry window, keep retrying at the capped delay
      // instead of dropping the pending marker at the first hiccup — but give
      // up eventually so a permanently failing write doesn't poll all session.
      if (attempt + 1 >= MAX_HIDDEN_OUTPUT_PERSIST_ATTEMPTS) {
        pendingHiddenOutputIds.delete(key);
        // Record the give-up. Dropping only the pending marker makes the
        // caller's dedupe guard false again, so the next history rebuild starts
        // the whole chain over at attempt 0 — the all-session polling this cap
        // exists to stop.
        abandonedHiddenOutputIds.add(key);
        while (abandonedHiddenOutputIds.size > MARKED_HIDDEN_OUTPUT_CAP) {
          const oldest = abandonedHiddenOutputIds.values().next().value;
          if (oldest === undefined) break;
          abandonedHiddenOutputIds.delete(oldest);
        }
        console.warn('Failed to hide output from hidden workflow after retries:', error);
        return;
      }
      const delay = HIDDEN_OUTPUT_RETRY_DELAYS_MS[
        Math.min(attempt, HIDDEN_OUTPUT_RETRY_DELAYS_MS.length - 1)
      ];
      if (attempt === HIDDEN_OUTPUT_RETRY_DELAYS_MS.length) {
        console.warn('Still waiting to hide output from hidden workflow; retries will continue:', error);
      }
      window.setTimeout(() => persistHiddenOutput(key, path, attempt + 1), delay);
    });
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: [],
  isLoading: false,
  historyLimit: INITIAL_HISTORY_PAGE_SIZE,
  hasMoreHistory: true,
  historyTotal: null,

  addHistoryEntry: (entry) => {
    set((state) => {
      // Check if exists
      if (state.history.some(h => h.prompt_id === entry.prompt_id)) {
        return state;
      }
      // Add to top
      return { history: [entry, ...state.history] };
    });
    const queueStore = useQueueStore.getState();
    if (queueStore.queueItemExpanded[entry.prompt_id] === undefined) {
      queueStore.setQueueItemExpanded(entry.prompt_id, true);
    }
    if (entry.workflow && entry.durationSeconds) {
      const signature = getWorkflowSignature(entry.workflow);
      useWorkflowStore.getState().updateWorkflowDuration(signature, entry.durationSeconds * 1000);
    }
  },

  fetchHistory: async (maxItems) => {
    // No explicit size → refresh the current loaded window (so background polls
    // and post-run refreshes don't shrink what the user already scrolled to).
    const limit = maxItems ?? get().historyLimit;
    const active = historyFetchInFlight;
    if (active) {
      const success = await active.promise;
      if (active.limit >= limit) return success;
      // The requested window is larger. Run it only after the smaller active
      // response settles, using fetchHistory again so a newer caller can share it.
      return get().fetchHistory(limit);
    }

    const run = get()._runFetchHistory(limit);
    const record = { limit, promise: run };
    historyFetchInFlight = record;
    try {
      return await run;
    } finally {
      if (historyFetchInFlight === record) historyFetchInFlight = null;
    }
  },

  loadMoreHistory: async () => {
    const { historyLimit, hasMoreHistory, isLoading } = get();
    if (!hasMoreHistory || isLoading) return;
    await get().fetchHistory(historyLimit + HISTORY_PAGE_SIZE);
  },

  _runFetchHistory: async (maxItems: number) => {
    set({ isLoading: true });
    try {
      const queuePromptIds = new Set(
        [
          ...useQueueStore.getState().running,
          ...useQueueStore.getState().pending,
        ].map((item) => item.prompt_id),
      );
      const data = await api.getHistory(maxItems);

      // Track the loaded window and whether older items remain. The endpoint
      // returns the newest min(total, maxItems); fewer than requested ⇒ no more.
      const rawCount = Object.keys(data).length;
      set({ historyLimit: maxItems, hasMoreHistory: rawCount >= maxItems });

      // Refresh the real total run count (cheap len-only endpoint) so the header
      // can show it rather than just the loaded page count. Fire-and-forget; a
      // missing endpoint resolves to null and the UI falls back to loaded count.
      void Promise.resolve(api.getHistoryCount?.()).then((count) => {
        if (count != null) set({ historyTotal: count });
      });

      // Skip the heavy rebuild when this page's payload is byte-for-byte
      // equivalent to the last one we processed (the common case for the 2s
      // poll between completions). First appearance of any prompt flips the
      // signature, so completion side-effects still fire exactly once.
      const rawSignature = rawHistorySignature(data);
      if (
        lastRawHistorySignature?.limit === maxItems &&
        lastRawHistorySignature.value === rawSignature &&
        get().history.length > 0
      ) {
        return true;
      }
      lastRawHistorySignature = { limit: maxItems, value: rawSignature };

      const asText = (value: unknown): string | null => {
        if (typeof value === "string") {
          const trimmed = value.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
          return value.toString();
        }
        return null;
      };
      const getExecutionErrorMessage = (msgData: Record<string, unknown>): string | null => {
        const direct = asText(msgData.exception_message) ??
          asText(msgData.error) ??
          asText(msgData.message) ??
          asText(msgData.exception_type);
        if (direct) return direct;
        const details = asText((msgData as { details?: unknown }).details);
        if (details) return details;
        const traceback = asText(msgData.traceback);
        const node = asText(msgData.node_id) || asText(msgData.node);
        if (traceback && node) return `${node}: ${traceback}`;
        if (traceback) return traceback;
        if (node) return `${node}: execution error`;
        return null;
      };

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
        let interrupted = false;
        let errorMessage: string | null = null;
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
              if (typeof msgData === 'object' && msgData !== null && !Array.isArray(msgData)) {
                const nextError = getExecutionErrorMessage(msgData as Record<string, unknown>);
                if (nextError) errorMessage = nextError;
              } else {
                const nextError = asText(msgData as unknown);
                if (nextError) errorMessage = nextError;
              }
            }
            if (msgType === 'execution_interrupted') {
              interrupted = true;
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
        const success =
          !failed &&
          !interrupted &&
          item.status?.completed !== false &&
          !statusStr.includes('error');
        if (!success && !errorMessage) {
          const displayStatus = interrupted
            ? 'interrupted'
            : item.status?.status_str?.trim();
          errorMessage = displayStatus
            ? `Execution did not complete (${displayStatus}). Some outputs may be missing.`
            : 'Execution did not complete. Some outputs may be missing.';
        }
        const workflow = (item.prompt?.[3] as { extra_pnginfo?: { workflow?: Workflow } } | undefined)?.extra_pnginfo?.workflow;
        const extraData = (item.prompt?.[3] ?? {}) as Record<string, unknown>;
        const hidden = extraData[HIDDEN_WORKFLOW_EXTRA_DATA_KEY] === true;

        return {
          prompt_id,
          timestamp,
          durationSeconds,
          success,
          interrupted,
          errorMessage,
          outputs: { images },
          prompt: item.prompt[2] as Record<string, unknown>,
          workflow,
          hidden,
          queueRequest: {
            prompt: item.prompt[2] as Record<string, unknown>,
            extra_data: extraData,
          },
          outputsToExecute: item.prompt[4],
        };
      });

      // Sort by timestamp, newest first
      entries.sort((a, b) => b.timestamp - a.timestamp);

      // Only replace the array (new object identities → re-renders every memoized
      // queue card) when the content actually changed. The derived side-effects
      // below still run on `entries`, but they're idempotent first-appearance work
      // so re-running them while history is unchanged is harmless. Completed
      // entries are stable, so a poll mid-run won't churn the list.
      if (historySignature(entries) !== historySignature(get().history)) {
        set({ history: entries });
      }
      const queueStore = useQueueStore.getState();
      const durationUpdates: DeferredDurationStat[] = [];
      for (const entry of entries) {
        if (entry.hidden) {
          for (const output of entry.outputs.images) {
            if (output.type !== 'output') continue;
            const path = output.subfolder
              ? `${output.subfolder}/${output.filename}`
              : output.filename;
            const key = `output/${path}`;
            if (markedHiddenOutputIds.has(key) || pendingHiddenOutputIds.has(key)) continue;
            persistHiddenOutput(key, path);
          }
        }
        queueStore.markPromptCompleted(entry.prompt_id);
        // Only surface a failure toast for a prompt the user is actively
        // tracking in the queue (running/pending) — never for past history items.
        // Re-fetching history (e.g. the two-phase initial load, or a websocket
        // refresh) must not resurface an old item's error and mislead the user
        // into thinking it relates to their current workflow. Real-time errors
        // for the current run still come through the websocket execution_error
        // handler.
        if (
          entry.success === false &&
          !entry.interrupted &&
          !notifiedFailedHistoryPromptIds.has(entry.prompt_id) &&
          queuePromptIds.has(entry.prompt_id)
        ) {
          markFailedNotified(entry.prompt_id);
          useWorkflowErrorsStore
            .getState()
            .setError(entry.errorMessage || 'Execution did not complete. Some outputs may be missing.');
        }
        if (queueStore.queueItemExpanded[entry.prompt_id] === undefined) {
          queueStore.setQueueItemExpanded(entry.prompt_id, true);
        }
        if (entry.workflow && entry.durationSeconds) {
          durationUpdates.push({ workflow: entry.workflow, durationMs: entry.durationSeconds * 1000 });
        }
      }
      scheduleDurationStatUpdates(durationUpdates);
      return true;
    } catch (err) {
      console.error('Failed to fetch history:', err);
      return false;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteItem: async (promptId) => {
    try {
      await api.deleteHistoryItem(promptId);
      const removed = get().history.find((item) => item.prompt_id === promptId);
      bustHistoryEntryImages(removed);
      set((state) => ({
        history: state.history.filter((item) => item.prompt_id !== promptId),
        historyTotal: state.historyTotal != null ? Math.max(0, state.historyTotal - 1) : null,
      }));
    } catch (err) {
      console.error('Failed to delete history item:', err);
    }
  },

  removeOutputImages: async (fileIds) => {
    if (fileIds.length === 0) return;
    const deleted = new Set(fileIds);
    const history = get().history;

    // First pass over the snapshot: bust the caches of the removed images and
    // collect the prompt_ids of entries that lose their last image (so they can
    // be deleted server-side). The actual store mutation happens below against
    // the latest state.
    const emptiedPromptIds: string[] = [];
    let changed = false;

    for (const entry of history) {
      let removedHere = 0;
      for (const img of entry.outputs.images) {
        if (deleted.has(getHistoryImageFileId(img))) {
          removedHere += 1;
          bustImageCache(img.filename, img.subfolder, img.type);
        }
      }
      if (removedHere === 0) continue;
      changed = true;
      // Remove the queue item only when it HAD a saved output (type 'output')
      // and that was the last one — i.e. its real outputs were just deleted,
      // leaving at most preview frames (type 'temp') behind. Without this,
      // rejecting+deleting the one real output of a PreviewImage+SaveImage run
      // left the card lingering showing just its previews.
      //
      // Deliberately scoped to entries that HAD a saved output: a preview-only
      // run (no 'output' images ever) is never auto-removed here, even if all of
      // its preview frames are gone — we don't delete queue items that never
      // produced an output.
      const hadSavedOutput = entry.outputs.images.some((img) => img.type === 'output');
      const savedOutputRemains = entry.outputs.images.some(
        (img) => img.type === 'output' && !deleted.has(getHistoryImageFileId(img)),
      );
      if (hadSavedOutput && !savedOutputRemains) {
        emptiedPromptIds.push(entry.prompt_id);
      }
    }

    if (!changed) return;

    // Delete the now-empty entries server-side too, so they don't reappear on
    // the next history fetch. Best-effort: even if the API call fails we still
    // drop them locally (they're broken cards either way).
    if (emptiedPromptIds.length > 0) {
      try {
        await api.deleteHistoryItems(emptiedPromptIds);
      } catch (err) {
        console.error('Failed to delete emptied history items:', err);
      }
    }

    // Re-derive from the latest state rather than reusing the pre-await snapshot,
    // so an entry a poll added during the await isn't clobbered.
    const emptied = new Set(emptiedPromptIds);
    set((state) => {
      let removedCount = 0;
      const filtered: HistoryEntry[] = [];
      for (const entry of state.history) {
        if (emptied.has(entry.prompt_id)) {
          removedCount += 1;
          continue;
        }
        const surviving = entry.outputs.images.filter(
          (img) => !deleted.has(getHistoryImageFileId(img)),
        );
        filtered.push(
          surviving.length === entry.outputs.images.length
            ? entry
            : { ...entry, outputs: { ...entry.outputs, images: surviving } },
        );
      }
      return {
        history: filtered,
        historyTotal:
          state.historyTotal != null
            ? Math.max(0, state.historyTotal - removedCount)
            : null,
      };
    });
  },

  clearHistory: async () => {
    get().history.forEach(bustHistoryEntryImages);
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
      set({ history: [], historyTotal: 0 });
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
        history: state.history.filter((item) => !promptIds.includes(item.prompt_id)),
        historyTotal: state.historyTotal != null
          ? Math.max(0, state.historyTotal - promptIds.length)
          : null,
      }));
    } catch (err) {
      console.error('Failed to delete empty history items:', err);
    }
  }
}));

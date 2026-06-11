import type { StateCreator } from 'zustand';
import * as api from '@/api/client';
import type { QueueState, ShadowQueueJob } from '../useQueue';
import { capWorkflowDiffs } from './queueHelpers';

/**
 * Shadow-queue recovery: tracks queued prompts as "shadow jobs" so that, after a
 * server restart drops in-flight work, the lost jobs can be detected and
 * re-submitted. Owns the workflow-diff map (prompt-preview source) too, since it
 * carries diffs across a restored prompt's old→new id.
 */
export type QueueRecoverySlice = Pick<
  QueueState,
  | 'workflowDiffs'
  | 'shadowQueueJobs'
  | 'recoverableJobIds'
  | 'autoRestoredPromptIds'
  | 'isRestoringLostJobs'
  | 'recordWorkflowDiff'
  | 'recordQueuedPrompt'
  | 'markPromptCompleted'
  | 'detectRecoverableJobs'
  | 'clearRecoverableJobs'
  | 'restoreLostJobs'
>;

export const createQueueRecoverySlice: StateCreator<
  QueueState,
  [['zustand/persist', unknown]],
  [],
  QueueRecoverySlice
> = (set, get) => ({
  workflowDiffs: {},
  shadowQueueJobs: {},
  recoverableJobIds: [],
  autoRestoredPromptIds: {},
  isRestoringLostJobs: false,

  recordWorkflowDiff: (promptId, diff) => {
    if (!promptId) return;
    set((state) => {
      // Delete-then-set so updating an existing prompt re-inserts it at the end
      // of enumeration order; capWorkflowDiffs trims the oldest-inserted, and we
      // must not let a frequently-updated prompt be treated as "old".
      const next = { ...state.workflowDiffs };
      delete next[promptId];
      next[promptId] = diff;
      return { workflowDiffs: capWorkflowDiffs(next) };
    });
  },

  recordQueuedPrompt: (promptId, request, options) => {
    if (!promptId) return;
    set((state) => ({
      shadowQueueJobs: {
        ...state.shadowQueueJobs,
        [promptId]: {
          originalPromptId: promptId,
          prompt: request.prompt,
          extraData: request.extra_data,
          outputsToExecute: options?.outputsToExecute ?? [],
          number: options?.number ?? 0,
          status: 'pending',
          queuedAt: Date.now(),
          sessionId: options?.sessionId,
        },
      },
      recoverableJobIds: state.recoverableJobIds.filter((id) => id !== promptId),
    }));
  },

  markPromptCompleted: (promptId) => {
    if (!promptId) return;
    set((state) => {
      // fetchHistory calls this for EVERY history entry. Skip the work (and
      // the spurious store update from cloning maps into new refs) when this
      // prompt has nothing to clean up.
      const present =
        promptId in state.shadowQueueJobs ||
        promptId in state.livePromptOutputs ||
        promptId in state.localPromptOrder ||
        promptId in state.completionDurations ||
        promptId in state.completingStartedAt ||
        state.completing.some((item) => item.prompt_id === promptId) ||
        state.recoverableJobIds.includes(promptId);
      if (!present) return {};
      const shadowQueueJobs = { ...state.shadowQueueJobs };
      const livePromptOutputs = { ...state.livePromptOutputs };
      const localPromptOrder = { ...state.localPromptOrder };
      const completionDurations = { ...state.completionDurations };
      const completingStartedAt = { ...state.completingStartedAt };
      delete shadowQueueJobs[promptId];
      delete livePromptOutputs[promptId];
      delete localPromptOrder[promptId];
      delete completionDurations[promptId];
      delete completingStartedAt[promptId];
      return {
        shadowQueueJobs,
        livePromptOutputs,
        localPromptOrder,
        completionDurations,
        completingStartedAt,
        completing: state.completing.filter((item) => item.prompt_id !== promptId),
        recoverableJobIds: state.recoverableJobIds.filter((id) => id !== promptId),
      };
    });
  },

  detectRecoverableJobs: (completedPromptIds = []) => {
    const state = get();
    const backendPromptIds = new Set([
      ...state.running.map((item) => item.prompt_id),
      ...state.pending.map((item) => item.prompt_id),
    ]);
    const completed = new Set(completedPromptIds);
    const recoverableJobIds = Object.values(state.shadowQueueJobs)
      // Both queued ('pending') and in-flight ('running') jobs are
      // recoverable: a restart that kills the active generation leaves its
      // shadow job 'running' but absent from the backend, so re-queuing the
      // identical prompt restarts the interrupted run from scratch. A job
      // that's genuinely still running survives in `backendPromptIds` below
      // and is excluded, so we never double-submit a live job.
      .filter((job) => (
        (job.status === 'pending' || job.status === 'running') &&
        !backendPromptIds.has(job.originalPromptId) &&
        !completed.has(job.originalPromptId)
      ))
      .sort((a, b) => a.number - b.number || a.queuedAt - b.queuedAt)
      .map((job) => job.originalPromptId);
    set({ recoverableJobIds });
    return recoverableJobIds;
  },

  clearRecoverableJobs: () => {
    set({ recoverableJobIds: [] });
  },

  restoreLostJobs: async (options) => {
    const { auto = false, onRestored } = options ?? {};
    const state = get();
    const jobs = state.recoverableJobIds
      .map((id) => state.shadowQueueJobs[id])
      .filter((job): job is ShadowQueueJob => Boolean(job));
    if (jobs.length === 0) return;

    set({ isRestoringLostJobs: true });
    try {
      for (const job of jobs) {
        const response = await api.queuePrompt({
          prompt: job.prompt,
          client_id: api.clientId,
          extra_data: job.extraData,
        });
        const newPromptId = response.prompt_id;
        if (!newPromptId) continue;
        await api.remapQueuePromptMetadata(job.originalPromptId, newPromptId).catch((err) => {
          console.warn('Failed to remap mobile queue metadata:', err);
        });
        onRestored?.({ oldPromptId: job.originalPromptId, newPromptId, job });
        get().registerLocalPrompt(newPromptId);
        set((current) => {
          const shadowQueueJobs = { ...current.shadowQueueJobs };
          delete shadowQueueJobs[job.originalPromptId];
          shadowQueueJobs[newPromptId] = {
            ...job,
            originalPromptId: newPromptId,
            number: response.number ?? job.number,
            status: 'pending',
            queuedAt: Date.now(),
          };
          // The restored job re-enqueues the identical workflow, so its
          // diff/prompt-preview is still valid — carry it to the new id.
          const workflowDiffs = { ...current.workflowDiffs };
          const queueMetadata = { ...current.queueMetadata };
          const carriedDiff = workflowDiffs[job.originalPromptId];
          if (carriedDiff) {
            delete workflowDiffs[job.originalPromptId];
            workflowDiffs[newPromptId] = carriedDiff;
          }
          const carriedMetadata = queueMetadata[job.originalPromptId];
          if (carriedMetadata) {
            delete queueMetadata[job.originalPromptId];
            queueMetadata[newPromptId] = {
              ...carriedMetadata,
              promptId: newPromptId,
            };
          }
          return {
            shadowQueueJobs,
            workflowDiffs,
            queueMetadata,
            autoRestoredPromptIds: auto
              ? {
                  ...current.autoRestoredPromptIds,
                  [newPromptId]: job.originalPromptId,
                }
              : current.autoRestoredPromptIds,
            recoverableJobIds: current.recoverableJobIds.filter((id) => id !== job.originalPromptId),
          };
        });
      }
      await get().fetchQueue();
    } catch (err) {
      console.error('Failed to restore lost queue jobs:', err);
      throw err;
    } finally {
      set({ isRestoringLostJobs: false });
    }
  },
});

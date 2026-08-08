import type { QueueWorkflowDiff } from '@/utils/workflowDiff';
import type { QueueItem, ShadowQueueJob } from '../useQueue';

// Bound the persisted diff map so it can't grow without limit. Prompt ids are
// UUIDs (non-integer keys), so Object.keys preserves insertion order.
const WORKFLOW_DIFF_CAP = 300;

/**
 * Write `key` as the most-recently-touched entry, dropping the oldest once the
 * map exceeds `cap`.
 *
 * Shared by every persisted per-prompt map, because getting it wrong is subtle
 * in the same way each time: a plain spread leaves an existing key in its
 * original slot, so re-writing one would not protect it and the entry a user
 * keeps touching would be the first evicted. Deleting before reinserting makes
 * enumeration order genuine write-recency.
 */
export function touchBoundedMap<T>(
  map: Record<string, T>,
  key: string,
  value: T,
  cap: number,
): Record<string, T> {
  const next = { ...map };
  delete next[key];
  next[key] = value;
  const keys = Object.keys(next);
  if (keys.length <= cap) return next;
  for (const stale of keys.slice(0, keys.length - cap)) delete next[stale];
  return next;
}

export function capWorkflowDiffs(
  diffs: Record<string, QueueWorkflowDiff>,
): Record<string, QueueWorkflowDiff> {
  const keys = Object.keys(diffs);
  if (keys.length <= WORKFLOW_DIFF_CAP) return diffs;
  const trimmed: Record<string, QueueWorkflowDiff> = {};
  for (const key of keys.slice(keys.length - WORKFLOW_DIFF_CAP)) trimmed[key] = diffs[key];
  return trimmed;
}

export { WORKFLOW_DIFF_CAP };

export function makeShadowJobFromQueueItem(
  item: QueueItem,
  status: ShadowQueueJob['status'],
): ShadowQueueJob {
  return {
    originalPromptId: item.prompt_id,
    prompt: item.prompt,
    extraData: item.extra,
    outputsToExecute: item.outputs_to_execute,
    number: item.number,
    status,
    queuedAt: Date.now(),
  };
}

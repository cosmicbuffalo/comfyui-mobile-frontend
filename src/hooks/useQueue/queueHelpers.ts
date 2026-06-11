import type { QueueWorkflowDiff } from '@/utils/workflowDiff';
import type { QueueItem, ShadowQueueJob } from '../useQueue';

// Bound the persisted diff map so it can't grow without limit. Prompt ids are
// UUIDs (non-integer keys), so Object.keys preserves insertion order.
const WORKFLOW_DIFF_CAP = 300;

export function capWorkflowDiffs(
  diffs: Record<string, QueueWorkflowDiff>,
): Record<string, QueueWorkflowDiff> {
  const keys = Object.keys(diffs);
  if (keys.length <= WORKFLOW_DIFF_CAP) return diffs;
  const trimmed: Record<string, QueueWorkflowDiff> = {};
  for (const key of keys.slice(keys.length - WORKFLOW_DIFF_CAP)) trimmed[key] = diffs[key];
  return trimmed;
}

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

import type { WorkflowSource } from '@/hooks/useWorkflow';
import {
  isHiddenWorkflowPath,
  isManuallyHiddenWorkflowPath,
} from '@/components/AppMenu/userWorkflowHelpers';

export const HIDDEN_WORKFLOW_EXTRA_DATA_KEY = 'mobile_hidden_workflow';

let currentHiddenWorkflowPaths: readonly string[] = [];

export function setCurrentHiddenWorkflowPaths(paths: readonly string[]): void {
  currentHiddenWorkflowPaths = paths;
}

export function isWorkflowSourceHidden(
  source: WorkflowSource | null | undefined,
  hiddenWorkflowPaths: Iterable<string> = currentHiddenWorkflowPaths,
): boolean {
  if (!source) return false;
  if (source.hidden) return true;
  if (source.type !== 'user') return false;
  return isHiddenWorkflowPath(source.filename)
    || isManuallyHiddenWorkflowPath(source.filename, hiddenWorkflowPaths);
}

/**
 * Whether the currently-open workflow should be treated as hidden. Falls back to
 * the open workflow's `filename` (the path relative to the workflows dir) when
 * the `source` isn't a recognized user file — e.g. a workflow that was already
 * open before it was hidden, or opened via a route that didn't stamp a
 * `type: 'user'` source. Without this, hiding such a workflow wouldn't show the
 * top-bar icon, tag its outputs hidden, or mark its queue items.
 */
export function isWorkflowHidden(
  source: WorkflowSource | null | undefined,
  filename: string | null | undefined,
  hiddenWorkflowPaths: Iterable<string> = currentHiddenWorkflowPaths,
): boolean {
  if (isWorkflowSourceHidden(source, hiddenWorkflowPaths)) return true;
  if (!filename) return false;
  return isHiddenWorkflowPath(filename)
    || isManuallyHiddenWorkflowPath(filename, hiddenWorkflowPaths);
}

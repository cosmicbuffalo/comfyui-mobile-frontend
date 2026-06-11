import { useMemo } from 'react';
import { useHistoryStore } from './useHistory';
import type { HistoryEntry } from './useHistory';
import type { ViewerImage } from '@/utils/viewerImages';

type HistoryWorkflowEntry = {
  // Absent for runs whose history entry has no embedded workflow. promptId is
  // always present, so callers can still associate a file with its run (e.g. to
  // delete the run's queue card) even when no workflow is available to load.
  workflow?: NonNullable<ViewerImage['workflow']>;
  promptId: string;
  hidden?: boolean;
};

export function buildHistoryWorkflowByFileIdMap(
  history: HistoryEntry[],
): Map<string, HistoryWorkflowEntry> {
  const map = new Map<string, HistoryWorkflowEntry>();
  for (const entry of history) {
    for (const output of entry.outputs.images ?? []) {
      const path = output.subfolder
        ? `${output.subfolder}/${output.filename}`
        : output.filename;
      const key = `${output.type}/${path}`;
      // Keep first-seen value; history is newest-first and should win for duplicate paths.
      if (map.has(key)) continue;
      map.set(key, {
        workflow: entry.workflow,
        promptId: entry.prompt_id,
        hidden: entry.hidden,
      });
    }
  }
  return map;
}

export function useHistoryWorkflowByFileId(): Map<string, HistoryWorkflowEntry> {
  const history = useHistoryStore((s) => s.history);
  return useMemo(() => buildHistoryWorkflowByFileIdMap(history), [history]);
}

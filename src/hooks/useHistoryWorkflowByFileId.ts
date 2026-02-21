import { useMemo } from 'react';
import { useHistoryStore } from './useHistory';
import type { HistoryEntry } from './useHistory';
import type { ViewerImage } from '@/utils/viewerImages';

type HistoryWorkflowEntry = {
  workflow: NonNullable<ViewerImage['workflow']>;
  promptId: string;
};

export function buildHistoryWorkflowByFileIdMap(
  history: HistoryEntry[],
): Map<string, HistoryWorkflowEntry> {
  const map = new Map<string, HistoryWorkflowEntry>();
  for (const entry of history) {
    if (!entry.workflow) continue;
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
      });
    }
  }
  return map;
}

export function useHistoryWorkflowByFileId(): Map<string, HistoryWorkflowEntry> {
  const history = useHistoryStore((s) => s.history);
  return useMemo(() => buildHistoryWorkflowByFileIdMap(history), [history]);
}

import { describe, expect, it } from 'vitest';
import type { Workflow } from '@/api/types';
import type { HistoryEntry } from '@/hooks/useHistory';
import { buildHistoryWorkflowByFileIdMap } from '@/hooks/useHistoryWorkflowByFileId';

function makeWorkflow(label: string): Workflow {
  return {
    last_node_id: 0,
    last_link_id: 0,
    nodes: [],
    links: [],
    groups: [],
    config: { label },
    version: 1,
  };
}

function makeEntry(params: {
  promptId: string;
  workflow?: Workflow;
  images: Array<{ filename: string; subfolder: string; type: string }>;
}): HistoryEntry {
  return {
    prompt_id: params.promptId,
    timestamp: 0,
    outputs: { images: params.images },
    prompt: {},
    workflow: params.workflow,
  };
}

describe('buildHistoryWorkflowByFileIdMap', () => {
  it('keeps first-seen history item for duplicate file IDs', () => {
    const newestWorkflow = makeWorkflow('newest');
    const olderWorkflow = makeWorkflow('older');
    const history: HistoryEntry[] = [
      makeEntry({
        promptId: 'prompt-new',
        workflow: newestWorkflow,
        images: [{ filename: 'img.png', subfolder: 'a', type: 'output' }],
      }),
      makeEntry({
        promptId: 'prompt-old',
        workflow: olderWorkflow,
        images: [{ filename: 'img.png', subfolder: 'a', type: 'output' }],
      }),
    ];

    const map = buildHistoryWorkflowByFileIdMap(history);
    const entry = map.get('output/a/img.png');
    expect(entry?.promptId).toBe('prompt-new');
    expect(entry?.workflow).toBe(newestWorkflow);
  });

  it('skips history entries with no workflow', () => {
    const history: HistoryEntry[] = [
      makeEntry({
        promptId: 'prompt-no-workflow',
        images: [{ filename: 'img.png', subfolder: '', type: 'output' }],
      }),
    ];

    const map = buildHistoryWorkflowByFileIdMap(history);
    expect(map.size).toBe(0);
  });

  it('builds keys with source prefix and normalized subfolder path', () => {
    const workflow = makeWorkflow('w');
    const history: HistoryEntry[] = [
      makeEntry({
        promptId: 'prompt-1',
        workflow,
        images: [
          { filename: 'root.png', subfolder: '', type: 'output' },
          { filename: 'nested.png', subfolder: 'folder/sub', type: 'temp' },
        ],
      }),
    ];

    const map = buildHistoryWorkflowByFileIdMap(history);
    expect(map.has('output/root.png')).toBe(true);
    expect(map.has('temp/folder/sub/nested.png')).toBe(true);
  });
});

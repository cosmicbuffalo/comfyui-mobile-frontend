import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { History, HistoryItem } from '@/api/types';
import { useHistoryStore } from '@/hooks/useHistory';
import { useQueueStore } from '@/hooks/useQueue';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { getHistory, setFileState, deleteHistoryItems } from '@/api/client';
import { HIDDEN_WORKFLOW_EXTRA_DATA_KEY } from '@/utils/workflowHidden';

vi.mock('@/api/client', () => ({
  getHistory: vi.fn(),
  getHistoryCount: vi.fn().mockResolvedValue(null),
  deleteHistoryItem: vi.fn(),
  clearHistory: vi.fn(),
  deleteHistoryItems: vi.fn(),
  setFileState: vi.fn().mockResolvedValue(undefined),
}));

const mockGetHistory = vi.mocked(getHistory);
const mockSetFileState = vi.mocked(setFileState);

function makeHistoryItem(
  promptId: string,
  status: HistoryItem['status'],
): HistoryItem {
  return {
    prompt: [1, promptId, {}, {}, []],
    outputs: {
      '9': {
        videos: [
          {
            filename: `${promptId}.mp4`,
            subfolder: '',
            type: 'output',
          },
        ],
      },
    },
    status,
  };
}

beforeEach(() => {
  mockGetHistory.mockReset();
  mockSetFileState.mockClear();
  vi.mocked(deleteHistoryItems).mockClear();
  useHistoryStore.setState({
    history: [],
    isLoading: false,
  });
  useQueueStore.setState({
    running: [],
    pending: [],
    completing: [],
    isLoading: false,
    lastExecutedId: null,
    localPromptOrder: {},
    nextLocalPromptOrder: 1,
    livePromptOutputs: {},
    queueItemExpanded: {},
    queueItemUserToggled: {},
    queueItemHideImages: {},
    showQueueMetadata: false,
    previewVisibility: {},
    previewVisibilityDefault: false,
  });
  useWorkflowErrorsStore.setState({
    error: null,
    nodeErrors: {},
    errorCycleIndex: 0,
    errorsDismissed: false,
  });
});

describe('useHistoryStore', () => {
  it('reports a failed fetch so the queue panel can retry it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetHistory.mockRejectedValueOnce(new TypeError('Load failed'));

    await expect(useHistoryStore.getState().fetchHistory(10)).resolves.toBe(false);
    expect(useHistoryStore.getState().history).toEqual([]);
    expect(useHistoryStore.getState().isLoading).toBe(false);
    errorSpy.mockRestore();
  });

  it('serializes different history window sizes instead of racing them', async () => {
    let resolveFirst!: (history: History) => void;
    mockGetHistory
      .mockImplementationOnce(() => new Promise<History>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce({});

    const first = useHistoryStore.getState().fetchHistory(10);
    const larger = useHistoryStore.getState().fetchHistory(20);
    expect(mockGetHistory).toHaveBeenCalledTimes(1);
    expect(mockGetHistory).toHaveBeenNthCalledWith(1, 10);

    resolveFirst({});
    await expect(first).resolves.toBe(true);
    await expect(larger).resolves.toBe(true);
    expect(mockGetHistory).toHaveBeenCalledTimes(2);
    expect(mockGetHistory).toHaveBeenNthCalledWith(2, 20);
  });

  it('warns when an observed prompt lands in history as incomplete without an execution error', async () => {
    const promptId = 'observed-incomplete-prompt';
    useQueueStore.setState({
      running: [
        {
          number: 1,
          prompt_id: promptId,
          prompt: {},
          extra: {},
          outputs_to_execute: [],
        },
      ],
    });
    mockGetHistory.mockResolvedValue({
      [promptId]: makeHistoryItem(promptId, {
        status_str: 'interrupted',
        completed: false,
        messages: [
          ['execution_start', { timestamp: 1000 }],
          ['execution_end', { timestamp: 2500 }],
        ],
      }),
    } satisfies History);

    await useHistoryStore.getState().fetchHistory();

    const [entry] = useHistoryStore.getState().history;
    expect(entry).toMatchObject({
      prompt_id: promptId,
      success: false,
      errorMessage: 'Execution did not complete (interrupted). Some outputs may be missing.',
      durationSeconds: 1.5,
    });
    expect(entry.outputs.images).toEqual([
      {
        filename: `${promptId}.mp4`,
        subfolder: '',
        type: 'output',
      },
    ]);
    expect(useWorkflowErrorsStore.getState().error).toBe(
      'Execution did not complete (interrupted). Some outputs may be missing.',
    );
  });

  it('skips the heavy rebuild when a repeat poll returns an unchanged payload', async () => {
    const item = makeHistoryItem('p1', { status_str: 'success', completed: true, messages: [] });
    mockGetHistory.mockResolvedValue({ p1: item } satisfies History);
    const markSpy = vi.spyOn(useQueueStore.getState(), 'markPromptCompleted');

    await useHistoryStore.getState().fetchHistory();
    expect(useHistoryStore.getState().history).toHaveLength(1);
    const callsAfterFirst = markSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Identical payload on the next ~2s poll → no per-entry reprocessing.
    await useHistoryStore.getState().fetchHistory();
    expect(markSpy.mock.calls.length).toBe(callsAfterFirst);

    // A genuinely changed payload (another run finished) is processed again.
    mockGetHistory.mockResolvedValue({
      p1: item,
      p2: makeHistoryItem('p2', { status_str: 'success', completed: true, messages: [] }),
    } satisfies History);
    await useHistoryStore.getState().fetchHistory();
    expect(useHistoryStore.getState().history).toHaveLength(2);
    expect(markSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);

    markSpy.mockRestore();
  });

  it('retains the backend prompt payload for exact re-enqueue', async () => {
    const promptId = 'stopped-prompt';
    const prompt = { '1': { class_type: 'Sampler', inputs: { seed: 42 } } };
    const extraData = { custom: 'preserved' };
    const item = makeHistoryItem(promptId, {
      status_str: 'interrupted',
      completed: false,
      messages: [],
    });
    item.prompt = [7, promptId, prompt, extraData, ['9']];
    mockGetHistory.mockResolvedValue({ [promptId]: item });

    await useHistoryStore.getState().fetchHistory();

    expect(useHistoryStore.getState().history[0]).toMatchObject({
      queueRequest: {
        prompt,
        extra_data: extraData,
      },
      outputsToExecute: ['9'],
    });
  });

  it('keeps the history array identity when a refetch returns identical content', async () => {
    // Freeze time: the entry timestamp falls back to Date.now() at parse time, so
    // without this two fetches of the same item would differ purely by timestamp.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      const item = makeHistoryItem('stable-1', { status_str: 'success', completed: true, messages: [] });
      mockGetHistory.mockResolvedValue({ 'stable-1': item });

      await useHistoryStore.getState().fetchHistory();
      const first = useHistoryStore.getState().history;
      expect(first).toHaveLength(1);

      // Same backend payload → unchanged content → the array identity is preserved,
      // so memoized queue cards don't re-render on every ~2s poll during a run.
      await useHistoryStore.getState().fetchHistory();
      expect(useHistoryStore.getState().history).toBe(first);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('replaces the history array when content actually changes', async () => {
    const item1 = makeHistoryItem('p1', { status_str: 'success', completed: true, messages: [] });
    mockGetHistory.mockResolvedValue({ p1: item1 });
    await useHistoryStore.getState().fetchHistory();
    const first = useHistoryStore.getState().history;

    const item2 = makeHistoryItem('p2', { status_str: 'success', completed: true, messages: [] });
    mockGetHistory.mockResolvedValue({ p1: item1, p2: item2 });
    await useHistoryStore.getState().fetchHistory();
    const second = useHistoryStore.getState().history;

    expect(second).not.toBe(first);
    expect(second).toHaveLength(2);
  });

  it('marks outputs from hidden workflows as hidden', async () => {
    const promptId = 'hidden-workflow-prompt';
    const item = makeHistoryItem(promptId, {
      status_str: 'success',
      completed: true,
      messages: [],
    });
    item.prompt[3] = { [HIDDEN_WORKFLOW_EXTRA_DATA_KEY]: true } as unknown as Record<string, string>;
    item.outputs['9'].videos![0].subfolder = 'private';
    mockGetHistory.mockResolvedValue({ [promptId]: item });

    await useHistoryStore.getState().fetchHistory();

    expect(useHistoryStore.getState().history[0].hidden).toBe(true);
    expect(mockSetFileState).toHaveBeenCalledWith(
      'output',
      `private/${promptId}.mp4`,
      'hidden',
      true,
    );
  });

  it('retries a hidden-output write when history arrives before the file is ready', async () => {
    vi.useFakeTimers();
    try {
      const promptId = 'hidden-workflow-file-race';
      const item = makeHistoryItem(promptId, {
        status_str: 'success',
        completed: true,
        messages: [],
      });
      item.prompt[3] = { [HIDDEN_WORKFLOW_EXTRA_DATA_KEY]: true } as unknown as Record<string, string>;
      mockGetHistory.mockResolvedValue({ [promptId]: item });
      mockSetFileState
        .mockRejectedValueOnce(new Error('File is not ready; retry'))
        .mockResolvedValueOnce(undefined);

      await useHistoryStore.getState().fetchHistory();
      await Promise.resolve();
      expect(mockSetFileState).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(100);
      expect(mockSetFileState).toHaveBeenCalledTimes(2);
      expect(mockSetFileState).toHaveBeenLastCalledWith(
        'output',
        `${promptId}.mp4`,
        'hidden',
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('continues retrying hidden-output writes after the fast retry window', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const promptId = 'hidden-workflow-long-file-race';
      const item = makeHistoryItem(promptId, {
        status_str: 'success',
        completed: true,
        messages: [],
      });
      item.prompt[3] = { [HIDDEN_WORKFLOW_EXTRA_DATA_KEY]: true } as unknown as Record<string, string>;
      mockGetHistory.mockResolvedValue({ [promptId]: item });
      for (let attempt = 0; attempt < 8; attempt += 1) {
        mockSetFileState.mockRejectedValueOnce(new Error('File is still flushing'));
      }
      mockSetFileState.mockResolvedValueOnce(undefined);

      await useHistoryStore.getState().fetchHistory();
      await Promise.resolve();
      for (const delay of [100, 250, 500, 1000, 2000, 4000, 8000, 8000]) {
        await vi.advanceTimersByTimeAsync(delay);
      }

      expect(mockSetFileState).toHaveBeenCalledTimes(9);
      expect(mockSetFileState).toHaveBeenLastCalledWith(
        'output',
        `${promptId}.mp4`,
        'hidden',
        true,
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('retries will continue'),
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('stops retrying a hidden-output write once it has given up', async () => {
    // Giving up used to drop only the pending marker, so the caller's dedupe
    // guard went false again and the next history rebuild restarted the chain
    // at attempt 0 — the all-session polling the attempt cap exists to stop.
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const promptId = 'hidden-workflow-permanently-failing';
      const item = makeHistoryItem(promptId, {
        status_str: 'success',
        completed: true,
        messages: [],
      });
      item.prompt[3] = { [HIDDEN_WORKFLOW_EXTRA_DATA_KEY]: true } as unknown as Record<string, string>;
      mockGetHistory.mockResolvedValue({ [promptId]: item });
      mockSetFileState.mockRejectedValue(new Error('File is not ready or changed while being read'));

      await useHistoryStore.getState().fetchHistory();
      await Promise.resolve();
      for (let tick = 0; tick < 80; tick += 1) {
        await vi.advanceTimersByTimeAsync(8000);
      }
      const afterGivingUp = mockSetFileState.mock.calls.length;

      // A later history rebuild must not start the whole chain over.
      useHistoryStore.setState({ history: [] });
      await useHistoryStore.getState().fetchHistory(100);
      await Promise.resolve();
      for (let tick = 0; tick < 10; tick += 1) {
        await vi.advanceTimersByTimeAsync(8000);
      }

      expect(afterGivingUp).toBe(75); // the cap, reached and stopped
      expect(mockSetFileState.mock.calls.length).toBe(afterGivingUp);
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not toast old incomplete history entries found on initial load', async () => {
    const promptId = 'old-incomplete-prompt';
    mockGetHistory.mockResolvedValue({
      [promptId]: makeHistoryItem(promptId, {
        status_str: 'interrupted',
        completed: false,
        messages: [
          ['execution_start', { timestamp: 1000 }],
          ['execution_end', { timestamp: 2500 }],
        ],
      }),
    } satisfies History);

    await useHistoryStore.getState().fetchHistory();

    expect(useHistoryStore.getState().history[0]).toMatchObject({
      prompt_id: promptId,
      success: false,
      errorMessage: 'Execution did not complete (interrupted). Some outputs may be missing.',
    });
    expect(useWorkflowErrorsStore.getState().error).toBeNull();
  });

  it('labels explicit interruptions without raising a prompt error toast', async () => {
    const promptId = 'interrupted-prompt';
    useQueueStore.setState({
      running: [
        {
          number: 1,
          prompt_id: promptId,
          prompt: {},
          extra: {},
          outputs_to_execute: [],
        },
      ],
    });
    mockGetHistory.mockResolvedValue({
      [promptId]: makeHistoryItem(promptId, {
        status_str: 'error',
        completed: false,
        messages: [
          ['execution_start', { timestamp: 1000 }],
          ['execution_interrupted', {
            prompt_id: promptId,
            node_id: '9',
            timestamp: 2500,
          }],
        ],
      }),
    } satisfies History);

    await useHistoryStore.getState().fetchHistory();

    expect(useHistoryStore.getState().history[0]).toMatchObject({
      prompt_id: promptId,
      success: false,
      interrupted: true,
      errorMessage: 'Execution did not complete (interrupted). Some outputs may be missing.',
    });
    expect(useWorkflowErrorsStore.getState().error).toBeNull();
  });

  it('keeps explicit execution error messages when ComfyUI provides them', async () => {
    const promptId = 'execution-error-prompt';
    useQueueStore.setState({
      pending: [
        {
          number: 2,
          prompt_id: promptId,
          prompt: {},
          extra: {},
          outputs_to_execute: [],
        },
      ],
    });
    mockGetHistory.mockResolvedValue({
      [promptId]: makeHistoryItem(promptId, {
        status_str: 'error',
        completed: false,
        messages: [
          ['execution_start', { timestamp: 1000 }],
          ['execution_error', { exception_message: 'Video combine failed' }],
        ],
      }),
    } satisfies History);

    await useHistoryStore.getState().fetchHistory();

    expect(useHistoryStore.getState().history[0]).toMatchObject({
      prompt_id: promptId,
      success: false,
      errorMessage: 'Video combine failed',
    });
    expect(useWorkflowErrorsStore.getState().error).toBe('Video combine failed');
  });

  it('does not resurface an old failed item across a two-phase / repeated fetch', async () => {
    // Regression: the two-phase initial load (small page then full backfill)
    // re-runs fetchHistory, so the second fetch sees the first page as prior
    // history. An old failed item NOT in the queue must stay silent on every
    // fetch, otherwise its error is misattributed to the current workflow.
    const promptId = 'old-errored-prompt';
    mockGetHistory.mockResolvedValue({
      [promptId]: makeHistoryItem(promptId, {
        status_str: 'error',
        completed: false,
        messages: [
          ['execution_start', { timestamp: 1000 }],
          ['execution_error', { exception_message: 'clip input is invalid: None' }],
        ],
      }),
    } satisfies History);

    // Phase 1 (small page) then phase 2 (backfill) — both see no queue entry.
    await useHistoryStore.getState().fetchHistory(5);
    await useHistoryStore.getState().fetchHistory();

    expect(useHistoryStore.getState().history[0]).toMatchObject({
      prompt_id: promptId,
      success: false,
      errorMessage: 'clip input is invalid: None',
    });
    expect(useWorkflowErrorsStore.getState().error).toBeNull();
  });

  describe('removeOutputImages', () => {
    const entry = (promptId: string, filenames: string[]) => ({
      prompt_id: promptId,
      timestamp: 1,
      outputs: {
        images: filenames.map((filename) => ({ filename, subfolder: '', type: 'output' })),
      },
      prompt: {},
    });

    // Build an entry with per-image types so we can mix saved outputs ('output')
    // and PreviewImage frames ('temp') in one queue item.
    const typedEntry = (
      promptId: string,
      imgs: Array<{ filename: string; type: string }>,
    ) => ({
      prompt_id: promptId,
      timestamp: 1,
      outputs: {
        images: imgs.map(({ filename, type }) => ({ filename, subfolder: '', type })),
      },
      prompt: {},
    });

    it('drops a single image from a batch entry without removing the card', async () => {
      useHistoryStore.setState({
        history: [entry('p1', ['a.png', 'b.png'])],
        historyTotal: 1,
      });

      await useHistoryStore.getState().removeOutputImages(['output/a.png']);

      const history = useHistoryStore.getState().history;
      expect(history).toHaveLength(1);
      expect(history[0].outputs.images.map((i) => i.filename)).toEqual(['b.png']);
      // The entry survives, so nothing is deleted server-side.
      expect(vi.mocked(deleteHistoryItems)).not.toHaveBeenCalled();
      expect(useHistoryStore.getState().historyTotal).toBe(1);
    });

    it('deletes the entry (and server-side history) once its last image is gone', async () => {
      useHistoryStore.setState({
        history: [entry('p1', ['a.png']), entry('p2', ['c.png'])],
        historyTotal: 2,
      });

      await useHistoryStore.getState().removeOutputImages(['output/a.png']);

      const history = useHistoryStore.getState().history;
      expect(history.map((h) => h.prompt_id)).toEqual(['p2']);
      expect(vi.mocked(deleteHistoryItems)).toHaveBeenCalledWith(['p1']);
      expect(useHistoryStore.getState().historyTotal).toBe(1);
    });

    it('is a no-op when no entry references the deleted file', async () => {
      useHistoryStore.setState({
        history: [entry('p1', ['a.png'])],
        historyTotal: 1,
      });

      await useHistoryStore.getState().removeOutputImages(['output/missing.png']);

      expect(useHistoryStore.getState().history).toHaveLength(1);
      expect(vi.mocked(deleteHistoryItems)).not.toHaveBeenCalled();
    });

    // A run that saved one real output plus PreviewImage frames. Rejecting +
    // deleting the single saved output must drop the whole queue item, not leave
    // it lingering showing just previews (the delete-rejected bug).
    it('removes the queue item when its last saved output is deleted, even if previews remain', async () => {
      useHistoryStore.setState({
        history: [
          typedEntry('p1', [
            { filename: 'a.png', type: 'output' },
            { filename: 'prev1.png', type: 'temp' },
            { filename: 'prev2.png', type: 'temp' },
          ]),
          entry('p2', ['c.png']),
        ],
        historyTotal: 2,
      });

      await useHistoryStore.getState().removeOutputImages(['output/a.png']);

      expect(useHistoryStore.getState().history.map((h) => h.prompt_id)).toEqual(['p2']);
      expect(vi.mocked(deleteHistoryItems)).toHaveBeenCalledWith(['p1']);
      expect(useHistoryStore.getState().historyTotal).toBe(1);
    });

    it('keeps the queue item while another saved output survives', async () => {
      useHistoryStore.setState({
        history: [
          typedEntry('p1', [
            { filename: 'a.png', type: 'output' },
            { filename: 'b.png', type: 'output' },
            { filename: 'prev.png', type: 'temp' },
          ]),
        ],
        historyTotal: 1,
      });

      await useHistoryStore.getState().removeOutputImages(['output/a.png']);

      const history = useHistoryStore.getState().history;
      expect(history).toHaveLength(1);
      expect(history[0].outputs.images.map((i) => i.filename)).toEqual(['b.png', 'prev.png']);
      expect(vi.mocked(deleteHistoryItems)).not.toHaveBeenCalled();
    });

    // The user's constraint: never auto-delete a queue item that never produced a
    // saved output. A preview-only run stays even if its preview frame is removed.
    it('does not delete a preview-only queue item that never had a saved output', async () => {
      useHistoryStore.setState({
        history: [typedEntry('p1', [{ filename: 'prev.png', type: 'temp' }])],
        historyTotal: 1,
      });

      await useHistoryStore.getState().removeOutputImages(['temp/prev.png']);

      expect(useHistoryStore.getState().history.map((h) => h.prompt_id)).toEqual(['p1']);
      expect(vi.mocked(deleteHistoryItems)).not.toHaveBeenCalled();
    });
  });
});

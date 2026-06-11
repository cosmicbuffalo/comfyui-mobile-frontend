import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getQueue, queuePrompt } from '@/api/client';
import { useQueueStore } from '@/hooks/useQueue';

vi.mock('@/api/client', () => ({
  clientId: 'test-client',
  getQueue: vi.fn(async () => ({
    queue_running: [],
    queue_pending: [[9, 'restored-prompt', { node: {} }, { extra_pnginfo: {} }, ['9']]],
  })),
  clearQueue: vi.fn(),
  deleteQueueItem: vi.fn(),
  interruptExecution: vi.fn(),
  queuePrompt: vi.fn(async () => ({ prompt_id: 'restored-prompt', number: 9 })),
  getQueuePromptMetadata: vi.fn(async () => ({})),
  remapQueuePromptMetadata: vi.fn(async () => undefined),
}));

const mockQueuePrompt = vi.mocked(queuePrompt);
const mockGetQueue = vi.mocked(getQueue);

beforeEach(() => {
  mockQueuePrompt.mockClear();
  mockGetQueue.mockResolvedValue({
    queue_running: [],
    queue_pending: [[9, 'restored-prompt', { node: {} }, { extra_pnginfo: {} }, ['9']]],
  });
  useQueueStore.setState({
    running: [],
    pending: [],
    completing: [],
    completingStartedAt: {},
    isLoading: false,
    lastExecutedId: null,
    localPromptOrder: {},
    nextLocalPromptOrder: 1,
    livePromptOutputs: {},
    queueItemExpanded: {},
    queueItemUserToggled: {},
    queueItemHideImages: {},
    showQueueMetadata: false,
    showPromptPreview: false,
    previewVisibility: {},
    previewVisibilityDefault: false,
    workflowDiffs: {},
    shadowQueueJobs: {},
    recoverableJobIds: [],
    autoRestoredPromptIds: {},
    isRestoringLostJobs: false,
    queueMetadata: {},
  });
});

describe('queue recovery', () => {
  it('retains a running item when it leaves the backend queue before history arrives', async () => {
    const runningItem = {
      number: 1,
      prompt_id: 'finishing-prompt',
      prompt: { node: {} },
      extra: {},
      outputs_to_execute: ['9'],
    };
    useQueueStore.setState({ running: [runningItem] });
    mockGetQueue.mockResolvedValueOnce({ queue_running: [], queue_pending: [] });

    await useQueueStore.getState().fetchQueue();

    expect(useQueueStore.getState().running).toEqual([]);
    expect(useQueueStore.getState().completing).toEqual([runningItem]);
  });

  it('reconstructs the completing card when queue polling removed it first', () => {
    useQueueStore.setState({
      running: [],
      pending: [],
      livePromptOutputs: {
        'finishing-prompt': [
          { filename: 'preview.png', subfolder: 'temp', type: 'temp' },
        ],
      },
      shadowQueueJobs: {
        'finishing-prompt': {
          originalPromptId: 'finishing-prompt',
          prompt: { node: {} },
          extraData: { extra_pnginfo: {} },
          outputsToExecute: ['9'],
          number: 7,
          status: 'running',
          queuedAt: 1000,
          sessionId: 'session-a',
        },
      },
    });

    useQueueStore.getState().markPromptCompleting('finishing-prompt', 2.5);

    expect(useQueueStore.getState().completing).toEqual([
      {
        number: 7,
        prompt_id: 'finishing-prompt',
        prompt: { node: {} },
        extra: { extra_pnginfo: {} },
        outputs_to_execute: ['9'],
      },
    ]);
    expect(useQueueStore.getState().livePromptOutputs['finishing-prompt']).toHaveLength(1);
    expect(useQueueStore.getState().completionDurations['finishing-prompt']).toBe(2.5);
  });

  it('detects both pending and interrupted-running shadow jobs missing from queue and history', () => {
    useQueueStore.setState({
      shadowQueueJobs: {
        'lost-pending': {
          originalPromptId: 'lost-pending',
          prompt: { node: {} },
          extraData: { extra_pnginfo: {} },
          outputsToExecute: ['9'],
          number: 4,
          status: 'pending',
          queuedAt: 1000,
          sessionId: 'session-a',
        },
        'running-job': {
          originalPromptId: 'running-job',
          prompt: {},
          outputsToExecute: [],
          number: 5,
          status: 'running',
          queuedAt: 1001,
        },
      },
    });

    // A restart that killed the active generation leaves its shadow job
    // 'running' but absent from the backend — it's recoverable alongside the
    // pending one, ordered by queue number.
    expect(useQueueStore.getState().detectRecoverableJobs()).toEqual(['lost-pending', 'running-job']);
  });

  it('excludes a running job that is still live on the backend', () => {
    useQueueStore.setState({
      running: [{ number: 5, prompt_id: 'running-job', prompt: {}, extra: {}, outputs_to_execute: [] }],
      shadowQueueJobs: {
        'running-job': {
          originalPromptId: 'running-job',
          prompt: {},
          outputsToExecute: [],
          number: 5,
          status: 'running',
          queuedAt: 1001,
        },
      },
    });

    expect(useQueueStore.getState().detectRecoverableJobs()).toEqual([]);
  });

  it('re-enqueues recoverable jobs and marks auto-restored prompt ids', async () => {
    const restored: Array<{ oldPromptId: string; newPromptId: string; sessionId?: string | null }> = [];
    useQueueStore.setState({
      shadowQueueJobs: {
        'lost-pending': {
          originalPromptId: 'lost-pending',
          prompt: { node: {} },
          extraData: { extra_pnginfo: {} },
          outputsToExecute: ['9'],
          number: 4,
          status: 'pending',
          queuedAt: 1000,
          sessionId: 'session-a',
        },
      },
      recoverableJobIds: ['lost-pending'],
    });

    await useQueueStore.getState().restoreLostJobs({
      auto: true,
      onRestored: ({ oldPromptId, newPromptId, job }) => {
        restored.push({ oldPromptId, newPromptId, sessionId: job.sessionId });
      },
    });

    expect(mockQueuePrompt).toHaveBeenCalledWith({
      prompt: { node: {} },
      client_id: 'test-client',
      extra_data: { extra_pnginfo: {} },
    });
    expect(restored).toEqual([
      { oldPromptId: 'lost-pending', newPromptId: 'restored-prompt', sessionId: 'session-a' },
    ]);
    expect(useQueueStore.getState().recoverableJobIds).toEqual([]);
    expect(useQueueStore.getState().autoRestoredPromptIds).toEqual({
      'restored-prompt': 'lost-pending',
    });
    expect(useQueueStore.getState().shadowQueueJobs['restored-prompt']).toMatchObject({
      originalPromptId: 'restored-prompt',
      status: 'pending',
    });
  });

  it('carries the recorded workflow diff to the restored prompt id', async () => {
    const diff = {
      prompts: [
        { nodeId: '1', label: 'Positive', order: 0, segments: [{ type: 'equal' as const, text: 'hi' }], changed: false },
      ],
      nodeChanges: [],
    };
    useQueueStore.setState({
      shadowQueueJobs: {
        'lost-pending': {
          originalPromptId: 'lost-pending',
          prompt: { node: {} },
          extraData: { extra_pnginfo: {} },
          outputsToExecute: ['9'],
          number: 4,
          status: 'pending',
          queuedAt: 1000,
          sessionId: 'session-a',
        },
      },
      recoverableJobIds: ['lost-pending'],
      workflowDiffs: { 'lost-pending': diff },
    });

    await useQueueStore.getState().restoreLostJobs({ auto: true });

    const { workflowDiffs } = useQueueStore.getState();
    expect(workflowDiffs['lost-pending']).toBeUndefined();
    expect(workflowDiffs['restored-prompt']).toEqual(diff);
  });

  it('TTL-prunes a completing item whose history never arrived, keeping fresh ones', async () => {
    // Backend queue is empty, so neither item is "active".
    mockGetQueue.mockResolvedValue({ queue_running: [], queue_pending: [] });
    const make = (id: string) => ({
      number: 1,
      prompt_id: id,
      prompt: {},
      extra: {},
      outputs_to_execute: [] as string[],
    });
    useQueueStore.setState({
      completing: [make('stale'), make('fresh')],
      completingStartedAt: {
        stale: Date.now() - 31_000, // older than COMPLETING_TTL_MS (30s)
        fresh: Date.now() - 5_000, // within the TTL
      },
      livePromptOutputs: {
        stale: [{ filename: 's.png', subfolder: '', type: 'output' }],
        fresh: [{ filename: 'f.png', subfolder: '', type: 'output' }],
      },
      completionDurations: { stale: 12, fresh: 3 },
    });

    await useQueueStore.getState().fetchQueue();

    const state = useQueueStore.getState();
    const completingIds = state.completing.map((item) => item.prompt_id);
    // Stale (no history within the window) is dropped so it can't become a zombie.
    expect(completingIds).not.toContain('stale');
    expect(state.livePromptOutputs.stale).toBeUndefined();
    expect(state.completionDurations.stale).toBeUndefined();
    expect(state.completingStartedAt.stale).toBeUndefined();
    // Fresh one is retained (still within the hand-off window).
    expect(completingIds).toContain('fresh');
    expect(state.livePromptOutputs.fresh).toBeDefined();
    expect(state.completingStartedAt.fresh).toBeDefined();
  });
});

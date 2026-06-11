import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectWebSocket, getHistory, getQueue } from '@/api/client';
import { useQueueStore } from '@/hooks/useQueue';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useGenerationSettingsStore } from '@/hooks/useGenerationSettings';
import {
  BACKEND_LOST_NOTICE_MIN_DOWNTIME_MS,
  extractTextPreviewFromOutput,
  getBackendReconnectMessage,
  runQueuePollTick,
  useWebSocket,
} from '../useWebSocket';

vi.mock('@/api/client', () => ({
  clientId: 'test-client',
  connectWebSocket: vi.fn(),
  getQueue: vi.fn(),
  getHistory: vi.fn(),
  getHistoryCount: vi.fn().mockResolvedValue(null),
  getQueuePromptMetadata: vi.fn(async () => ({})),
  remapQueuePromptMetadata: vi.fn(async () => undefined),
}));

type ConnectArgs = Parameters<typeof connectWebSocket>;

interface WebSocketCallbacks {
  onOpen?: ConnectArgs[2];
  onClose?: ConnectArgs[3];
  onError?: ConnectArgs[4];
}

const mockConnectWebSocket = vi.mocked(connectWebSocket);
const mockGetQueue = vi.mocked(getQueue);
const mockGetHistory = vi.mocked(getHistory);
const callbacks: WebSocketCallbacks[] = [];
const sockets: WebSocket[] = [];

function setSocketReadyState(socket: WebSocket, readyState: number) {
  (socket as unknown as { readyState: number }).readyState = readyState;
}

function WebSocketHarness() {
  useWebSocket();
  return null;
}

describe('backend reconnect notices', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    callbacks.length = 0;
    sockets.length = 0;
    mockConnectWebSocket.mockReset();
    mockGetQueue.mockResolvedValue({ queue_running: [], queue_pending: [] });
    mockGetHistory.mockResolvedValue({});
    mockConnectWebSocket.mockImplementation(
      (_clientId, _onMessage, onOpen, onClose, onError) => {
        const socket = {
          readyState: WebSocket.OPEN,
          close: vi.fn(),
        } as unknown as WebSocket;
        callbacks.push({ onOpen, onClose, onError });
        sockets.push(socket);
        return socket;
      },
    );
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
      shadowQueueJobs: {},
      recoverableJobIds: [],
    });
    useWorkflowErrorsStore.setState({
      error: null,
      nodeErrors: {},
      errorCycleIndex: 0,
      errorsDismissed: false,
    });
    useGenerationSettingsStore.setState({
      infiniteModeEnabled: false,
    });
    useWorkflowStore.setState({
      nodeTypes: null,
      activeSessionId: null,
      promptToSession: {},
      isExecuting: true,
      executingNodeId: '12',
      executingNodeHierarchicalKey: 'root/node:12',
      executingNodePath: '12',
      executingPromptId: 'lost-prompt',
      progress: 42,
      executionStartTime: Date.now() - 10_000,
      currentNodeStartTime: Date.now() - 5_000,
      isStopping: true,
      infiniteLoop: true,
      infiniteLoopSessionId: 'lost-session',
      parkedSessions: {},
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  function seedRecoverableJob(promptId: string) {
    useQueueStore.setState({
      shadowQueueJobs: {
        [promptId]: {
          originalPromptId: promptId,
          prompt: {},
          outputsToExecute: [],
          number: 1,
          status: 'pending',
          queuedAt: 0,
        },
      },
    });
  }

  async function disconnectThenReconnect(downtimeMs: number) {
    await act(async () => {
      root.render(createElement(WebSocketHarness));
    });
    await act(async () => {
      await callbacks[0].onOpen?.();
    });

    expect(useWorkflowErrorsStore.getState().error).toBeNull();

    await act(async () => {
      setSocketReadyState(sockets[0], WebSocket.CLOSED);
      callbacks[0].onClose?.();
    });

    // The disconnect alone must never raise the popup — we can't yet know
    // whether it lasts or costs us any jobs.
    expect(useWorkflowErrorsStore.getState().error).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(downtimeMs);
    });
    await act(async () => {
      await callbacks[1].onOpen?.();
    });
  }

  it('surfaces a backend interruption only after a long outage that lost jobs', async () => {
    seedRecoverableJob('lost-prompt');

    await disconnectThenReconnect(BACKEND_LOST_NOTICE_MIN_DOWNTIME_MS + 1000);

    expect(useWorkflowErrorsStore.getState().error).toBe(
      'Backend connection restored after 6s. ComfyUI may have restarted; running jobs may have been interrupted.',
    );
    // Stale execution state is still cleared regardless of whether we notify.
    expect(useWorkflowStore.getState()).toMatchObject({
      isExecuting: false,
      executingNodeId: null,
      executingNodeHierarchicalKey: null,
      executingNodePath: null,
      executingPromptId: null,
      progress: 0,
      isStopping: false,
      infiniteLoop: false,
      infiniteLoopSessionId: null,
    });
  });

  it('stays silent for a brief disconnect even when jobs were lost', async () => {
    seedRecoverableJob('lost-prompt');

    await disconnectThenReconnect(2000);

    expect(useWorkflowErrorsStore.getState().error).toBeNull();
  });

  it('stays silent for a long outage when no jobs were lost', async () => {
    await disconnectThenReconnect(BACKEND_LOST_NOTICE_MIN_DOWNTIME_MS + 1000);

    expect(useWorkflowErrorsStore.getState().error).toBeNull();
  });

  it('restores execution state from the backend queue on initial page load', async () => {
    mockGetQueue.mockResolvedValue({
      queue_running: [[3, 'backend-running-prompt', { sampler: {} }, {}, ['9']]],
      queue_pending: [],
    });

    await act(async () => {
      root.render(createElement(WebSocketHarness));
    });
    await act(async () => {
      await callbacks[0].onOpen?.();
    });

    expect(useQueueStore.getState().running[0]).toMatchObject({
      number: 3,
      prompt_id: 'backend-running-prompt',
      prompt: { sampler: {} },
      outputs_to_execute: ['9'],
    });
    expect(useWorkflowStore.getState()).toMatchObject({
      isExecuting: true,
      executingPromptId: 'backend-running-prompt',
      progress: 0,
    });
    expect(useWorkflowErrorsStore.getState().error).toBeNull();
  });

  it('resumes a restored infinite loop when its session has no live prompt', async () => {
    const queueWorkflow = vi.fn(async () => undefined);
    useGenerationSettingsStore.setState({ infiniteModeEnabled: true });
    useWorkflowStore.setState({
      activeSessionId: 'loop-session',
      sessions: [{ id: 'loop-session' }],
      infiniteLoop: true,
      infiniteLoopSessionId: 'loop-session',
      nodeTypes: null,
      queueWorkflow,
    });

    await act(async () => {
      root.render(createElement(WebSocketHarness));
    });
    await act(async () => {
      await callbacks[0].onOpen?.();
    });

    expect(queueWorkflow).not.toHaveBeenCalled();

    await act(async () => {
      useWorkflowStore.setState({ nodeTypes: {} });
    });

    expect(queueWorkflow).toHaveBeenCalledTimes(1);
    expect(queueWorkflow).toHaveBeenCalledWith(1, 'loop-session', true);
    expect(useWorkflowStore.getState().infiniteLoopSessionId).toBe('loop-session');

    await act(async () => {
      useQueueStore.setState({ running: [], pending: [], completing: [] });
    });
    expect(queueWorkflow).toHaveBeenCalledTimes(1);
  });

  it('does not auto-start a freshly armed infinite loop until a run goes live', async () => {
    const queueWorkflow = vi.fn(async () => undefined);
    useGenerationSettingsStore.setState({ infiniteModeEnabled: true });
    // infiniteLoopAwaitingRun mirrors what setInfiniteLoop(true) sets when the
    // user toggles the button live (vs a reload-restored loop, where it's false).
    useWorkflowStore.setState({
      activeSessionId: 'loop-session',
      sessions: [{ id: 'loop-session' }],
      infiniteLoop: true,
      infiniteLoopSessionId: 'loop-session',
      infiniteLoopAwaitingRun: true,
      nodeTypes: {},
      queueWorkflow,
    });

    await act(async () => {
      root.render(createElement(WebSocketHarness));
    });
    await act(async () => {
      await callbacks[0].onOpen?.();
    });

    // Arming alone must not enqueue — the Run button starts generation.
    expect(queueWorkflow).not.toHaveBeenCalled();

    // Once a run for the session is live, the guard clears so the idle-resume
    // backup can act again on later iterations.
    await act(async () => {
      useWorkflowStore.setState({ promptToSession: { 'run-1': 'loop-session' } });
      useQueueStore.setState({
        running: [{ number: 1, prompt_id: 'run-1', prompt: {}, extra: {}, outputs_to_execute: [] }],
        pending: [],
        completing: [],
      });
    });
    expect(useWorkflowStore.getState().infiniteLoopAwaitingRun).toBe(false);
  });

  it('does not auto-start an armed loop owned by a parked tab', async () => {
    const queueWorkflow = vi.fn(async () => undefined);
    useGenerationSettingsStore.setState({ infiniteModeEnabled: true });
    // The loop was armed (never run) in 'loop-session', then the user switched
    // to another tab: the guard must survive the switch and block auto-start.
    useWorkflowStore.setState({
      activeSessionId: 'other-session',
      sessions: [{ id: 'other-session' }, { id: 'loop-session' }],
      parkedSessions: {
        'loop-session': {} as never,
      },
      infiniteLoop: false,
      infiniteLoopSessionId: 'loop-session',
      infiniteLoopAwaitingRun: true,
      nodeTypes: {},
      queueWorkflow,
    });

    await act(async () => {
      root.render(createElement(WebSocketHarness));
    });
    await act(async () => {
      await callbacks[0].onOpen?.();
    });

    expect(queueWorkflow).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().infiniteLoopAwaitingRun).toBe(true);
  });

  it('does not duplicate a restored infinite loop prompt still on the backend', async () => {
    const queueWorkflow = vi.fn(async () => undefined);
    mockGetQueue.mockResolvedValue({
      queue_running: [[3, 'loop-prompt', { sampler: {} }, {}, ['9']]],
      queue_pending: [],
    });
    useGenerationSettingsStore.setState({ infiniteModeEnabled: true });
    useWorkflowStore.setState({
      activeSessionId: 'loop-session',
      sessions: [{ id: 'loop-session' }],
      infiniteLoop: true,
      infiniteLoopSessionId: 'loop-session',
      promptToSession: { 'loop-prompt': 'loop-session' },
      nodeTypes: {},
      queueWorkflow,
    });

    await act(async () => {
      root.render(createElement(WebSocketHarness));
    });
    await act(async () => {
      await callbacks[0].onOpen?.();
    });

    expect(queueWorkflow).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().infiniteLoopSessionId).toBe('loop-session');
  });

  it('formats longer reconnect durations', () => {
    expect(getBackendReconnectMessage(65_000)).toBe(
      'Backend connection restored after 1m 5s. ComfyUI may have restarted; running jobs may have been interrupted.',
    );
  });
});

describe('extractTextPreviewFromOutput', () => {
  it('extracts text from explicit text-like fields', () => {
    expect(
      extractTextPreviewFromOutput({
        result: [{ text: 'hello world' }],
      })
    ).toBe('hello world');
  });

  it('does not treat media filenames as text preview', () => {
    expect(
      extractTextPreviewFromOutput({
        images: [{ filename: 'preview.png', subfolder: 'temp', type: 'temp' }],
      })
    ).toBeNull();
  });

  it('prefers text when both media and text payloads exist', () => {
    expect(
      extractTextPreviewFromOutput({
        images: [{ filename: 'preview.png', subfolder: 'temp', type: 'temp' }],
        text: ['real preview text'],
      })
    ).toBe('real preview text');
  });
});

describe('runQueuePollTick', () => {
  const makeItem = (promptId: string) =>
    ({ number: 1, prompt_id: promptId, prompt: {}, extra: {}, outputs_to_execute: [] }) as never;

  afterEach(() => {
    useQueueStore.setState({ running: [], pending: [], completing: [] });
  });

  it('does nothing when the queue is idle', async () => {
    useQueueStore.setState({ running: [], pending: [], completing: [] });
    const fetchQueue = vi.fn(async () => {});
    const fetchHistory = vi.fn(async () => {});

    await runQueuePollTick(fetchQueue, fetchHistory);

    expect(fetchQueue).not.toHaveBeenCalled();
    expect(fetchHistory).not.toHaveBeenCalled();
  });

  it('skips the heavy history fetch while a prompt is still running and nothing has completed', async () => {
    useQueueStore.setState({ running: [makeItem('run-1')], completing: [] });
    // Queue unchanged after refresh: the prompt is still executing.
    const fetchQueue = vi.fn(async () => {});
    const fetchHistory = vi.fn(async () => {});

    await runQueuePollTick(fetchQueue, fetchHistory);

    expect(fetchQueue).toHaveBeenCalledTimes(1);
    expect(fetchHistory).not.toHaveBeenCalled();
  });

  it('pulls history once a finished prompt is awaiting finalization', async () => {
    useQueueStore.setState({ running: [makeItem('run-1')], completing: [] });
    // fetchQueue moves the finished prompt out of `running` into `completing`.
    const fetchQueue = vi.fn(async () => {
      useQueueStore.setState({ running: [], completing: [makeItem('run-1')] });
    });
    const fetchHistory = vi.fn(async () => {});

    await runQueuePollTick(fetchQueue, fetchHistory);

    expect(fetchQueue).toHaveBeenCalledTimes(1);
    expect(fetchHistory).toHaveBeenCalledTimes(1);
  });

  it('keeps pulling history while a completing card is stuck awaiting its history record', async () => {
    useQueueStore.setState({ running: [], completing: [makeItem('stuck-1')] });
    const fetchQueue = vi.fn(async () => {});
    const fetchHistory = vi.fn(async () => {});

    await runQueuePollTick(fetchQueue, fetchHistory);

    expect(fetchQueue).toHaveBeenCalledTimes(1);
    expect(fetchHistory).toHaveBeenCalledTimes(1);
  });
});

// Drives real websocket frames through useWebSocket's message handler to verify
// that a run whose owning tab was closed mid-generation (an "orphaned" prompt)
// can never paint its outputs/error onto the now-active tab — while an unmapped
// (e.g. desktop-queued) prompt still routes to the active tab as before.
describe('orphaned closed-tab run routing', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onMessage: ((msg: unknown) => void) | undefined;

  const emptyWorkflow = {
    nodes: [],
    links: [],
    groups: [],
    config: {},
    version: 1,
    last_node_id: 0,
    last_link_id: 0,
  } as never;
  const sampleOutput = {
    node: '5',
    output: { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] },
  };

  beforeEach(() => {
    callbacks.length = 0;
    sockets.length = 0;
    onMessage = undefined;
    mockConnectWebSocket.mockReset();
    mockGetQueue.mockResolvedValue({ queue_running: [], queue_pending: [] });
    mockGetHistory.mockResolvedValue({});
    mockConnectWebSocket.mockImplementation(
      (_clientId, handleMessage, onOpen, onClose, onError) => {
        onMessage = handleMessage as (msg: unknown) => void;
        const socket = { readyState: WebSocket.OPEN, close: vi.fn() } as unknown as WebSocket;
        callbacks.push({ onOpen, onClose, onError });
        sockets.push(socket);
        return socket;
      },
    );
    useQueueStore.setState({
      running: [], pending: [], completing: [], isLoading: false,
      lastExecutedId: null, localPromptOrder: {}, nextLocalPromptOrder: 1,
      livePromptOutputs: {}, queueItemExpanded: {}, queueItemUserToggled: {},
      queueItemHideImages: {}, showQueueMetadata: false, previewVisibility: {},
      previewVisibilityDefault: false, shadowQueueJobs: {}, recoverableJobIds: [],
    });
    useWorkflowErrorsStore.setState({
      error: null, nodeErrors: {}, errorCycleIndex: 0, errorsDismissed: false, sessionErrors: {},
    });
    useGenerationSettingsStore.setState({ infiniteModeEnabled: false });
    useWorkflowStore.setState({
      activeSessionId: 'active',
      sessions: [{ id: 'active' }],
      parkedSessions: {},
      // 'orphan-prompt' maps to a session that is neither active nor parked → its
      // tab was closed mid-run. 'desktop-prompt' has no mapping → routes to active.
      promptToSession: { 'orphan-prompt': 'closed-session' },
      workflow: emptyWorkflow,
      nodeOutputs: {},
      promptOutputs: {},
      isExecuting: false,
      executingNodeId: null,
      executingNodeHierarchicalKey: null,
      executingNodePath: null,
      executingPromptId: null,
      progress: 0,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  async function mount() {
    await act(async () => { root.render(createElement(WebSocketHarness)); });
    await act(async () => { await callbacks[0].onOpen?.(); });
  }

  // Some handlers fire-and-forget a fetchQueue/fetchHistory; flush those inside
  // act so their trailing state updates don't escape it.
  async function fire(msg: unknown) {
    await act(async () => {
      onMessage?.(msg);
      await Promise.resolve();
    });
  }

  it('keeps live outputs and re-enqueues across an infinite-loop completion', async () => {
    const queueWorkflow = vi.fn();
    useGenerationSettingsStore.setState({ infiniteModeEnabled: true });
    useWorkflowStore.setState({
      promptToSession: { p1: 'active' },
      infiniteLoopSessionId: 'active',
      isStopping: false,
      isLoadingBySession: {},
      queueWorkflow: queueWorkflow as never,
    });
    await mount();

    // P1's SaveImage output arrives over the websocket.
    await fire({
      type: 'executed',
      data: {
        node: '5',
        prompt_id: 'p1',
        output: { images: [{ filename: 'gen-1.png', subfolder: '', type: 'output' }] },
      },
    });
    expect(useQueueStore.getState().livePromptOutputs.p1).toMatchObject([
      { filename: 'gen-1.png', type: 'output' },
    ]);

    // Execution completes → the infinite loop re-enqueues, and the finished
    // generation's live outputs must survive for the follow-queue viewer jump.
    await fire({ type: 'executing', data: { node: null, prompt_id: 'p1' } });
    expect(queueWorkflow).toHaveBeenCalledWith(1, 'active', true);
    expect(useQueueStore.getState().livePromptOutputs.p1).toMatchObject([
      { filename: 'gen-1.png', type: 'output' },
    ]);

    // Next iteration (p2, queued by the loop) completes the same way.
    useWorkflowStore.setState({
      promptToSession: { p1: 'active', p2: 'active' },
    });
    await fire({
      type: 'executed',
      data: {
        node: '5',
        prompt_id: 'p2',
        output: { images: [{ filename: 'gen-2.png', subfolder: '', type: 'output' }] },
      },
    });
    await fire({ type: 'executing', data: { node: null, prompt_id: 'p2' } });
    expect(useQueueStore.getState().livePromptOutputs.p2).toMatchObject([
      { filename: 'gen-2.png', type: 'output' },
    ]);
    expect(queueWorkflow).toHaveBeenCalledTimes(2);
  });

  it('drops an orphaned prompt\'s outputs instead of painting them on the active tab', async () => {
    await mount();
    await fire({ type: 'executed', data: { ...sampleOutput, prompt_id: 'orphan-prompt' } });
    expect(useWorkflowStore.getState().promptOutputs['orphan-prompt']).toBeUndefined();
  });

  it('still routes an unmapped (desktop) prompt\'s outputs to the active tab', async () => {
    await mount();
    await fire({ type: 'executed', data: { ...sampleOutput, prompt_id: 'desktop-prompt' } });
    expect(useWorkflowStore.getState().promptOutputs['desktop-prompt']).toBeDefined();
  });

  it('does not raise the global error banner for an orphaned prompt', async () => {
    await mount();
    await fire({
      type: 'execution_error',
      data: { prompt_id: 'orphan-prompt', exception_message: 'boom', node_id: '5' },
    });
    expect(useWorkflowErrorsStore.getState().error).toBeNull();
  });

  it('raises the global error banner for an unmapped (desktop) prompt', async () => {
    await mount();
    await fire({
      type: 'execution_error',
      data: { prompt_id: 'desktop-prompt', exception_message: 'boom', node_id: '5' },
    });
    expect(useWorkflowErrorsStore.getState().error).not.toBeNull();
  });
});

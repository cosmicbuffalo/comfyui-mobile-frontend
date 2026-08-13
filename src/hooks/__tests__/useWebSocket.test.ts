import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectWebSocket, getHistory, getQueue } from '@/api/client';
import { useQueueStore } from '@/hooks/useQueue';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useGenerationSettingsStore } from '@/hooks/useGenerationSettings';
import type { Workflow } from '@/api/types';
import {
  BACKEND_LOST_NOTICE_MIN_DOWNTIME_MS,
  extractTextPreviewFromOutput,
  collectExecutedMediaOutputs,
  collectDenoVideoCompareOutput,
  getBackendReconnectMessage,
  parseBinaryPreviewMessage,
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
  // Genuinely-lost jobs in these tests never ran, so they have no backend
  // history; the reconnect reconciliation keeps them flagged.
  promptHasHistory: vi.fn().mockResolvedValue(false),
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
      '后端连接已在 6s 后恢复。ComfyUI 可能已重启，正在运行的任务可能已被中断。',
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

  it('does not auto-start or clear the arm guard from a pre-existing session run', async () => {
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

    // A live prompt for the session does NOT clear the arm guard: it may be a
    // pre-existing manual run that was already queued when infinite mode was
    // armed. Only an actual loop Run (queueWorkflow) clears the guard, so the
    // loop stays merely armed and never auto-starts off pre-existing items.
    await act(async () => {
      useWorkflowStore.setState({ promptToSession: { 'run-1': 'loop-session' } });
      useQueueStore.setState({
        running: [{ number: 1, prompt_id: 'run-1', prompt: {}, extra: {}, outputs_to_execute: [] }],
        pending: [],
        completing: [],
      });
    });
    expect(useWorkflowStore.getState().infiniteLoopAwaitingRun).toBe(true);
    expect(queueWorkflow).not.toHaveBeenCalled();

    // Draining those pre-existing items must still not auto-start the loop while
    // it's only armed — the user starts it with Run.
    await act(async () => {
      useQueueStore.setState({ running: [], pending: [], completing: [] });
    });
    expect(queueWorkflow).not.toHaveBeenCalled();
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
      '后端连接已在 1m 5s 后恢复。ComfyUI 可能已重启，正在运行的任务可能已被中断。',
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

describe('collectExecutedMediaOutputs', () => {
  it('collects video descriptors regardless of the standard bucket a node uses', () => {
    expect(collectExecutedMediaOutputs({
      // Native SaveVideo currently publishes PreviewVideo entries here.
      images: [{ filename: 'core.mp4', subfolder: 'video', type: 'output' }],
      // VideoHelperSuite publishes its video combine entries here.
      gifs: [{ filename: 'vhs.webm', subfolder: '', type: 'temp', format: 'video/webm' }],
      videos: [{ filename: 'custom.mov', subfolder: 'clips', type: 'output' }],
    })).toEqual([
      { filename: 'core.mp4', subfolder: 'video', type: 'output' },
      { filename: 'vhs.webm', subfolder: '', type: 'temp', format: 'video/webm' },
      { filename: 'custom.mov', subfolder: 'clips', type: 'output' },
    ]);
  });

  it('preserves mixed-media order, removes duplicates, and ignores malformed entries', () => {
    const repeated = { filename: 'same.mp4', subfolder: '', type: 'output' };
    expect(collectExecutedMediaOutputs({
      images: [
        { filename: 'still.png', subfolder: '', type: 'output' },
        repeated,
        { filename: 'missing-type.mp4', subfolder: '' },
      ],
      gifs: [repeated, null],
      videos: [{ filename: 'last.mkv', subfolder: 'batch', type: 'output' }],
    })).toEqual([
      { filename: 'still.png', subfolder: '', type: 'output' },
      repeated,
      { filename: 'last.mkv', subfolder: 'batch', type: 'output' },
    ]);
  });

  it('normalizes DenoVideoPreview and gives its overwritten filename a run identity', () => {
    expect(collectExecutedMediaOutputs({
      deno_video_preview: [{
        filename: 'deno_preview_7.mp4',
        subfolder: 'deno_video_preview',
        type: 'temp',
        frame_rate: 24,
      }],
    }, 'run-2')).toEqual([expect.objectContaining({
      filename: 'deno_preview_7.mp4',
      type: 'temp',
      frame_rate: 24,
      cacheToken: 'run-2',
    })]);
  });
});

describe('collectDenoVideoCompareOutput', () => {
  it('normalizes frame sequences and raw PCM metadata for the mobile player', () => {
    const output = collectDenoVideoCompareOutput({
      deno_video_compare: [{
        mode: 'Difference', split_position: 0.4, toggle_image: 'A', swap: true,
        fps: 30, source_fps: 60, duration: 2, frame_count: 60,
        subfolder: 'deno_vcmp_abc', have_a: true, have_b: true,
        files_a: ['a_000000.webp', 'a_000001.webp'],
        files_b: ['b_000000.webp', 'b_000001.webp'],
        a_src_w: 1920, a_src_h: 1080, a_count: 60,
        b_src_w: 1280, b_src_h: 720, b_count: 60,
        audio_a: { filename: 'a_audio.f32', channels: 2, samples: 96000, sample_rate: 48000 },
      }],
    });
    expect(output?.a[0]).toEqual({
      filename: 'a_000000.webp', subfolder: 'deno_vcmp_abc', type: 'temp',
    });
    expect(output?.video).toMatchObject({
      mode: 'Difference', splitPosition: 0.4, toggleImage: 'A', swapped: true,
      fps: 30, sourceFps: 60, duration: 2, frameCount: 60,
      audioA: { filename: 'a_audio.f32', channels: 2, sample_rate: 48000 },
    });
  });
});

describe('parseBinaryPreviewMessage', () => {
  const blobBytes = (blob: Blob): Promise<Uint8Array> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });

  it('keeps ordinary Comfy preview image bytes intact', async () => {
    const bytes = new Uint8Array(12);
    new DataView(bytes.buffer).setUint32(0, 1, false);
    new DataView(bytes.buffer).setUint32(4, 1, false);
    bytes.set([0xff, 0xd8, 0xff, 0xd9], 8);
    const parsed = parseBinaryPreviewMessage(bytes.buffer);
    expect(parsed?.kind).toBe('image');
    expect(await blobBytes(parsed!.blob)).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    );
  });

  it('strips VHS frame index and Pascal node-id headers from animated latent JPEGs', async () => {
    const bytes = new Uint8Array(32);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 1, false);
    view.setUint32(4, 1, false);
    view.setUint32(8, 3, false);
    const id = new TextEncoder().encode('50:7');
    bytes[12] = id.length;
    bytes.set(id, 13);
    bytes.set([0xff, 0xd8, 0xff, 0xd9], 28);
    const parsed = parseBinaryPreviewMessage(bytes.buffer);
    expect(parsed).toMatchObject({ kind: 'vhs', nodeId: '50:7', index: 3 });
    expect(await blobBytes(parsed!.blob)).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    );
  });

  it('decodes a modern JSON-prefixed envelope and rejects a truncated one', () => {
    const json = new TextEncoder().encode('{"image_type":"PNG"}');
    const bytes = new Uint8Array(8 + json.length + 4);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 4, false);
    view.setUint32(4, json.length, false);
    bytes.set(json, 8);
    bytes.set([0x89, 0x50, 0x4e, 0x47], 8 + json.length);
    const parsed = parseBinaryPreviewMessage(bytes.buffer);
    expect(parsed?.kind).toBe('image');
    expect(parsed?.blob.type).toBe('image/png');

    // Fewer than 4 payload bytes cannot be an image; the parser must not
    // wrap them in a mislabeled Blob.
    const truncated = bytes.slice(0, 8 + json.length + 2);
    expect(parseBinaryPreviewMessage(truncated.buffer)).toBeNull();
  });

  it('does not mistake ordinary JPEG payload bytes for a VHS envelope', () => {
    const bytes = new Uint8Array(40);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 1, false);
    view.setUint32(4, 1, false);
    bytes.set([0xff, 0xd8], 8);
    bytes[12] = 4; // Plausible VHS id length in ordinary compressed data.
    bytes.set([0xff, 0xd8], 28); // Plausible nested JPEG marker by coincidence.
    expect(parseBinaryPreviewMessage(bytes.buffer)?.kind).toBe('image');
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
  let onBinaryMessage: ((data: ArrayBuffer) => void) | undefined;

  const emptyWorkflow = {
    nodes: [],
    links: [],
    groups: [],
    config: {},
    version: 1,
    last_node_id: 0,
    last_link_id: 0,
  } as Workflow;
  const sampleOutput = {
    node: '5',
    output: { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] },
  };

  beforeEach(() => {
    callbacks.length = 0;
    sockets.length = 0;
    onMessage = undefined;
    onBinaryMessage = undefined;
    mockConnectWebSocket.mockReset();
    mockGetQueue.mockResolvedValue({ queue_running: [], queue_pending: [] });
    mockGetHistory.mockResolvedValue({});
    mockConnectWebSocket.mockImplementation(
      (_clientId, handleMessage, onOpen, onClose, onError, handleBinaryMessage) => {
        onMessage = handleMessage as (msg: unknown) => void;
        onBinaryMessage = handleBinaryMessage;
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
      latentPreviews: {},
      latentPreviewByPrompt: {},
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it('flags an execution error as a RUN error, not a load error', async () => {
    // BottomStatusOverlay derives isWorkflowLoadError from node errors that are
    // NOT fromRun, and suppresses the toast for those on every panel except the
    // workflow one. Without the flag a run that died while the user watched the
    // queue or outputs failed silently.
    await act(async () => {
      root.render(createElement(WebSocketHarness));
      await Promise.resolve();
    });

    await fire({
      type: 'execution_error',
      data: {
        prompt_id: 'active-prompt',
        node: '7',
        node_type: 'KSampler',
        exception_message: 'CUDA out of memory',
      },
    });

    const errors = useWorkflowErrorsStore.getState();
    expect(Object.keys(errors.nodeErrors)).toContain('7');
    expect(errors.nodeErrorsFromRun).toBe(true);
  });

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

  it('routes Video Oasis side-channel results by the node widget io_id', async () => {
    const oasisNode: Workflow['nodes'][number] = {
      id: 9,
      itemKey: 'root/node:9',
      type: 'VideoOasisPreview',
      pos: [0, 0], size: [300, 300], flags: {}, order: 0, mode: 0,
      inputs: [], outputs: [], properties: {},
      widgets_values: { video_oasis_ui: JSON.stringify({ io_id: 'oasis-9' }) },
    };
    useWorkflowStore.setState({
      workflow: { ...emptyWorkflow, nodes: [oasisNode] },
      nodeOutputs: {},
    });
    await mount();
    await fire({
      type: 'video-oasis/result',
      data: {
        io_id: 'oasis-9',
        results: [{ filename: 'oasis.mp4', subfolder: 'video', type: 'temp' }],
      },
    });
    expect(useWorkflowStore.getState().nodeOutputs['9']).toEqual([
      expect.objectContaining({ filename: 'oasis.mp4', type: 'temp' }),
    ]);
    await fire({
      type: 'video-oasis/result',
      data: {
        io_id: 'oasis-9',
        results: [{ filename: 'oasis-2.mp4', subfolder: 'video', type: 'temp' }],
      },
    });
    // The volatile output is only the newest arrival (so NodeCard never falls
    // into a generic multi-video grid); the serialized widget owns the full
    // scene bar and therefore survives Save/reload.
    expect(useWorkflowStore.getState().nodeOutputs['9']).toEqual([
      expect.objectContaining({ filename: 'oasis-2.mp4', type: 'temp' }),
    ]);
    const raw = (useWorkflowStore.getState().workflow!.nodes[0]
      .widgets_values as Record<string, string>).video_oasis_ui;
    const saved = JSON.parse(raw);
    expect(saved.preview.history.map((entry: { filename: string }) => entry.filename))
      .toEqual(['oasis.mp4', 'oasis-2.mp4']);
    expect(saved.preview.activeIdx).toBe(1);
  });

  it('buffers out-of-order VHS latent frames and animates the node path prefixes', async () => {
    vi.useFakeTimers();
    let blobId = 0;
    class TestURL extends URL {
      static createObjectURL() { blobId += 1; return `blob:vhs-${blobId}`; }
      static revokeObjectURL() {}
    }
    vi.stubGlobal('URL', TestURL);
    useWorkflowStore.setState({
      promptToSession: { 'p-vhs': 'active' },
      expandedNodeIdMap: {
        '50': 'root/node:50',
        '50:7': 'root/subgraph:sg-video/node:7',
      },
      expandedNodePathMap: { '50': '50', '50:7': '50:7' },
      latentPreviews: {},
      latentPreviewByPrompt: {},
    });
    await mount();
    await fire({ type: 'executing', data: { node: '50:7', prompt_id: 'p-vhs' } });
    await fire({ type: 'VHS_latentpreview', data: { id: '50:7', length: 2, rate: 10 } });

    const frame = (index: number) => {
      const bytes = new Uint8Array(32);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, 1, false);
      view.setUint32(4, 1, false);
      view.setUint32(8, index, false);
      const id = new TextEncoder().encode('50:7');
      bytes[12] = id.length;
      bytes.set(id, 13);
      bytes.set([0xff, 0xd8, 0xff, 0xd9], 28);
      return bytes.buffer;
    };

    await act(async () => {
      onBinaryMessage?.(frame(1));
      vi.advanceTimersByTime(110);
    });
    expect(useWorkflowStore.getState().latentPreviews).toEqual({});

    await act(async () => {
      onBinaryMessage?.(frame(0));
      vi.advanceTimersByTime(210);
    });
    const previews = useWorkflowStore.getState().latentPreviews;
    expect(previews['root/node:50']).toMatch(/^blob:vhs-/);
    expect(previews['root/subgraph:sg-video/node:7']).toMatch(/^blob:vhs-/);
    expect(useWorkflowStore.getState().latentPreviewByPrompt['p-vhs']?.url).toMatch(/^blob:vhs-/);
  });

  it('keeps VHS timers exclusive across an execution transition and a new sequence', async () => {
    vi.useFakeTimers();
    const createdKinds: string[] = [];
    let blobId = 0;
    class TestURL extends URL {
      static createObjectURL(blob: Blob) {
        const kind = blob.size === 4 ? 'old' : 'new';
        createdKinds.push(kind);
        blobId += 1;
        return `blob:${kind}-${blobId}`;
      }
      static revokeObjectURL() {}
    }
    vi.stubGlobal('URL', TestURL);
    useWorkflowStore.setState({
      promptToSession: { 'p-vhs': 'active' },
      expandedNodeIdMap: {
        '7': 'root/node:7',
        '8': 'root/node:8',
      },
      expandedNodePathMap: { '7': '7', '8': '8' },
      latentPreviews: {},
      latentPreviewByPrompt: {},
    });
    await mount();

    const frame = (nodeId: string, extraByte = false) => {
      const bytes = new Uint8Array(extraByte ? 33 : 32);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, 1, false);
      view.setUint32(4, 1, false);
      const id = new TextEncoder().encode(nodeId);
      bytes[12] = id.length;
      bytes.set(id, 13);
      bytes.set([0xff, 0xd8, 0xff, 0xd9], 28);
      if (extraByte) bytes[32] = 0;
      return bytes.buffer;
    };

    await fire({ type: 'executing', data: { node: '7', prompt_id: 'p-vhs' } });
    await fire({ type: 'VHS_latentpreview', data: { id: '7', length: 1, rate: 10 } });
    await act(async () => {
      onBinaryMessage?.(frame('7'));
      vi.advanceTimersByTime(110);
    });
    const oldNodePreview = useWorkflowStore.getState().latentPreviews['root/node:7'];
    expect(oldNodePreview).toMatch(/^blob:old-/);

    await fire({ type: 'executing', data: { node: '8', prompt_id: 'p-vhs' } });
    createdKinds.length = 0;
    await act(async () => { vi.advanceTimersByTime(210); });
    expect(createdKinds).toEqual([]);
    expect(useWorkflowStore.getState().latentPreviews['root/node:7']).toBe(oldNodePreview);

    await fire({ type: 'VHS_latentpreview', data: { id: '8', length: 1, rate: 10 } });
    await act(async () => {
      onBinaryMessage?.(frame('8', true));
      createdKinds.length = 0;
      vi.advanceTimersByTime(510);
    });

    expect(createdKinds.length).toBeGreaterThan(0);
    expect(new Set(createdKinds)).toEqual(new Set(['new']));
    expect(useWorkflowStore.getState().latentPreviews['root/node:7']).toBe(oldNodePreview);
    const newNodePreview = useWorkflowStore.getState().latentPreviews['root/node:8'];
    expect(newNodePreview).toMatch(/^blob:new-/);
    expect(useWorkflowStore.getState().latentPreviewByPrompt['p-vhs']?.url).toMatch(/^blob:new-/);

    // A fresh JSON sequence is independently exclusive, even if a matching
    // `executing` event is not observed between the two sequence announcements.
    await fire({ type: 'VHS_latentpreview', data: { id: '7', length: 1, rate: 10 } });
    await act(async () => {
      onBinaryMessage?.(frame('7'));
      createdKinds.length = 0;
      vi.advanceTimersByTime(510);
    });
    expect(createdKinds.length).toBeGreaterThan(0);
    expect(new Set(createdKinds)).toEqual(new Set(['old']));
    expect(useWorkflowStore.getState().latentPreviews['root/node:8']).toBe(newNodePreview);
    expect(useWorkflowStore.getState().latentPreviewByPrompt['p-vhs']?.url).toMatch(/^blob:old-/);
  });

  it('keeps parked-session VHS latent frames off the active workflow card', async () => {
    vi.useFakeTimers();
    let blobId = 0;
    class TestURL extends URL {
      static createObjectURL() { blobId += 1; return `blob:parked-${blobId}`; }
      static revokeObjectURL() {}
    }
    vi.stubGlobal('URL', TestURL);
    useWorkflowStore.setState({
      promptToSession: { 'p-parked': 'parked' },
      parkedSessions: {
        parked: {
          workflow: emptyWorkflow,
          expandedNodeIdMap: { '7': 'root/node:7' },
          expandedNodePathMap: { '7': '7' },
        } as never,
      },
    });
    await mount();
    await fire({ type: 'executing', data: { node: '7', prompt_id: 'p-parked' } });
    await fire({ type: 'VHS_latentpreview', data: { id: '7', length: 1, rate: 10 } });
    const bytes = new Uint8Array(32);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 1, false);
    view.setUint32(4, 1, false);
    bytes[12] = 1;
    bytes[13] = new TextEncoder().encode('7')[0];
    bytes.set([0xff, 0xd8, 0xff, 0xd9], 28);
    await act(async () => {
      onBinaryMessage?.(bytes.buffer);
      vi.advanceTimersByTime(110);
    });

    expect(useWorkflowStore.getState().latentPreviews).toEqual({});
    expect(useWorkflowStore.getState().latentPreviewByPrompt['p-parked']?.url)
      .toMatch(/^blob:parked-/);
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

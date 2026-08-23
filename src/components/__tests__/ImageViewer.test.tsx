import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageViewer } from '@/components/ImageViewer';
import { deleteFile } from '@/api/client';
import type { HistoryEntry } from '@/hooks/useHistory';

const mocks = vi.hoisted(() => {
  const viewerState: {
    viewerOpen: boolean;
    viewerImages: unknown[];
    viewerIndex: number;
    viewerScale: number;
    viewerTranslate: { x: number; y: number };
    setViewerState?: (next: Record<string, unknown>) => void;
  } = {
    viewerOpen: true,
    viewerImages: [],
    viewerIndex: -1,
    viewerScale: 1,
    viewerTranslate: { x: 0, y: 0 },
  };
  const setViewerState = vi.fn((next: Record<string, unknown>) => {
    Object.assign(viewerState, next);
  });
  viewerState.setViewerState = setViewerState;

  return {
    viewerState,
    setViewerState,
    workflowState: {
      followQueue: true,
      workflow: null,
      originalWorkflow: null,
      sessions: [] as Array<{ id: string }>,
      activeSessionId: null as string | null,
      promptToSession: {} as Record<string, string>,
      workflowDurationStats: {},
      isExecuting: false,
      executingPromptId: null as string | null,
      latentPreviewByPrompt: {} as Record<string, { url: string; seq: number }>,
      loadWorkflow: vi.fn(),
    },
    queueState: {
      running: [] as Array<{ prompt_id: string }>,
      pending: [] as Array<{ prompt_id: string }>,
      localPromptOrder: {} as Record<string, number>,
      livePromptOutputs: {} as Record<string, Array<{ filename: string; subfolder: string; type: string }>>,
      previewVisibility: {} as Record<string, boolean>,
      previewVisibilityDefault: false,
    },
    historyState: {
      history: [] as HistoryEntry[],
      isLoading: false,
      historyLimit: 40,
      hasMoreHistory: true,
      loadMoreHistory: vi.fn(async () => {}),
      deleteItem: vi.fn(),
      removeOutputImages: vi.fn(),
    },
    outputsState: {
      favorites: [] as string[],
      toggleFavorite: vi.fn(),
    },
    navigationState: {
      setCurrentPanel: vi.fn(),
    },
    mediaViewerProps: [] as Array<Record<string, unknown>>,
  };
});

vi.mock('@/components/ImageViewer/MediaViewer', () => ({
  MediaViewer: (props: Record<string, unknown>) => {
    mocks.mediaViewerProps.push(props);
    return null;
  },
}));

vi.mock('@/hooks/useImageViewer', () => ({
  useImageViewerStore: (selector: (state: typeof mocks.viewerState) => unknown) =>
    selector(mocks.viewerState),
}));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: (selector: (state: typeof mocks.workflowState) => unknown) =>
    selector(mocks.workflowState),
  MAX_WORKFLOW_SESSIONS: 3,
  isWorkflowModified: (a: unknown, b: unknown) =>
    Boolean(a && b && JSON.stringify(a) !== JSON.stringify(b)),
}));

vi.mock('@/hooks/useNavigation', () => ({
  useNavigationStore: (selector: (state: typeof mocks.navigationState) => unknown) =>
    selector(mocks.navigationState),
}));

vi.mock('@/hooks/useQueue', () => ({
  useQueueStore: (selector: (state: typeof mocks.queueState) => unknown) =>
    selector(mocks.queueState),
}));

vi.mock('@/hooks/useHistory', () => ({
  useHistoryStore: (selector: (state: typeof mocks.historyState) => unknown) =>
    selector(mocks.historyState),
}));

vi.mock('@/hooks/useOutputs', () => ({
  useOutputsStore: (selector: (state: typeof mocks.outputsState) => unknown) =>
    selector(mocks.outputsState),
}));

vi.mock('@/hooks/useOverallProgress', () => ({
  useOverallProgress: () => 0,
}));

vi.mock('@/hooks/useHistoryWorkflowByFileId', () => ({
  useHistoryWorkflowByFileId: () => new Map(),
}));

vi.mock('@/api/client', () => ({
  deleteFile: vi.fn(),
  getImageUrl: (filename: string, subfolder: string, type: string) =>
    `/api/view?filename=${filename}&subfolder=${subfolder}&type=${type}`,
  getImagePreviewUrl: (filename: string, subfolder: string, type: string) =>
    `/api/view?filename=${filename}&subfolder=${subfolder}&type=${type}&preview=webp;90`,
}));

function makeHistoryEntry(promptId: string, filename = 'first.png'): HistoryEntry {
  return {
    prompt_id: promptId,
    timestamp: Date.now(),
    outputs: {
      images: [
        {
          filename,
          subfolder: '',
          type: 'output',
        },
      ],
    },
    prompt: {},
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('ImageViewer follow queue mode', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.viewerState.viewerOpen = true;
    mocks.viewerState.viewerImages = [];
    mocks.viewerState.viewerIndex = -1;
    mocks.viewerState.viewerScale = 1;
    mocks.viewerState.viewerTranslate = { x: 0, y: 0 };
    mocks.workflowState.followQueue = true;
    mocks.workflowState.isExecuting = false;
    mocks.workflowState.executingPromptId = null;
    mocks.workflowState.latentPreviewByPrompt = {};
    mocks.workflowState.sessions = [];
    mocks.workflowState.activeSessionId = null;
    mocks.workflowState.promptToSession = {};
    mocks.queueState.running = [];
    mocks.queueState.pending = [];
    mocks.queueState.localPromptOrder = {};
    mocks.queueState.livePromptOutputs = {};
    mocks.queueState.previewVisibility = {};
    mocks.queueState.previewVisibilityDefault = false;
    mocks.historyState.history = [];
    mocks.historyState.isLoading = false;
    mocks.historyState.historyLimit = 40;
    mocks.historyState.hasMoreHistory = true;
    mocks.historyState.loadMoreHistory.mockClear();
    mocks.setViewerState.mockClear();
    mocks.historyState.deleteItem.mockClear();
    mocks.historyState.removeOutputImages.mockClear();
    mocks.outputsState.toggleFavorite.mockClear();
    mocks.navigationState.setCurrentPanel.mockClear();
    mocks.mediaViewerProps.length = 0;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('does not auto-jump on a bare history append (no active live output)', async () => {
    // Initial display when follow-queue is opened is seeded by App, not this
    // effect. A history entry appearing on its own (e.g. a refresh, or another
    // client/tab's run landing in ComfyUI's global history) must NOT yank the
    // viewer — only this tab's live completions drive the jump.
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    mocks.historyState.history = [makeHistoryEntry('prompt-1')];
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    const jumped = mocks.setViewerState.mock.calls.some(([next]) => {
      const viewerImages = next.viewerImages as unknown[] | undefined;
      return Array.isArray(viewerImages) && viewerImages.length > 0;
    });
    expect(jumped).toBe(false);
  });

  it('does not treat an older paginated same-session entry as a fresh completion', async () => {
    mocks.workflowState.activeSessionId = 'session-A';
    mocks.workflowState.promptToSession = {
      visible: 'session-A',
      older: 'session-A',
    };
    mocks.historyState.history = [makeHistoryEntry('visible', 'visible.png')];
    mocks.viewerState.viewerImages = [makeViewerImage('visible', 'visible.png')];
    mocks.viewerState.viewerIndex = 0;

    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();
    mocks.setViewerState.mockClear();

    // Loading another page adds this old mapped prompt at the tail. Retained
    // prompt routing alone must not make it a Follow Queue event.
    mocks.historyState.history = [
      ...mocks.historyState.history,
      makeHistoryEntry('older', 'older.png'),
    ];
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    const jumpedToOlder = mocks.setViewerState.mock.calls.some(([next]) => {
      const images = next.viewerImages as Array<Record<string, unknown>> | undefined;
      return next.viewerIndex === 0 && images?.[0]?.filename === 'older.png';
    });
    expect(jumpedToOlder).toBe(false);
  });

  it('displays a followed output that already existed when follow mode opened', async () => {
    // Empty history (nothing for App to seed) + an output that landed before the
    // viewer opened: the activation seed used to swallow this key, leaving the
    // loading placeholder up forever with no path out of the empty state.
    mocks.queueState.localPromptOrder = { 'prompt-1': 1 };
    mocks.queueState.livePromptOutputs = {
      'prompt-1': [{ filename: 'first.png', subfolder: '', type: 'output' }],
    };

    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    const viewerUpdate = mocks.setViewerState.mock.calls.find(([next]) => {
      const viewerImages = next.viewerImages as unknown[] | undefined;
      return Array.isArray(viewerImages) && viewerImages.length > 0;
    })?.[0];

    expect(viewerUpdate).toBeDefined();
    expect(viewerUpdate?.viewerIndex).toBe(0);
    expect((viewerUpdate?.viewerImages as Array<Record<string, unknown>>)[0]).toMatchObject({
      filename: 'first.png',
      promptId: 'prompt-1',
    });
  });

  it('paints the running prompt latent preview while there is nothing to display', async () => {
    mocks.workflowState.isExecuting = true;
    mocks.workflowState.executingPromptId = 'prompt-1';
    mocks.workflowState.latentPreviewByPrompt = {
      'prompt-1': { url: 'blob:latent-frame-1', seq: 7 },
    };

    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    const props = mocks.mediaViewerProps.at(-1) as Record<string, unknown>;
    expect(props.showLoadingPlaceholder).toBe(true);
    expect(props.loadingPreviewSrc).toBe('blob:latent-frame-1');
  });

  it('never covers a displayed output with a latent preview', async () => {
    mocks.workflowState.isExecuting = true;
    mocks.workflowState.executingPromptId = 'prompt-2';
    mocks.workflowState.latentPreviewByPrompt = {
      'prompt-2': { url: 'blob:latent-frame-2', seq: 2 },
    };
    mocks.viewerState.viewerImages = [makeViewerImage('prompt-1')];
    mocks.viewerState.viewerIndex = 0;

    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    const props = mocks.mediaViewerProps.at(-1) as Record<string, unknown>;
    expect(props.showLoadingPlaceholder).toBe(false);
    expect(props.loadingPreviewSrc).toBeNull();
  });

  it('follows a history output for a prompt observed in the queue on this device', async () => {
    mocks.queueState.running = [{ prompt_id: 'external-prompt' }];
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    mocks.queueState.running = [];
    mocks.historyState.history = [makeHistoryEntry('external-prompt')];
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    const viewerUpdate = mocks.setViewerState.mock.calls.find(([next]) => {
      const viewerImages = next.viewerImages as Array<Record<string, unknown>> | undefined;
      return Array.isArray(viewerImages) && viewerImages.some((entry) => entry.filename === 'first.png');
    })?.[0];

    expect(viewerUpdate).toBeDefined();
    expect((viewerUpdate?.viewerImages as Array<Record<string, unknown>>)[0]).toMatchObject({
      filename: 'first.png',
      promptId: 'external-prompt',
    });
  });

  it('follows a session-owned completion when the live-to-history handoff is batched away', async () => {
    // A fast history refresh can add the completed entry and clear the queue's
    // live/pending maps before React commits an intermediate render. The prompt
    // is still known to belong to this workflow session, so Follow Queue must
    // not mistake it for unrelated history and remain stuck on the old image.
    mocks.workflowState.activeSessionId = 'session-A';
    mocks.viewerState.viewerImages = [makeViewerImage('old-prompt')];
    mocks.viewerState.viewerIndex = 0;
    mocks.historyState.history = [makeHistoryEntry('old-prompt')];

    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();
    mocks.setViewerState.mockClear();

    // Final post-refresh state only: there is no render where the new prompt is
    // still running or has a live output for the old tracking effect to catch.
    mocks.workflowState.promptToSession = { 'new-prompt': 'session-A' };
    mocks.historyState.history = [
      makeHistoryEntry('new-prompt', 'new.png'),
      makeHistoryEntry('old-prompt'),
    ];
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    const jumpedToNew = mocks.setViewerState.mock.calls.some(([next]) => {
      const viewerImages = next.viewerImages as Array<Record<string, unknown>> | undefined;
      return viewerImages?.[0]?.filename === 'new.png';
    });
    expect(jumpedToNew).toBe(true);
  });

  it('reconsiders history when its session routing arrives one render later', async () => {
    mocks.workflowState.activeSessionId = 'session-A';
    mocks.viewerState.viewerImages = [makeViewerImage('old-prompt')];
    mocks.viewerState.viewerIndex = 0;
    mocks.historyState.history = [makeHistoryEntry('old-prompt')];

    const render = async () => {
      await act(async () => {
        root.render(<ImageViewer onClose={() => {}} />);
      });
      await flushEffects();
    };

    await render();
    mocks.setViewerState.mockClear();

    // History polling wins the race, after the prompt has already disappeared
    // from running/pending but before queueWorkflow publishes its session map.
    mocks.historyState.history = [
      makeHistoryEntry('new-prompt', 'new.png'),
      makeHistoryEntry('old-prompt'),
    ];
    await render();
    expect(mocks.setViewerState.mock.calls.some(([next]) => (
      (next.viewerImages as Array<Record<string, unknown>> | undefined)?.[0]?.filename === 'new.png'
    ))).toBe(false);

    // The next store update supplies the missing ownership information. The
    // same history id must still be eligible for following at this point.
    mocks.workflowState.promptToSession = { 'new-prompt': 'session-A' };
    await render();

    expect(mocks.setViewerState.mock.calls.some(([next]) => (
      (next.viewerImages as Array<Record<string, unknown>> | undefined)?.[0]?.filename === 'new.png'
    ))).toBe(true);
  });

  it('follows an older pending prompt after a prepended prompt overtakes it', async () => {
    const render = async () => {
      await act(async () => {
        root.render(<ImageViewer onClose={() => {}} />);
      });
      await flushEffects();
    };
    const lastJumpFilename = () => {
      const updates = mocks.setViewerState.mock.calls
        .map(([next]) => next)
        .filter((next) => Array.isArray(next.viewerImages) && next.viewerIndex === 0);
      const images = updates.at(-1)?.viewerImages as Array<Record<string, unknown>> | undefined;
      return images?.[0]?.filename ?? null;
    };

    mocks.historyState.history = [makeHistoryEntry('old', 'old.png')];
    mocks.viewerState.viewerImages = [makeViewerImage('old', 'old.png')];
    mocks.viewerState.viewerIndex = 0;
    mocks.queueState.pending = [{ prompt_id: 'append-first' }];
    mocks.queueState.localPromptOrder = { 'append-first': 1 };
    await render();

    // This prompt was submitted later but ComfyUI executes it first because it
    // was put at the front. Merely seeing both prompts pending must not freeze
    // their eventual completion order.
    mocks.queueState.running = [{ prompt_id: 'front' }];
    mocks.queueState.pending = [{ prompt_id: 'append-first' }];
    mocks.queueState.localPromptOrder = { 'append-first': 1, front: 2 };
    await render();
    mocks.queueState.livePromptOutputs = {
      front: [{ filename: 'front.png', subfolder: '', type: 'output' }],
    };
    await render();
    expect(lastJumpFilename()).toBe('front.png');

    // The original pending prompt now completes after the front item. Follow
    // Queue must advance again even though it was submitted/observed earlier.
    mocks.historyState.history = [
      makeHistoryEntry('front', 'front.png'),
      ...mocks.historyState.history,
    ];
    mocks.queueState.running = [{ prompt_id: 'append-first' }];
    mocks.queueState.pending = [];
    mocks.queueState.livePromptOutputs = {};
    await render();
    mocks.queueState.livePromptOutputs = {
      'append-first': [{ filename: 'append-first.png', subfolder: '', type: 'output' }],
    };
    await render();

    expect(lastJumpFilename()).toBe('append-first.png');
  });

  it('shows live video outputs before history refresh when follow queue is active', async () => {
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    mocks.queueState.running = [{ prompt_id: 'prompt-video' }];
    mocks.queueState.localPromptOrder = { 'prompt-video': 1 };
    mocks.queueState.livePromptOutputs = {
      'prompt-video': [
        {
          filename: 'clip.mp4',
          subfolder: 'video',
          type: 'output',
        },
      ],
    };
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    const viewerUpdate = mocks.setViewerState.mock.calls.find(([next]) => {
      const viewerImages = next.viewerImages as unknown[] | undefined;
      return Array.isArray(viewerImages) && viewerImages.some((entry) => (
        (entry as Record<string, unknown>).filename === 'clip.mp4'
      ));
    })?.[0];

    expect(viewerUpdate).toBeDefined();
    expect((viewerUpdate?.viewerImages as Array<Record<string, unknown>>)[0]).toMatchObject({
      filename: 'clip.mp4',
      mediaType: 'video',
      promptId: 'prompt-video',
      file: expect.objectContaining({
        id: 'output/video/clip.mp4',
        type: 'video',
      }),
    });
  });

  it('ignores live preview/temp images and only follows completed outputs', async () => {
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    // Mid-run: a PreviewImage node has emitted a temp preview, no output yet.
    mocks.queueState.running = [{ prompt_id: 'prompt-1' }];
    mocks.queueState.localPromptOrder = { 'prompt-1': 1 };
    mocks.queueState.livePromptOutputs = {
      'prompt-1': [
        { filename: 'preview.png', subfolder: '', type: 'temp' },
      ],
    };
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    // No viewer jump should have happened while only a preview exists.
    const previewJump = mocks.setViewerState.mock.calls.find(([next]) => {
      const viewerImages = next.viewerImages as Array<Record<string, unknown>> | undefined;
      return Array.isArray(viewerImages) && viewerImages.some((entry) => entry.filename === 'preview.png');
    });
    expect(previewJump).toBeUndefined();

    // The SaveImage node finishes and emits the final output.
    mocks.queueState.livePromptOutputs = {
      'prompt-1': [
        { filename: 'preview.png', subfolder: '', type: 'temp' },
        { filename: 'final.png', subfolder: '', type: 'output' },
      ],
    };
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    const viewerUpdate = mocks.setViewerState.mock.calls.find(([next]) => {
      const viewerImages = next.viewerImages as Array<Record<string, unknown>> | undefined;
      return Array.isArray(viewerImages) && viewerImages.length > 0;
    })?.[0];

    expect(viewerUpdate).toBeDefined();
    const viewerImages = viewerUpdate?.viewerImages as Array<Record<string, unknown>>;
    expect(viewerImages.every((entry) => entry.filename !== 'preview.png')).toBe(true);
    expect(viewerImages[0]).toMatchObject({
      filename: 'final.png',
      promptId: 'prompt-1',
    });
  });

  it('does not jump to a live output produced by another session', async () => {
    mocks.workflowState.activeSessionId = 'session-A';
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    // A run completes in session B (the inactive tab) while we follow session A.
    mocks.workflowState.promptToSession = { 'prompt-b': 'session-B' };
    mocks.queueState.localPromptOrder = { 'prompt-b': 1 };
    mocks.queueState.livePromptOutputs = {
      'prompt-b': [{ filename: 'from-b.png', subfolder: '', type: 'output' }],
    };
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    const jumpedToB = mocks.setViewerState.mock.calls.some(([next]) => {
      const viewerImages = next.viewerImages as Array<Record<string, unknown>> | undefined;
      return Array.isArray(viewerImages) && viewerImages.some((e) => e.filename === 'from-b.png');
    });
    expect(jumpedToB).toBe(false);

    // The active session (A) then produces its own output → we follow it.
    mocks.workflowState.promptToSession = {
      'prompt-b': 'session-B',
      'prompt-a': 'session-A',
    };
    mocks.queueState.localPromptOrder = { 'prompt-b': 1, 'prompt-a': 2 };
    mocks.queueState.livePromptOutputs = {
      'prompt-b': [{ filename: 'from-b.png', subfolder: '', type: 'output' }],
      'prompt-a': [{ filename: 'from-a.png', subfolder: '', type: 'output' }],
    };
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    const viewerUpdate = mocks.setViewerState.mock.calls.find(([next]) => {
      const viewerImages = next.viewerImages as Array<Record<string, unknown>> | undefined;
      return Array.isArray(viewerImages) && viewerImages.length > 0;
    })?.[0];
    expect(viewerUpdate).toBeDefined();
    // Active session's output leads the list, so index 0 is from-a.png.
    expect((viewerUpdate?.viewerImages as Array<Record<string, unknown>>)[0]).toMatchObject({
      filename: 'from-a.png',
      promptId: 'prompt-a',
    });
  });

  function makeViewerImage(promptId?: string, filename = 'first.png') {
    return {
      src: `/api/view?filename=${filename}&subfolder=&type=output`,
      alt: 'x',
      mediaType: 'image' as const,
      promptId,
      filename,
      file: {
        id: `output/${filename}`,
        name: filename,
        type: 'image' as const,
        fullUrl: `/api/view?filename=${filename}&subfolder=&type=output`,
      },
    };
  }

  it('loads more history near the end of a queue viewer even when follow mode is off', async () => {
    mocks.workflowState.followQueue = false;
    mocks.historyState.history = Array.from({ length: 40 }, (_, index) =>
      makeHistoryEntry(`prompt-${index}`, `image-${index}.png`));
    mocks.viewerState.viewerImages = Array.from({ length: 40 }, (_, index) =>
      makeViewerImage(`prompt-${index}`, `image-${index}.png`));
    mocks.viewerState.viewerIndex = 36;

    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    const props = mocks.mediaViewerProps.at(-1) as {
      onIndexChange?: (nextIndex: number) => void;
    };
    await act(async () => {
      props.onIndexChange?.(37);
    });
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    expect(mocks.historyState.loadMoreHistory).toHaveBeenCalledWith(5);

    mocks.setViewerState.mockClear();
    mocks.historyState.historyLimit = 45;
    mocks.historyState.history = [
      makeHistoryEntry('newly-completed', 'newly-completed.png'),
      ...mocks.historyState.history,
      ...Array.from({ length: 4 }, (_, offset) => {
        const index = 40 + offset;
        return makeHistoryEntry(`prompt-${index}`, `image-${index}.png`);
      }),
    ];
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    const expandedImages = mocks.setViewerState.mock.calls
      .map(([next]) => next.viewerImages as Array<Record<string, unknown>> | undefined)
      .find((viewerImages) => viewerImages?.length === 44);
    expect(expandedImages?.[43]?.filename).toBe('image-43.png');
    expect(expandedImages?.some((image) => image.filename === 'newly-completed.png')).toBe(false);
    expect(mocks.viewerState.viewerIndex).toBe(37);
  });

  async function confirmDeleteFromViewer(item: ReturnType<typeof makeViewerImage>) {
    // Drive the delete: MediaViewer's onDelete sets the target, then the
    // confirmation Dialog's "Delete" action runs handleDeleteConfirm.
    const props = mocks.mediaViewerProps.at(-1) as { onDelete?: (i: unknown) => void };
    await act(async () => {
      props.onDelete?.(item);
    });
    const deleteButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Delete',
    );
    if (!deleteButton) throw new Error('Delete confirmation button not found');
    await act(async () => {
      deleteButton.click();
    });
    await flushEffects();
  }

  it('reconciles history by file id when deleting an associated image', async () => {
    mocks.workflowState.followQueue = false;
    // A multi-output run: deleting one image reconciles by file id, so the card
    // keeps its sibling and is only removed once its last image is gone. The
    // viewer hands removeOutputImages the deleted file's id.
    mocks.historyState.history = [
      {
        prompt_id: 'prompt-del',
        timestamp: Date.now(),
        outputs: {
          images: [
            { filename: 'first.png', subfolder: '', type: 'output' },
            { filename: 'second.png', subfolder: '', type: 'output' },
          ],
        },
        prompt: {},
      },
    ];
    mocks.viewerState.viewerImages = [makeViewerImage('prompt-del')];
    mocks.viewerState.viewerIndex = 0;

    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    await confirmDeleteFromViewer(makeViewerImage('prompt-del'));

    expect(vi.mocked(deleteFile)).toHaveBeenCalledWith('first.png', 'output');
    expect(mocks.historyState.removeOutputImages).toHaveBeenCalledWith(['output/first.png']);
  });

  it('reconciles history by file id even when the image has no associated run', async () => {
    mocks.workflowState.followQueue = false;
    mocks.viewerState.viewerImages = [makeViewerImage(undefined)];
    mocks.viewerState.viewerIndex = 0;

    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    await confirmDeleteFromViewer(makeViewerImage(undefined));

    expect(vi.mocked(deleteFile)).toHaveBeenCalledWith('first.png', 'output');
    // Keyed by file id, so it still reconciles (a browsed output may be in
    // history) — promptId is no longer required.
    expect(mocks.historyState.removeOutputImages).toHaveBeenCalledWith(['output/first.png']);
  });

  it('follows each generation across an infinite-loop sequence', async () => {
    const render = async () => {
      await act(async () => {
        root.render(<ImageViewer onClose={() => {}} />);
      });
      await flushEffects();
    };
    const lastJumpFilename = () => {
      const updates = mocks.setViewerState.mock.calls
        .map(([next]) => next.viewerImages as Array<Record<string, unknown>> | undefined)
        .filter((imgs): imgs is Array<Record<string, unknown>> => Array.isArray(imgs) && imgs.length > 0);
      return updates.length > 0 ? updates[updates.length - 1][0].filename : null;
    };

    // Viewer opened mid-run of P1 with follow active.
    mocks.queueState.running = [{ prompt_id: 'p1' }];
    mocks.queueState.localPromptOrder = { p1: 1 };
    await render();

    // P1's SaveImage emits its output over the websocket.
    mocks.queueState.livePromptOutputs = {
      p1: [{ filename: 'gen-1.png', subfolder: '', type: 'output' }],
    };
    await render();
    expect(lastJumpFilename()).toBe('gen-1.png');

    // executing(null): P1 leaves running; the infinite loop re-enqueues P2.
    mocks.queueState.running = [];
    await render();
    mocks.queueState.running = [{ prompt_id: 'p2' }];
    mocks.queueState.localPromptOrder = { p1: 1, p2: 2 };
    await render();

    // P1's authoritative history record lands (live item now dedupes away).
    mocks.historyState.history = [
      {
        prompt_id: 'p1',
        timestamp: Date.now(),
        outputs: { images: [{ filename: 'gen-1.png', subfolder: '', type: 'output' }] },
        prompt: {},
      },
    ];
    await render();

    // P2 completes.
    mocks.queueState.livePromptOutputs = {
      p1: [{ filename: 'gen-1.png', subfolder: '', type: 'output' }],
      p2: [{ filename: 'gen-2.png', subfolder: '', type: 'output' }],
    };
    await render();
    expect(lastJumpFilename()).toBe('gen-2.png');

    // Loop continues: P3 enqueued, P2's history lands, P3 completes.
    mocks.queueState.running = [{ prompt_id: 'p3' }];
    mocks.queueState.localPromptOrder = { p1: 1, p2: 2, p3: 3 };
    await render();
    mocks.historyState.history = [
      {
        prompt_id: 'p2',
        timestamp: Date.now(),
        outputs: { images: [{ filename: 'gen-2.png', subfolder: '', type: 'output' }] },
        prompt: {},
      },
      ...mocks.historyState.history,
    ];
    await render();
    mocks.queueState.running = [];
    mocks.queueState.livePromptOutputs = {
      p1: [{ filename: 'gen-1.png', subfolder: '', type: 'output' }],
      p2: [{ filename: 'gen-2.png', subfolder: '', type: 'output' }],
      p3: [{ filename: 'gen-3.png', subfolder: '', type: 'output' }],
    };
    await render();
    expect(lastJumpFilename()).toBe('gen-3.png');
  });

  it('keeps a finished live video ahead of older live outputs after running clears', async () => {
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    mocks.queueState.running = [{ prompt_id: 'prompt-video' }];
    mocks.queueState.localPromptOrder = {
      'prompt-old': 1,
      'prompt-video': 2,
    };
    mocks.queueState.livePromptOutputs = {
      'prompt-old': [
        {
          filename: 'old.png',
          subfolder: '',
          type: 'output',
        },
      ],
      'prompt-video': [
        {
          filename: 'clip.mp4',
          subfolder: 'video',
          type: 'output',
        },
      ],
    };
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    mocks.queueState.running = [];
    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    const viewerImageUpdates = mocks.setViewerState.mock.calls
      .map(([next]) => next.viewerImages as Array<Record<string, unknown>> | undefined)
      .filter((viewerImages): viewerImages is Array<Record<string, unknown>> => Array.isArray(viewerImages));

    expect(viewerImageUpdates.length).toBeGreaterThan(0);
    expect(viewerImageUpdates[viewerImageUpdates.length - 1][0]).toMatchObject({
      filename: 'clip.mp4',
      mediaType: 'video',
      promptId: 'prompt-video',
    });
  });

  it('does not fall back to an older image when the newer prompt\'s history syncs first', async () => {
    // Regression: two prompts finish; the NEWER one's history record lands before
    // the older one's. markPromptCompleted then deletes the newer prompt's live
    // outputs, so it lives only in history while the older prompt is still live.
    // The follow selector must not prefer the stale live item and yank back to the
    // older image — "newest" must span live AND history via one completion order.
    const render = async () => {
      await act(async () => {
        root.render(<ImageViewer onClose={() => {}} />);
      });
      await flushEffects();
    };
    const jumpFilenames = () =>
      mocks.setViewerState.mock.calls
        .map(([next]) => next.viewerImages as Array<Record<string, unknown>> | undefined)
        .filter((imgs): imgs is Array<Record<string, unknown>> => Array.isArray(imgs) && imgs.length > 0)
        .map((imgs) => imgs[0].filename);

    await render();

    // Both prompts complete over the websocket; p2 is newer (higher order).
    mocks.queueState.localPromptOrder = { p1: 1, p2: 2 };
    mocks.queueState.livePromptOutputs = {
      p1: [{ filename: 'gen-1.png', subfolder: '', type: 'output' }],
      p2: [{ filename: 'gen-2.png', subfolder: '', type: 'output' }],
    };
    await render();
    // Followed the newest.
    expect(jumpFilenames().at(-1)).toBe('gen-2.png');

    // p2's history lands FIRST and its live outputs are dropped (handoff). p1 is
    // still live (its history hasn't synced yet).
    mocks.historyState.history = [
      {
        prompt_id: 'p2',
        timestamp: Date.now(),
        outputs: { images: [{ filename: 'gen-2.png', subfolder: '', type: 'output' }] },
        prompt: {},
      },
    ];
    mocks.queueState.livePromptOutputs = {
      p1: [{ filename: 'gen-1.png', subfolder: '', type: 'output' }],
    };
    await render();

    // Must NOT have yanked back to the older gen-1 image at any point.
    expect(jumpFilenames()).not.toContain('gen-1.png');
    expect(jumpFilenames().at(-1)).toBe('gen-2.png');
  });
});

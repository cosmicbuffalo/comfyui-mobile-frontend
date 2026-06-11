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
      executingPromptId: null,
      loadWorkflow: vi.fn(),
    },
    queueState: {
      running: [] as Array<{ prompt_id: string }>,
      pending: [] as Array<{ prompt_id: string }>,
      localPromptOrder: {} as Record<string, number>,
      livePromptOutputs: {} as Record<string, Array<{ filename: string; subfolder: string; type: string }>>,
    },
    historyState: {
      history: [] as HistoryEntry[],
      deleteItem: vi.fn(),
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

function makeHistoryEntry(promptId: string): HistoryEntry {
  return {
    prompt_id: promptId,
    timestamp: Date.now(),
    outputs: {
      images: [
        {
          filename: 'first.png',
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
    mocks.workflowState.sessions = [];
    mocks.workflowState.activeSessionId = null;
    mocks.workflowState.promptToSession = {};
    mocks.queueState.running = [];
    mocks.queueState.pending = [];
    mocks.queueState.localPromptOrder = {};
    mocks.queueState.livePromptOutputs = {};
    mocks.historyState.history = [];
    mocks.setViewerState.mockClear();
    mocks.historyState.deleteItem.mockClear();
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

  function makeViewerImage(promptId?: string) {
    return {
      src: '/api/view?filename=first.png&subfolder=&type=output',
      alt: 'x',
      mediaType: 'image' as const,
      promptId,
      filename: 'first.png',
      file: {
        id: 'output/first.png',
        name: 'first.png',
        type: 'image' as const,
        fullUrl: '/api/view?filename=first.png&subfolder=&type=output',
      },
    };
  }

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

  it('deletes the run\'s history entry when deleting an associated image', async () => {
    mocks.workflowState.followQueue = false;
    // A multi-output run: the whole card should still be removed on a single
    // image delete (we no longer keep it around for the siblings).
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
    expect(mocks.historyState.deleteItem).toHaveBeenCalledWith('prompt-del');
  });

  it('does not delete any history entry when the image has no associated run', async () => {
    mocks.workflowState.followQueue = false;
    mocks.viewerState.viewerImages = [makeViewerImage(undefined)];
    mocks.viewerState.viewerIndex = 0;

    await act(async () => {
      root.render(<ImageViewer onClose={() => {}} />);
    });
    await flushEffects();

    await confirmDeleteFromViewer(makeViewerImage(undefined));

    expect(vi.mocked(deleteFile)).toHaveBeenCalledWith('first.png', 'output');
    expect(mocks.historyState.deleteItem).not.toHaveBeenCalled();
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
});

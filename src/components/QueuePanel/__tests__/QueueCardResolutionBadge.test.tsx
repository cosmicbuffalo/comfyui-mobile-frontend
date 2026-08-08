import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedItem } from '../types';

const mocks = vi.hoisted(() => ({
  dimensions: {} as Record<string, { width: number; height: number }>,
  queueState: {
    previewVisibility: {},
    previewVisibilityDefault: true,
    showQueueMetadata: false,
    showQueueTimestamps: false,
    showPromptPreview: false,
    queueOutputLayout: 'tabbed' as string,
    queueItemExpanded: { 'done-prompt': true } as Record<string, boolean>,
    queueItemUserToggled: {},
    queueItemHideImages: {},
    completionDurations: {},
    completing: [],
    autoRestoredPromptIds: {},
    queueMetadata: {},
    setQueueItemExpanded: vi.fn(),
    setQueueItemUserToggled: vi.fn(),
  },
  outputsState: { favorites: [], rejected: [] },
  workflowState: {
    promptToSession: {},
    sessions: [],
    activeSessionId: null,
    parkedSessions: {},
    currentFilename: null,
    workflowSource: null,
    latentPreviewByPrompt: {},
  },
}));

vi.mock('@/hooks/useQueue', () => ({
  useQueueStore: (selector: (s: typeof mocks.queueState) => unknown) => selector(mocks.queueState),
}));
vi.mock('@/hooks/useOutputs', () => ({
  useOutputsStore: (selector: (s: typeof mocks.outputsState) => unknown) => selector(mocks.outputsState),
}));
vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: (selector: (s: typeof mocks.workflowState) => unknown) => selector(mocks.workflowState),
}));
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    getFileDimensions: vi.fn(async () => mocks.dimensions),
  };
});

import { getFileDimensions } from '@/api/client';
import { QueueCard } from '../QueueCard';

const doneItem: UnifiedItem = {
  id: 'done-prompt',
  status: 'done',
  data: {
    prompt_id: 'done-prompt',
    timestamp: 1,
    outputs: { images: [{ filename: 'big.png', subfolder: '', type: 'output' }] },
    prompt: {},
    success: true,
  } as never,
};

// The card renders a 1280-capped preview, so anything measured from the element
// is the preview's size for a larger output. The badge must state the real size
// or none at all.
describe('QueueCard resolution badge', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.dimensions = {};
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const render = () =>
    act(async () => {
      root.render(
        <QueueCard
          item={doneItem}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[] as never}
          onOpenMenu={() => {}}
          isTopDoneItem
        />,
      );
      await Promise.resolve();
    });

  it('shows the server-reported size for an output larger than the preview cap', async () => {
    mocks.dimensions = { 'big.png': { width: 1920, height: 1080 } };

    await render();
    await act(async () => { await Promise.resolve(); });

    const badge = container.querySelector('.resolution-badge');
    expect(badge).not.toBeNull();
    expect(badge?.textContent?.replace(/\s/g, '')).toContain('1920');
    expect(badge?.textContent?.replace(/\s/g, '')).toContain('1080');
  });

  it('labels a PreviewImage output, which the backend writes as type "temp"', async () => {
    // Restricting the dimension fetch to type 'output' silently dropped the
    // badge from every PreviewImage card, which carried one before.
    const tempItem: UnifiedItem = {
      ...doneItem,
      data: {
        ...(doneItem.data as unknown as Record<string, unknown>),
        outputs: { images: [{ filename: 'preview.png', subfolder: '', type: 'temp' }] },
      } as never,
    };
    mocks.dimensions = { 'preview.png': { width: 1920, height: 1080 } };

    await act(async () => {
      root.render(
        <QueueCard
          item={tempItem}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[] as never}
          onOpenMenu={() => {}}
          isTopDoneItem
        />,
      );
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });

    expect(vi.mocked(getFileDimensions)).toHaveBeenCalledWith('temp', ['preview.png']);
    const badge = container.querySelector('.resolution-badge');
    expect(badge?.textContent?.replace(/\s/g, '')).toContain('1920');
  });

  it('asks for nothing while the card is collapsed', async () => {
    // A long history is mostly collapsed cards; none of them can show a badge.
    mocks.queueState.queueItemExpanded = {};
    vi.mocked(getFileDimensions).mockClear();

    await render();
    await act(async () => { await Promise.resolve(); });

    expect(vi.mocked(getFileDimensions)).not.toHaveBeenCalled();
    mocks.queueState.queueItemExpanded = { 'done-prompt': true };
  });

  it('shows no badge rather than the capped preview size', async () => {
    // Server has nothing for this file, and nothing has been measured under the
    // cap — better silent than wrong.
    mocks.dimensions = {};

    await render();
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('.resolution-badge')).toBeNull();
  });
});

describe('QueueCard default expansion', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('writes its default once, even if the stored entry disappears', async () => {
    // The store caps these maps, so a queue with more mounted cards than the
    // cap evicts a live card's key. Writing the default back would evict
    // another live card, whose write evicts the next — a cycle with no end.
    mocks.queueState.queueItemExpanded = {};
    const setExpanded = vi.fn();
    mocks.queueState.setQueueItemExpanded = setExpanded;

    const render = () =>
      act(async () => {
        root.render(
          <QueueCard
            item={doneItem}
            isActuallyRunning={false}
            progress={0}
            viewerImages={[]}
            runningImages={[] as never}
            onOpenMenu={() => {}}
            isTopDoneItem
          />,
        );
        await Promise.resolve();
      });

    await render();
    expect(setExpanded).toHaveBeenCalledTimes(1);

    // That write lands in the store...
    mocks.queueState.queueItemExpanded = { 'done-prompt': false };
    await render();
    // ...and is then evicted by another card's write, while this card is still
    // mounted. Rewriting it here is what makes the cycle self-sustaining.
    mocks.queueState.queueItemExpanded = {};
    await render();

    expect(setExpanded).toHaveBeenCalledTimes(1);
    mocks.queueState.queueItemExpanded = { 'done-prompt': true };
    mocks.queueState.setQueueItemExpanded = vi.fn();
  });
});

describe('QueueCard resolution badge for videos', () => {
  let container: HTMLDivElement;
  let root: Root;

  const videoItem: UnifiedItem = {
    ...doneItem,
    data: {
      ...(doneItem.data as unknown as Record<string, unknown>),
      outputs: { images: [{ filename: 'clip.mp4', subfolder: '', type: 'output' }] },
    } as never,
  };

  beforeEach(() => {
    mocks.dimensions = {};
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const renderVideo = async () => {
    await act(async () => {
      root.render(
        <QueueCard
          item={videoItem}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[] as never}
          onOpenMenu={() => {}}
          isTopDoneItem
        />,
      );
      await Promise.resolve();
    });
  };

  it('never labels a video with its poster thumbnail size', async () => {
    // The poster is a ~300px still. Recording it put a "300 x 300" badge on
    // 1080p videos, and the sticky-exact rule then refused the real value.
    await renderVideo();
    const poster = container.querySelector('img');
    expect(poster).not.toBeNull();
    Object.defineProperty(poster!, 'naturalWidth', { value: 300, configurable: true });
    Object.defineProperty(poster!, 'naturalHeight', { value: 300, configurable: true });

    await act(async () => {
      poster!.dispatchEvent(new Event('load', { bubbles: false }));
      await Promise.resolve();
    });

    expect(container.querySelector('.resolution-badge')).toBeNull();
  });

  it('still records the poster aspect ratio the stacked layout sizes by', async () => {
    // Suppressing the poster's size must not suppress its shape: the desktop
    // stacked row derives each output's flex-basis from this and falls back to
    // a square, which stretches every video.
    mocks.queueState.queueOutputLayout = 'stacked';
    // The stacked row is the desktop layout; jsdom has no matchMedia.
    window.matchMedia = ((query: string) => ({
      matches: query.includes('min-width: 1024px'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    await renderVideo();
    const poster = container.querySelector('img');
    Object.defineProperty(poster!, 'naturalWidth', { value: 300, configurable: true });
    Object.defineProperty(poster!, 'naturalHeight', { value: 168, configurable: true });

    await act(async () => {
      poster!.dispatchEvent(new Event('load', { bubbles: false }));
      await Promise.resolve();
    });

    const sized = container.querySelector<HTMLElement>('[style*="--queue-media-max-height"]');
    expect(sized?.style.flexBasis).toContain(`${300 / 168}`);
    expect(container.querySelector('.resolution-badge')).toBeNull();
    mocks.queueState.queueOutputLayout = 'tabbed';
  });
});

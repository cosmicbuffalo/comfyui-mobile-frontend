import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedItem } from '../types';

const mocks = vi.hoisted(() => ({
  queueState: {
    previewVisibility: {},
    previewVisibilityDefault: true,
    showQueueMetadata: false,
    showQueueTimestamps: false,
    showPromptPreview: false,
    queueItemExpanded: { 'video-prompt': true },
    queueItemUserToggled: {},
    queueItemHideImages: {},
    completionDurations: {},
    completing: [],
    autoRestoredPromptIds: {},
    queueMetadata: {},
    setQueueItemExpanded: vi.fn(),
    setQueueItemUserToggled: vi.fn(),
  },
  outputsState: {
    favorites: [],
  },
  workflowState: {
    promptToSession: {},
    sessions: [],
    activeSessionId: null,
    parkedSessions: {},
    currentFilename: null,
    workflowSource: null,
  },
}));

vi.mock('@/hooks/useQueue', () => ({
  useQueueStore: (selector: (state: typeof mocks.queueState) => unknown) =>
    selector(mocks.queueState),
}));

vi.mock('@/hooks/useOutputs', () => ({
  useOutputsStore: (selector: (state: typeof mocks.outputsState) => unknown) =>
    selector(mocks.outputsState),
}));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: (selector: (state: typeof mocks.workflowState) => unknown) =>
    selector(mocks.workflowState),
}));

import { QueueCard } from '../QueueCard';

const videoOutput = { filename: 'clip.mp4', subfolder: 'video', type: 'output' };
const imageOutput = { filename: 'still.png', subfolder: 'images', type: 'output' };
const liveOutputs = [videoOutput, imageOutput];

const item: UnifiedItem = {
  id: 'video-prompt',
  status: 'done',
  data: {
    prompt_id: 'video-prompt',
    timestamp: 1,
    outputs: {
      images: [imageOutput, videoOutput],
    },
    prompt: {},
  },
};

const runningItem: UnifiedItem = {
  id: 'video-prompt',
  status: 'running',
  data: {
    number: 1,
    prompt_id: 'video-prompt',
    prompt: {},
    extra: {},
    outputs_to_execute: [],
  },
};

describe('QueueCard video replay overlay', () => {
  let container: HTMLDivElement;
  let root: Root;
  const preloadedImages: Array<{
    onload: (() => void) | null;
    onerror: (() => void) | null;
    src: string;
  }> = [];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    preloadedImages.length = 0;
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = '';
      complete = false;
      naturalWidth = 0;

      constructor() {
        preloadedImages.push(this);
      }

      decode() {
        return Promise.resolve();
      }
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps a websocket preview mounted until the final image is decoded', async () => {
    const preview = { filename: 'preview.png', subfolder: '', type: 'temp' };
    const final = { filename: 'final.png', subfolder: '', type: 'output' };
    const finalItem: UnifiedItem = {
      ...item,
      data: {
        ...item.data,
        outputs: { images: [final] },
      },
    };

    await act(async () => {
      root.render(
        <QueueCard
          item={runningItem}
          isActuallyRunning={true}
          progress={0}
          viewerImages={[]}
          runningImages={[preview]}
          onOpenMenu={() => {}}
          downloaded={{}}
          isTopDoneItem={false}
        />,
      );
    });
    const previewElement = container.querySelector('img');
    expect(previewElement?.getAttribute('src')).toContain('preview.png');

    await act(async () => {
      root.render(
        <QueueCard
          item={finalItem}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          downloaded={{}}
          isTopDoneItem={true}
        />,
      );
    });

    expect(container.querySelector('img')).toBe(previewElement);
    expect(preloadedImages).toHaveLength(1);
    expect(preloadedImages[0]?.src).toContain('final.png');

    await act(async () => {
      preloadedImages[0]?.onload?.();
    });

    expect(container.querySelector('img')).not.toBe(previewElement);
    expect(container.querySelector('img')?.getAttribute('src')).toContain('final.png');
  });

  it('keeps the selected video playing when finalized history arrives in another order', async () => {
    // Single image slot + tab bar: a generation with both a video and an image
    // shows one at a time. Selecting the video tab plays it; finalized history
    // arriving in another order must not tear down (and restart) that video.
    await act(async () => {
      root.render(
        <QueueCard
          item={runningItem}
          isActuallyRunning={true}
          progress={0}
          viewerImages={[]}
          runningImages={liveOutputs}
          onOpenMenu={() => {}}
          downloaded={{}}
          isTopDoneItem={false}
        />,
      );
    });

    // A tab exists per media entry; select the video tab (entry #1).
    const tabs = Array.from(container.querySelectorAll('.queue-media-tabs button'));
    expect(tabs).toHaveLength(2);
    await act(async () => {
      (tabs[0] as HTMLButtonElement).click();
    });

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    const src = video?.getAttribute('src');
    expect(src).toContain('clip.mp4');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    // Only the active entry occupies the slot.
    expect(container.querySelector('img')).toBeNull();

    await act(async () => {
      root.render(
        <QueueCard
          item={item}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          downloaded={{}}
          isTopDoneItem={true}
        />,
      );
    });

    // The pinned video stays the same element with the same src — not remounted —
    // so playback isn't interrupted by the reordered finalized outputs.
    expect(container.querySelector('video')).toBe(video);
    expect(video?.getAttribute('src')).toBe(src);
    expect(container.querySelector('video')).toBe(
      container.querySelector('[data-scroll-anchor-id="video-prompt::media::clip.mp4"] video'),
    );
    // Single slot → only the active media anchor is mounted.
    expect(Array.from(container.querySelectorAll('[data-scroll-anchor-id*="::media::"]')).map(
      (element) => element.getAttribute('data-scroll-anchor-id'),
    )).toEqual([
      'video-prompt::media::clip.mp4',
    ]);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it('shows replay after the finalized video ends', async () => {
    await act(async () => {
      root.render(
        <QueueCard
          item={item}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          downloaded={{}}
          isTopDoneItem={true}
        />,
      );
    });

    const video = container.querySelector('video');
    expect(container.querySelector('[aria-label="Replay video"]')).toBeNull();

    await act(async () => {
      video?.dispatchEvent(new Event('ended', { bubbles: false }));
    });

    expect(container.querySelector('[aria-label="Replay video"]')).not.toBeNull();
  });
});

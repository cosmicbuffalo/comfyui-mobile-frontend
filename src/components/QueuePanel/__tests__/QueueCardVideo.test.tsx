import { act, useEffect, useState } from 'react';
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
    queueOutputLayout: 'tabbed' as 'tabbed' | 'stacked',
    queueItemExpanded: { 'video-prompt': true, 'video-prompt-2': true },
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

const secondItem: UnifiedItem = {
  id: 'video-prompt-2',
  status: 'done',
  data: {
    prompt_id: 'video-prompt-2',
    timestamp: 0,
    outputs: {
      images: [
        { filename: 'still-two.png', subfolder: 'images', type: 'output' },
        { filename: 'clip-two.mp4', subfolder: 'video', type: 'output' },
      ],
    },
    prompt: {},
  },
};

const onScreenRect = {
  top: 0,
  left: 0,
  right: 320,
  bottom: 480,
  width: 320,
  height: 480,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

const offScreenRect = {
  ...onScreenRect,
  top: 5000,
  bottom: 5480,
  toJSON: () => ({}),
} as DOMRect;

// Mirrors QueuePanel's coordination: a queue-wide {itemId, pinned} owner. User
// taps make pinned claims; arrivals make auto claims that a pinned owner
// refuses; gating (enabled=false) drops an auto owner but keeps a pinned one.
function CoordinatedVideoCards({
  enabled,
  firstItem,
}: {
  enabled: boolean;
  firstItem: UnifiedItem;
}) {
  const [owner, setOwner] = useState<{ itemId: string; pinned: boolean } | null>(null);
  useEffect(() => {
    if (enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors QueuePanel's gating effect
    setOwner((current) => (current?.pinned ? current : null));
  }, [enabled]);
  const common = {
    isActuallyRunning: false,
    progress: 0,
    viewerImages: [],
    runningImages: [],
    onOpenMenu: () => {},
    queueVideoPlaybackEnabled: enabled,
    queueVideoOwnerId: owner?.itemId ?? null,
    onRequestQueueVideoPlayback: (itemId: string) => setOwner({ itemId, pinned: true }),
    onRequestAutoQueueVideoPlayback: (itemId: string) =>
      setOwner((current) => (current?.pinned ? current : { itemId, pinned: false })),
    onReleaseQueueVideoPlayback: (itemId: string) =>
      setOwner((current) => (current?.itemId === itemId ? null : current)),
  };
  return (
    <>
      <div data-testid="first-video-card">
        <QueueCard
          {...common}
          item={firstItem}
          isTopDoneItem={firstItem.status === 'done'}
        />
      </div>
      <div data-testid="second-video-card">
        <QueueCard
          {...common}
          item={secondItem}
          isTopDoneItem={false}
        />
      </div>
    </>
  );
}

describe('QueueCard video replay overlay', () => {
  let container: HTMLDivElement;
  let root: Root;
  const preloadedImages: Array<{
    onload: (() => void) | null;
    onerror: (() => void) | null;
    src: string;
  }> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    // jsdom reports all-zero rects, which the arrival eligibility check treats
    // as off screen; report a normal on-screen card by default.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(onScreenRect);
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
    vi.useRealTimers();
    mocks.queueState.queueOutputLayout = 'tabbed';
  });

  // Drive the two-slot swap to completion: dispatch `load` on the back slot's
  // freshly-staged media element (jsdom won't fire it), then run the 200ms
  // promote timer that flips it to the front.
  const settleSwap = async (srcFragment: string) => {
    await act(async () => {
      const backImg = Array.from(container.querySelectorAll('img')).find((el) =>
        (el.getAttribute('src') ?? '').includes(srcFragment),
      );
      backImg?.dispatchEvent(new Event('load'));
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
  };

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
          isTopDoneItem={true}
        />,
      );
    });

    expect(container.querySelector('img')).toBe(previewElement);
    expect(preloadedImages).toHaveLength(1);
    expect(preloadedImages[0]?.src).toContain('final.png');

    // The preload resolves and stages final.png on the hidden back slot — the
    // preview must still be the visible element (front held until ready).
    await act(async () => {
      preloadedImages[0]?.onload?.();
    });
    expect(container.querySelector('img')).toBe(previewElement);

    // The back slot's <img> finishes loading and the promote timer fires: now
    // the final image is shown and the preview element is gone.
    await settleSwap('final.png');
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
          isTopDoneItem={false}
        />,
      );
    });

    // A tab exists per media entry; select the video tab (entry #1).
    const tabs = Array.from(container.querySelectorAll('.queue-media-tabs button'));
    expect(tabs).toHaveLength(2);
    const videoTabThumbnail = Array.from(
      container.querySelectorAll<HTMLImageElement>('.queue-media-tabs img'),
    ).find((image) => image.getAttribute('src')?.includes('clip.mp4'));
    expect(videoTabThumbnail?.getAttribute('src')).toBe(
      '/mobile/api/thumbnail?filename=clip.mp4&subfolder=video&source=output',
    );
    expect(container.querySelector('.queue-media-tabs video')).toBeNull();
    await act(async () => {
      (tabs[0] as HTMLButtonElement).click();
    });

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    const src = video?.getAttribute('src');
    expect(src).toBe(
      '/mobile/api/video/playable?filename=clip.mp4&subfolder=video&type=output',
    );
    expect(video?.getAttribute('poster')).toBe(
      '/mobile/api/thumbnail?filename=clip.mp4&subfolder=video&source=output',
    );
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    // Only the active entry occupies the slot — the thumbnail tab bar legitimately
    // has its own <img> thumbnails, so scope this to images outside the tab bar.
    const slotImages = Array.from(container.querySelectorAll('img')).filter(
      (el) => !el.closest('.queue-media-tabs'),
    );
    expect(slotImages).toHaveLength(0);

    await act(async () => {
      root.render(
        <QueueCard
          item={item}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
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

  it('autoplays an arriving completed generation and shows replay after it ends', async () => {
    await act(async () => {
      root.render(
        <QueueCard
          item={runningItem}
          isActuallyRunning={true}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem={false}
        />,
      );
    });
    expect(container.querySelector('video')).toBeNull();

    // The generation finishes while the card is visible: the video claims the
    // slot and plays once.
    await act(async () => {
      root.render(
        <QueueCard
          item={item}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem={true}
        />,
      );
    });

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label="重新播放视频"]')).toBeNull();

    await act(async () => {
      video?.dispatchEvent(new Event('ended', { bubbles: false }));
    });

    expect(container.querySelector('[aria-label="重新播放视频"]')).not.toBeNull();
  });

  it('starts an arriving video while it is staged behind the live preview', async () => {
    const preview = { filename: 'preview.png', subfolder: '', type: 'temp' };
    const videoOnlyItem: UnifiedItem = {
      ...item,
      data: {
        ...item.data,
        outputs: { images: [videoOutput] },
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
          isTopDoneItem={false}
        />,
      );
    });
    const previewElement = container.querySelector<HTMLImageElement>(
      '[data-scroll-anchor-id="video-prompt::media::preview.png"] img',
    );
    expect(previewElement).not.toBeNull();

    await act(async () => {
      root.render(
        <QueueCard
          item={videoOnlyItem}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem
        />,
      );
    });

    // The video mounts immediately in the hidden back slot rather than waiting
    // on a serialized poster preload. play() must run immediately to drive
    // WebKit's request; promotion still waits for loadedmetadata so the old
    // preview never flashes away early.
    const stagedVideo = container.querySelector('video');
    expect(stagedVideo).not.toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(previewElement?.isConnected).toBe(true);
    expect(preloadedImages).toHaveLength(0);

    await act(async () => {
      stagedVideo?.dispatchEvent(new Event('loadedmetadata'));
      vi.advanceTimersByTime(250);
    });
    expect(container.querySelector('video')).toBe(stagedVideo);
    expect(previewElement?.isConnected).toBe(false);
  });

  it('promotes a revisited ended video without waiting for metadata it may never load', async () => {
    // Arrive + autoplay + natural end (same flow as the replay-overlay test).
    await act(async () => {
      root.render(
        <QueueCard
          item={runningItem}
          isActuallyRunning={true}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem={false}
        />,
      );
    });
    await act(async () => {
      root.render(
        <QueueCard
          item={item}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem={true}
        />,
      );
    });
    const endedVideo = container.querySelector('video');
    expect(endedVideo).not.toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    await act(async () => {
      endedVideo?.dispatchEvent(new Event('ended', { bubbles: false }));
    });
    expect(container.querySelector('[aria-label="重新播放视频"]')).not.toBeNull();

    // Switch to the image tab and settle that swap: resolve the image's
    // preload so it stages on the back slot, then load + promote it.
    const imageTab = Array.from(
      container.querySelectorAll<HTMLImageElement>('.queue-media-tabs img'),
    ).find((image) => image.getAttribute('src')?.includes('still.png'))
      ?.closest('button');
    expect(imageTab).not.toBeNull();
    await act(async () => {
      imageTab?.click();
    });
    await act(async () => {
      preloadedImages.find((img) => img.src.includes('still.png'))?.onload?.();
    });
    await settleSwap('still.png');
    expect(container.querySelector('video')).toBeNull();
    // The image genuinely owns the front now — the video slot was cleared.
    expect(
      container.querySelector('[data-scroll-anchor-id="video-prompt::media::still.png"] img'),
    ).not.toBeNull();

    // Re-select the ended video. Its played-guard (kept for the replay
    // overlay) skips play(), so nothing will fire loadedmetadata for the
    // hidden staged element — promotion must happen directly, not hang.
    const videoTab = Array.from(
      container.querySelectorAll<HTMLImageElement>('.queue-media-tabs img'),
    ).find((image) => image.getAttribute('src')?.includes('clip.mp4'))
      ?.closest('button');
    await act(async () => {
      videoTab?.click();
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    const revisitedVideo = container.querySelector('video');
    expect(revisitedVideo).not.toBeNull();
    // Front flipped: promotion clears the old front slot, so the image entry
    // is unmounted — a video merely stuck staging in the hidden back slot
    // would leave the still.png front (and its swap spinner) in place.
    expect(
      container.querySelector('[data-scroll-anchor-id="video-prompt::media::still.png"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-scroll-anchor-id="video-prompt::media::clip.mp4"] video'),
    ).toBe(revisitedVideo);
    // No replay: the guard held, and the overlay is reachable again.
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label="重新播放视频"]')).not.toBeNull();
  });

  it('settles the swap and un-guards the source when autoplay is rejected', async () => {
    // WebKit can reject play() (autoplay policy, Low Power Mode). The staged
    // hidden video then never fetches metadata, so promotion must not wait on
    // it — and the played-guard must roll back so playback can be retried.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(
      new DOMException('denied', 'NotAllowedError'),
    );
    const preview = { filename: 'preview.png', subfolder: '', type: 'temp' };
    const videoOnlyItem: UnifiedItem = {
      ...item,
      data: {
        ...item.data,
        outputs: { images: [videoOutput] },
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
          isTopDoneItem={false}
        />,
      );
    });
    const previewElement = container.querySelector<HTMLImageElement>(
      '[data-scroll-anchor-id="video-prompt::media::preview.png"] img',
    );
    expect(previewElement).not.toBeNull();

    await act(async () => {
      root.render(
        <QueueCard
          item={videoOnlyItem}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem
        />,
      );
    });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    // The rejection promotes the staged video instead of leaving the swap
    // spinner waiting forever behind the stale preview.
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(previewElement?.isConnected).toBe(false);

    // The guard rolled back: the post-promotion effect pass retries play()
    // (it rejects again here, which is fine — no further slot changes, no loop).
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it('does not autoplay a video that was already done when the card mounted', async () => {
    await act(async () => {
      root.render(
        <QueueCard
          item={item}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem={true}
        />,
      );
    });

    // Opening the panel onto existing history shows posters — playback belongs
    // to generations that finish while the user is watching, or to user taps.
    expect(container.querySelector('video')).toBeNull();
    expect(
      container.querySelector<HTMLImageElement>('[data-scroll-anchor-id="video-prompt::media::clip.mp4"] img')
        ?.getAttribute('src'),
    ).toBe('/mobile/api/thumbnail?filename=clip.mp4&subfolder=video&source=output');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('does not autoplay a generation that finishes off screen', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(offScreenRect);
    await act(async () => {
      root.render(<CoordinatedVideoCards enabled firstItem={runningItem} />);
    });
    await act(async () => {
      root.render(<CoordinatedVideoCards enabled firstItem={item} />);
    });

    expect(container.querySelectorAll('video')).toHaveLength(0);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('never autoplays a generation that finished while playback was gated', async () => {
    await act(async () => {
      root.render(<CoordinatedVideoCards enabled={false} firstItem={runningItem} />);
    });
    // The generation completes while the panel is hidden / the viewer is open.
    await act(async () => {
      root.render(<CoordinatedVideoCards enabled={false} firstItem={item} />);
    });
    expect(container.querySelectorAll('video')).toHaveLength(0);

    // Returning to the panel must not start it late: eligibility was decided
    // at completion time and is not revisited.
    await act(async () => {
      root.render(<CoordinatedVideoCards enabled firstItem={item} />);
    });
    expect(container.querySelectorAll('video')).toHaveLength(0);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('does not let an arriving generation steal playback from a user-selected video', async () => {
    await act(async () => {
      root.render(<CoordinatedVideoCards enabled firstItem={runningItem} />);
    });

    // User explicitly selects the second card's video while the first runs.
    const secondCard = container.querySelector('[data-testid="second-video-card"]');
    const secondVideoTab = Array.from(secondCard?.querySelectorAll('button') ?? []).find(
      (button) => button.querySelector('img')?.getAttribute('src')?.includes('clip-two.mp4'),
    ) as HTMLButtonElement | undefined;
    expect(secondVideoTab).toBeDefined();
    await act(async () => {
      secondVideoTab?.click();
    });
    expect(container.querySelector('video')?.getAttribute('src')).toContain('clip-two.mp4');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    // The first generation finishes: its auto claim is refused, the pinned
    // video keeps playing, and the finished card stays a poster.
    await act(async () => {
      root.render(<CoordinatedVideoCards enabled firstItem={item} />);
    });
    expect(container.querySelectorAll('video')).toHaveLength(1);
    expect(container.querySelector('video')?.getAttribute('src')).toContain('clip-two.mp4');
    expect(
      container.querySelector('[data-testid="first-video-card"] video'),
    ).toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it('keeps older queue-card videos poster-only until explicitly selected', async () => {
    await act(async () => {
      root.render(
        <QueueCard
          item={item}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem={false}
        />,
      );
    });

    expect(container.querySelector('[data-scroll-anchor-id="video-prompt::media::clip.mp4"] video')).toBeNull();
    expect(
      container.querySelector<HTMLImageElement>('[data-scroll-anchor-id="video-prompt::media::clip.mp4"] img')
        ?.getAttribute('src'),
    ).toBe('/mobile/api/thumbnail?filename=clip.mp4&subfolder=video&source=output');
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('retries a transient failure from an older video poster', async () => {
    await act(async () => {
      root.render(
        <QueueCard
          item={item}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem={false}
        />,
      );
    });

    const poster = container.querySelector<HTMLImageElement>(
      '[data-scroll-anchor-id="video-prompt::media::clip.mp4"] img',
    );
    await act(async () => {
      poster?.dispatchEvent(new Event('error'));
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(container.querySelector('.queue-media-unavailable')).toBeNull();
    expect(poster?.getAttribute('src')).toContain('mobile_retry=1');
  });

  it('allows only one live queue video and suspends it when playback is gated', async () => {
    // Nothing plays at mount; the first card's arrival claims the slot.
    await act(async () => {
      root.render(<CoordinatedVideoCards enabled firstItem={runningItem} />);
    });
    expect(container.querySelectorAll('video')).toHaveLength(0);
    await act(async () => {
      root.render(<CoordinatedVideoCards enabled firstItem={item} />);
    });
    expect(container.querySelectorAll('video')).toHaveLength(1);
    expect(container.querySelector('video')?.getAttribute('src')).toContain('clip.mp4');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

    // User taps the second card's video: playback transfers (pinned claim).
    const secondCard = container.querySelector('[data-testid="second-video-card"]');
    const secondVideoTab = Array.from(secondCard?.querySelectorAll('button') ?? []).find(
      (button) => button.querySelector('img')?.getAttribute('src')?.includes('clip-two.mp4'),
    ) as HTMLButtonElement | undefined;
    expect(secondVideoTab).toBeDefined();
    await act(async () => {
      secondVideoTab?.click();
    });
    expect(container.querySelectorAll('video')).toHaveLength(1);
    const selectedVideo = container.querySelector('video');
    expect(selectedVideo?.getAttribute('src')).toContain('clip-two.mp4');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);

    // QueuePanel passes enabled=false both when the panel hides and while the
    // full-screen viewer is open. The queue must leave no background stream.
    await act(async () => {
      root.render(<CoordinatedVideoCards enabled={false} firstItem={item} />);
    });
    expect(container.querySelectorAll('video')).toHaveLength(0);
    expect(container.querySelectorAll('img[alt="生成视频封面"]')).toHaveLength(2);
    expect(selectedVideo?.hasAttribute('src')).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();

    // Re-enabling resumes the user-selected owner with a fresh element. It must
    // not be suppressed by the autoplay guard belonging to the destroyed one.
    await act(async () => {
      root.render(<CoordinatedVideoCards enabled firstItem={item} />);
    });
    expect(container.querySelectorAll('video')).toHaveLength(1);
    expect(container.querySelector('video')?.getAttribute('src')).toContain('clip-two.mp4');
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(3);
    // The auto-played first card does not come back — only the pinned one.
    expect(container.querySelector('[data-testid="first-video-card"] video')).toBeNull();
  });

  it('activates only one video in a stacked card whose generation just finished', async () => {
    mocks.queueState.queueOutputLayout = 'stacked';
    const stackedItem: UnifiedItem = {
      ...item,
      data: {
        ...item.data,
        outputs: {
          images: [
            { filename: 'first.mp4', subfolder: 'video', type: 'output' },
            { filename: 'second.mp4', subfolder: 'video', type: 'output' },
          ],
        },
      },
    };

    await act(async () => {
      root.render(
        <QueueCard
          item={runningItem}
          isActuallyRunning={true}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem={false}
        />,
      );
    });
    await act(async () => {
      root.render(
        <QueueCard
          item={stackedItem}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem={true}
        />,
      );
    });

    expect(container.querySelectorAll('video')).toHaveLength(1);
    expect(container.querySelectorAll('img[src*="/mobile/api/thumbnail"][src*=".mp4"]')).toHaveLength(1);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });
});

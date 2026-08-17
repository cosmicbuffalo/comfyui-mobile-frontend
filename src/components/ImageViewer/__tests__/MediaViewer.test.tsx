import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerImage } from '@/utils/viewerImages';
import { MediaViewer } from '@/components/ImageViewer/MediaViewer';

const getFileWorkflowAvailabilityMock = vi.fn();
const getImageMetadataMock = vi.fn();

vi.mock('@/api/client', () => ({
  getFileWorkflowAvailability: (...args: unknown[]) =>
    getFileWorkflowAvailabilityMock(...args),
  getImageMetadata: (...args: unknown[]) => getImageMetadataMock(...args),
  getMediaThumbnailUrlFromAssetUrl: (url: string) =>
    url.includes('/view?') ? '/mobile/api/thumbnail?filename=clip.mp4&subfolder=renders&source=output' : undefined,
  getPlayableVideoUrl: (url: string) =>
    url.includes('/view?') ? '/mobile/api/video/playable?filename=clip.mp4&subfolder=renders&type=output' : url,
}));

vi.mock('@/hooks/useTextareaFocus', () => ({
  useTextareaFocus: () => ({ isInputFocused: false }),
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function makeVideoItem(id = 'output/renders/clip.mp4'): ViewerImage {
  return {
    src: '/view?filename=clip.mp4&subfolder=renders&type=output',
    mediaType: 'video',
    file: { id, name: 'clip.mp4', type: 'video' },
    filename: 'clip.mp4',
  };
}

function makeImageItem(id: string, name: string): ViewerImage {
  return {
    src: `http://example.local/${name}`,
    mediaType: 'image',
    file: { id, name, type: 'image' },
    filename: name,
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** The availability probe waits for the swipe to settle before firing.
 *  Advance past that delay and flush the result. Requires fake timers. */
async function settleWorkflowProbe(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
  await flushEffects();
  await flushEffects();
}

describe('MediaViewer workflow availability', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getFileWorkflowAvailabilityMock.mockReset();
    // The probe runs for stills as well as videos, so every test that opens
    // the viewer reaches it. Default to "no workflow" and let the cases that
    // care override.
    getFileWorkflowAvailabilityMock.mockResolvedValue(false);
    getImageMetadataMock.mockReset();
    getImageMetadataMock.mockResolvedValue({});
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows load workflow button for video when availability endpoint reports true', async () => {
    vi.useFakeTimers();
    getFileWorkflowAvailabilityMock.mockResolvedValue(true);

    await act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[makeVideoItem()]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });

    await settleWorkflowProbe();

    expect(getFileWorkflowAvailabilityMock).toHaveBeenCalledWith(
      'renders/clip.mp4',
      'output',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      document.querySelector('button[aria-label="Load workflow"]'),
    ).not.toBeNull();
    const video = document.querySelector<HTMLVideoElement>('#media-viewer-overlay video');
    expect(video?.getAttribute('poster')).toBe(
      '/mobile/api/thumbnail?filename=clip.mp4&subfolder=renders&source=output',
    );
    expect(video?.getAttribute('preload')).toBe('auto');
    expect(video?.getAttribute('src')).toBe(
      '/mobile/api/video/playable?filename=clip.mp4&subfolder=renders&type=output',
    );
  });

  // Regression: the "hide Load Workflow on images with no workflow" fix
  // originally left the availability probe video-only, so a still fell back to
  // `item.workflow` alone. That is only populated from the loaded history
  // window, meaning any older image lost the button despite having embedded
  // workflow metadata.
  it('shows load workflow button for an image the availability endpoint reports true', async () => {
    vi.useFakeTimers();
    getFileWorkflowAvailabilityMock.mockResolvedValue(true);

    await act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[makeImageItem('output/renders/old.png', 'old.png')]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });

    await settleWorkflowProbe();

    expect(getFileWorkflowAvailabilityMock).toHaveBeenCalledWith(
      'renders/old.png',
      'output',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      document.querySelector('button[aria-label="Load workflow"]'),
    ).not.toBeNull();
  });

  it('keeps load workflow button hidden for an image with no embedded workflow', async () => {
    vi.useFakeTimers();
    getFileWorkflowAvailabilityMock.mockResolvedValue(false);

    await act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[makeImageItem('output/renders/plain.png', 'plain.png')]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });

    await settleWorkflowProbe();

    expect(
      document.querySelector('button[aria-label="Load workflow"]'),
    ).toBeNull();
  });

  // Regression: an earlier shape of the probe effect listed its own loading
  // flag as a dependency — setting the flag re-ran the effect, whose cleanup
  // aborted the request it had just issued. A mock that resolves in a
  // microtask can't catch that (it settles before React's cleanup runs), so
  // this one stays pending until the test resolves it, and rejects on abort
  // exactly like a real fetch.
  it('lets a slow probe finish instead of aborting it on its own re-render', async () => {
    vi.useFakeTimers();
    let resolveProbe: ((available: boolean) => void) | undefined;
    getFileWorkflowAvailabilityMock.mockImplementation(
      (_path: string, _source: string, opts: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          opts.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')));
          resolveProbe = resolve;
        }),
    );

    await act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[makeImageItem('output/renders/slow.png', 'slow.png')]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });
    await settleWorkflowProbe();
    // Extra flushes: give any state-set re-render every chance to run the
    // effect again (and wrongly abort) before the "network" answers.
    await flushEffects();
    await flushEffects();

    await act(async () => {
      resolveProbe?.(true);
      await Promise.resolve();
    });
    await flushEffects();

    expect(
      document.querySelector('button[aria-label="Load workflow"]'),
    ).not.toBeNull();
  });

  it('does not probe files swiped past before the settle delay', async () => {
    vi.useFakeTimers();
    const items = [
      makeImageItem('output/renders/skip-a.png', 'skip-a.png'),
      makeImageItem('output/renders/skip-b.png', 'skip-b.png'),
    ];
    const renderAt = (index: number) =>
      act(async () => {
        root.render(
          <MediaViewer
            open={true}
            items={items}
            index={index}
            onIndexChange={() => {}}
            onClose={() => {}}
            onDelete={() => {}}
            onLoadWorkflow={() => {}}
            onLoadInWorkflow={() => {}}
          />,
        );
      });

    await renderAt(0);
    // Swipe on before the settle delay elapses — the first file's probe timer
    // must be cancelled without ever issuing a request.
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await renderAt(1);
    await settleWorkflowProbe();

    const probedPaths = getFileWorkflowAvailabilityMock.mock.calls.map((call) => call[0]);
    expect(probedPaths).toEqual(['renders/skip-b.png']);
  });

  // Regression: a transient probe failure used to be written into the
  // module-level availability cache as a definitive `false`, permanently
  // hiding Load Workflow for that file. Failures must leave the answer
  // unknown so a later view retries.
  it('retries after a failed probe instead of caching it as no-workflow', async () => {
    vi.useFakeTimers();
    getFileWorkflowAvailabilityMock
      .mockRejectedValueOnce(new Error('server blip'))
      .mockResolvedValue(true);
    const renderViewer = (open: boolean) =>
      act(async () => {
        root.render(
          <MediaViewer
            open={open}
            items={[makeImageItem('output/renders/flaky.png', 'flaky.png')]}
            index={0}
            onIndexChange={() => {}}
            onClose={() => {}}
            onDelete={() => {}}
            onLoadWorkflow={() => {}}
            onLoadInWorkflow={() => {}}
          />,
        );
      });

    await renderViewer(true);
    await settleWorkflowProbe();
    expect(
      document.querySelector('button[aria-label="Load workflow"]'),
    ).toBeNull();

    // Close and reopen: the failed probe must not have been cached, so the
    // viewer asks again and the button appears.
    await renderViewer(false);
    await renderViewer(true);
    await settleWorkflowProbe();

    expect(getFileWorkflowAvailabilityMock).toHaveBeenCalledTimes(2);
    expect(
      document.querySelector('button[aria-label="Load workflow"]'),
    ).not.toBeNull();
  });

  it('keeps load workflow button hidden for video when availability endpoint reports false', async () => {
    vi.useFakeTimers();
    getFileWorkflowAvailabilityMock.mockResolvedValue(false);

    await act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[makeVideoItem('output/renders/no-workflow.mp4')]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });

    await settleWorkflowProbe();

    expect(
      document.querySelector('button[aria-label="Load workflow"]'),
    ).toBeNull();
  });

  it('shows overlay controls after keyboard navigation wakes an idle viewer', async () => {
    vi.useFakeTimers();
    const onIndexChange = vi.fn();

    await act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[
            makeImageItem('output/first.png', 'first.png'),
            makeImageItem('output/second.png', 'second.png'),
          ]}
          index={0}
          onIndexChange={onIndexChange}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });
    await flushEffects();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(
      document.querySelector('#media-viewer-overlay > div.pointer-events-none')?.className,
    ).toContain('opacity-0');

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(onIndexChange).toHaveBeenCalledWith(1);
    expect(
      document.querySelector('#media-viewer-overlay > div.pointer-events-none')?.className,
    ).toContain('opacity-100');
  });

  it('uses the original image instead of an orientation-stripping preview', async () => {
    const item = makeImageItem('output/photo.jpg', 'photo.jpg');
    item.displaySrc = 'http://example.local/photo.jpg?preview=webp;90';

    await act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[item]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });

    expect(document.querySelector<HTMLImageElement>('#media-viewer-overlay img')?.src).toBe(
      item.src,
    );
  });

  it('continues using fast previews for non-JPEG images', async () => {
    const item = makeImageItem('output/generated.png', 'generated.png');
    item.displaySrc = 'http://example.local/generated.png?preview=webp;90';

    await act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[item]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });

    expect(document.querySelector<HTMLImageElement>('#media-viewer-overlay img')?.src).toBe(
      item.displaySrc,
    );
  });

  it('preloads the next two images on each side while skipping videos', async () => {
    const preloadedSources: string[] = [];
    class ImageMock {
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(value: string) {
        preloadedSources.push(value);
      }
    }
    vi.stubGlobal('Image', ImageMock);

    const leftFar = makeImageItem('output/left-far.png', 'left-far.png');
    const leftNear = makeImageItem('output/left-near.jpg', 'left-near.jpg');
    leftNear.displaySrc = 'http://example.local/left-near.jpg?preview=webp;90';
    const current = makeImageItem('output/current.png', 'current.png');
    const rightNear = makeImageItem('output/right-near.png', 'right-near.png');
    rightNear.displaySrc = 'http://example.local/right-near.png?preview=webp;90';
    const rightFar = makeImageItem('output/right-far.png', 'right-far.png');

    await act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[
            leftFar,
            makeVideoItem('output/left.mp4'),
            leftNear,
            current,
            makeVideoItem('output/right.mp4'),
            rightNear,
            rightFar,
          ]}
          index={3}
          onIndexChange={() => {}}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });

    expect(preloadedSources).toEqual(expect.arrayContaining([
      leftFar.src,
      leftNear.src,
      rightNear.displaySrc,
      rightFar.src,
    ]));
    expect(preloadedSources).not.toContain(current.src);
    expect(preloadedSources).not.toContain('http://example.local/clip.mp4');
  });

  it('retains loaded images within three positions and evicts them beyond the buffer', async () => {
    const preloadedSources: string[] = [];
    class ImageMock {
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(value: string) {
        preloadedSources.push(value);
      }
    }
    vi.stubGlobal('Image', ImageMock);

    const items = Array.from({ length: 9 }, (_, itemIndex) =>
      makeImageItem(`output/${itemIndex}.png`, `${itemIndex}.png`),
    );
    const renderAt = async (index: number) => {
      await act(async () => {
        root.render(
          <MediaViewer
            open={true}
            items={items}
            index={index}
            onIndexChange={() => {}}
            onClose={() => {}}
            onDelete={() => {}}
            onLoadWorkflow={() => {}}
            onLoadInWorkflow={() => {}}
          />,
        );
      });
    };
    const preloadCount = (src: string) =>
      preloadedSources.filter((candidate) => candidate === src).length;

    await renderAt(3);
    expect(preloadCount(items[1].src)).toBe(1);

    await renderAt(4);
    await renderAt(3);
    expect(preloadCount(items[1].src)).toBe(1);

    await renderAt(5);
    await renderAt(3);
    expect(preloadCount(items[1].src)).toBe(2);
  });

  it('does not leave the loading spinner stuck over the initially-opened image', async () => {
    // Regression: on initial open displayedItem === currentItem, so the swap
    // effect early-returns and the adjacent-preload effect skips the current src
    // — nothing marked it loaded, leaving the debounced spinner stuck over a
    // fully-decoded image. The visible <img>'s load (or cached `complete`) must
    // clear it.
    vi.useFakeTimers();
    const item = makeImageItem('output/first.png', 'first.png');

    await act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[item]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });

    // The viewer renders through a portal into document.body, so query there.
    // The visible <img> finishes decoding (network path via onLoad).
    await act(async () => {
      document
        .querySelector('#media-viewer-overlay img')
        ?.dispatchEvent(new Event('load'));
      await Promise.resolve();
    });

    // Advance past the 200ms spinner debounce; a stuck spinner would appear here.
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  // The spinner clears only when a src lands in `loadedSrcs`, and every route a
  // src can take to become "current" has to put it there — including the routes
  // that end in failure. The visible <img> once handled onLoad and not onError,
  // so a 404 (a moved output, whose old URL is still in the list) hung the
  // spinner forever. Asserting the invariant per route rather than per bug is
  // what keeps the next route honest.
  describe('a src that fails to load still settles the spinner', () => {
    const broken = () => makeImageItem('output/moved-away.png', 'moved-away.png');
    const fine = () => makeImageItem('output/still-here.png', 'still-here.png');

    const viewer = (items: ViewerImage[], index: number) =>
      act(async () => {
        root.render(
          <MediaViewer
            open={true}
            items={items}
            index={index}
            onIndexChange={() => {}}
            onClose={() => {}}
            onDelete={() => {}}
            onLoadWorkflow={() => {}}
            onLoadInWorkflow={() => {}}
          />,
        );
      });

    const settle = async () => {
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
    };

    const failCurrentImage = async () => {
      const img = document.querySelector<HTMLImageElement>('#media-viewer-overlay img')!;
      await act(async () => {
        img.dispatchEvent(new Event('error'));
      });
      await settle();
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('when it is the image the viewer opened on', async () => {
      await viewer([broken()], 0);
      await settle();
      expect(document.querySelector('.image-loading-spinner')).not.toBeNull();

      await failCurrentImage();
      expect(document.querySelector('.image-loading-spinner')).toBeNull();
      expect(document.querySelector('.image-load-error')).not.toBeNull();
    });

    it('when it is swiped onto from a working image', async () => {
      // The swap between two different srcs preloads the incoming one and only
      // then advances the visible image — and its `finish` runs on rejection as
      // well as success (`decode().then(finish, finish)`), marking the src
      // loaded either way. So this route was already covered; the test pins it
      // so a future refactor of the swap cannot quietly drop the error half.
      // jsdom never fails `new Image()`, so the mock does — through `decode()`,
      // which is the branch a real browser takes. Mocking only onload/onerror
      // would leave the decode path unpinned: removing its rejection handler
      // would not fail this test.
      class ImageMock {
        naturalWidth = 0;
        naturalHeight = 0;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        src = '';
        decode() {
          return Promise.reject(new Error('404'));
        }
      }
      vi.stubGlobal('Image', ImageMock);
      try {
        const items = [fine(), broken()];
        await viewer(items, 0);
        await settle();
        await viewer(items, 1);
        await settle();

        expect(document.querySelector('.image-loading-spinner')).toBeNull();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('when the adjacent preload already errored before the swipe', async () => {
      // The preload path has always treated an error as settled; this pins it so
      // the two routes cannot drift apart again.
      const errored: Array<() => void> = [];
      class ImageMock {
        naturalWidth = 0;
        naturalHeight = 0;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          if (this.onerror) errored.push(this.onerror);
        }
      }
      vi.stubGlobal('Image', ImageMock);
      try {
        const items = [fine(), broken()];
        await viewer(items, 0);
        await act(async () => {
          errored.forEach((fire) => fire());
        });
        await viewer(items, 1);
        await settle();
        expect(document.querySelector('.image-loading-spinner')).toBeNull();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

});

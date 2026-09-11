import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerImage } from '@/utils/viewerImages';
import { MediaViewer } from '@/components/ImageViewer/MediaViewer';
import { useImageViewerStore } from '@/hooks/useImageViewer';
import { useWorkflowStore } from '@/hooks/useWorkflow';

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
    // A failed image kicks off a HEAD probe to find out whether the file is
    // gone. Default it to an answer that says nothing about the file, so only
    // the tests that care opt into a 404 — and none of them touch the network.
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 500 })));
    useImageViewerStore.getState().setVideoPlaybackRate(1);
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
    expect(video?.controls).toBe(false);
    expect(document.querySelector('button[aria-label="Pause"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Unmute"]')).not.toBeNull();
    expect(
      document.querySelector('button[aria-label="Unmute"]')?.parentElement?.className,
    ).toContain('top-14');
    expect(document.querySelector('input[aria-label="Video timeline"]')).not.toBeNull();
  });

  it('drives play, mute, elapsed time, and seeking through custom overlay controls', async () => {
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

    const video = document.querySelector<HTMLVideoElement>('#media-viewer-overlay video')!;
    let paused = false;
    Object.defineProperties(video, {
      duration: { configurable: true, value: 12.5 },
      currentTime: { configurable: true, writable: true, value: 2.1 },
      paused: { configurable: true, get: () => paused },
    });
    const pause = vi.fn(() => {
      paused = true;
      video.dispatchEvent(new Event('pause'));
    });
    const play = vi.fn(() => {
      paused = false;
      video.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    Object.defineProperties(video, {
      pause: { configurable: true, value: pause },
      play: { configurable: true, value: play },
    });

    await act(async () => {
      video.dispatchEvent(new Event('loadedmetadata'));
      video.dispatchEvent(new Event('timeupdate'));
    });

    const scrubber = document.querySelector('.video-scrubber')!;
    expect(scrubber.textContent).toContain('0:02');
    expect(scrubber.textContent).toContain('0:12');

    const timeline = scrubber.querySelector<HTMLInputElement>('input[type="range"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(timeline, '7.25');
      timeline.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(video.currentTime).toBe(7.25);

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Unmute"]')?.click();
    });
    expect(video.muted).toBe(false);
    expect(document.querySelector('button[aria-label="Mute"]')).not.toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Pause"]')?.click();
    });
    expect(pause).toHaveBeenCalledTimes(1);
    expect(document.querySelector('button[aria-label="Play"]')).not.toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Play"]')?.click();
      await Promise.resolve();
    });
    expect(play).toHaveBeenCalledTimes(1);
    expect(document.querySelector('button[aria-label="Pause"]')).not.toBeNull();

    const nextVideo = makeVideoItem('output/renders/next.mp4');
    nextVideo.src = '/view?filename=next.mp4&subfolder=renders&type=output';
    nextVideo.filename = 'next.mp4';
    nextVideo.file = { id: 'output/renders/next.mp4', name: 'next.mp4', type: 'video' };
    await act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[nextVideo]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });

    expect(document.querySelector<HTMLVideoElement>('#media-viewer-overlay video')?.muted).toBe(true);
    expect(document.querySelector('button[aria-label="Unmute"]')).not.toBeNull();
  });

  it('morphs the global speed control, shows a thumb-aligned drag readout, and resets it', async () => {
    vi.useFakeTimers();
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

    const firstVideo = document.querySelector<HTMLVideoElement>('#media-viewer-overlay video')!;
    const speedButton = document.querySelector<HTMLButtonElement>('button[aria-label="Playback speed"]')!;
    await act(async () => {
      firstVideo.dispatchEvent(new Event('loadedmetadata'));
      speedButton.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    });

    const morphingControl = document.querySelector<HTMLElement>('.playback-speed-control > div')!;
    // Pointer-down alone must not morph or expose the range beneath that same
    // in-progress gesture; that caused real touch taps to alter the speed and
    // immediately show Reset without ever presenting a usable slider.
    expect(morphingControl.dataset.state).toBe('closed');
    expect(useImageViewerStore.getState().videoPlaybackRate).toBe(1);

    await act(async () => {
      speedButton.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }));
      speedButton.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(morphingControl.dataset.state).toBe('open');
    expect(morphingControl.style.height).toBe('200px');
    expect(morphingControl.className).toContain('w-9');
    expect(document.querySelector('[role="slider"][aria-label="Playback speed"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Reset playback speed"]')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    const slider = document.querySelector<HTMLElement>('[role="slider"][aria-label="Playback speed"]')!;
    expect(slider).not.toBeNull();
    Object.defineProperty(slider, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 0,
        right: 36,
        bottom: 200,
        left: 0,
        width: 36,
        height: 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    await act(async () => {
      slider.dispatchEvent(new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientY: 62.5,
      }));
    });

    const readout = morphingControl.querySelector('output');
    expect(readout?.textContent).toContain('150%');
    expect(readout?.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(firstVideo.playbackRate).toBe(1.5);
    expect(useImageViewerStore.getState().videoPlaybackRate).toBe(1.5);
    expect(document.querySelector('button[aria-label="Reset playback speed"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    expect(morphingControl.querySelector('output')).toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Close playback speed controls"]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(morphingControl.dataset.state).toBe('closed');
    expect(morphingControl.style.height).toBe('36px');
    expect(morphingControl.className).toContain('bg-cyan-400/25');

    // WebView fallback: a synthesized click with no pointer-up must still open.
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Playback speed"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(morphingControl.dataset.state).toBe('open');
    expect(morphingControl.style.height).toBe('200px');
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Close playback speed controls"]')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });

    const nextVideo = makeVideoItem('output/renders/speed-next.mp4');
    nextVideo.src = '/view?filename=speed-next.mp4&subfolder=renders&type=output';
    nextVideo.filename = 'speed-next.mp4';
    nextVideo.file = {
      id: 'output/renders/speed-next.mp4',
      name: 'speed-next.mp4',
      type: 'video',
    };
    await act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[nextVideo]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });
    const nextVideoElement = document.querySelector<HTMLVideoElement>('#media-viewer-overlay video')!;
    await act(async () => {
      nextVideoElement.dispatchEvent(new Event('loadedmetadata'));
    });
    expect(nextVideoElement.playbackRate).toBe(1.5);

    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Reset playback speed"]')?.click();
    });
    expect(nextVideoElement.playbackRate).toBe(1);
    expect(useImageViewerStore.getState().videoPlaybackRate).toBe(1);
    expect(document.querySelector('button[aria-label="Reset playback speed"]')).toBeNull();
    expect(morphingControl.className).toContain('bg-black/45');
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

  it('immediately toggles the visible chrome when the video surface is tapped', async () => {
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

    const stage = document.querySelector<HTMLElement>(
      '#media-viewer-overlay > div.absolute.inset-x-0',
    )!;
    stage.setPointerCapture = vi.fn();
    const chrome = () => document.querySelector(
      '#media-viewer-overlay > div.pointer-events-none',
    );
    const tapStage = () => {
      stage.dispatchEvent(new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }));
      stage.dispatchEvent(new MouseEvent('pointerup', {
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }));
    };

    await act(async () => tapStage());
    expect(chrome()?.className).toContain('opacity-0');

    await act(async () => tapStage());
    expect(chrome()?.className).toContain('opacity-100');
  });

  it('zooms and pans video without waking idle chrome', async () => {
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

    const overlay = document.querySelector<HTMLElement>('#media-viewer-overlay')!;
    const stage = overlay.querySelector<HTMLElement>(':scope > div.absolute.inset-x-0')!;
    const video = overlay.querySelector<HTMLVideoElement>('video')!;
    Object.defineProperties(stage, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
      setPointerCapture: { configurable: true, value: vi.fn() },
    });
    Object.defineProperties(video, {
      videoWidth: { configurable: true, value: 800 },
      videoHeight: { configurable: true, value: 450 },
      duration: { configurable: true, value: 10 },
      currentTime: { configurable: true, writable: true, value: 0 },
    });
    await act(async () => {
      video.dispatchEvent(new Event('loadedmetadata'));
    });

    const chrome = () => overlay.querySelector<HTMLElement>(':scope > div.pointer-events-none')!;
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      stage.dispatchEvent(event);
    };

    // A stationary tap hides the chrome first.
    await act(async () => {
      pointer('pointerdown', 400, 300);
      pointer('pointerup', 400, 300);
    });
    expect(chrome().className).toContain('opacity-0');

    // Ctrl-wheel zoom changes the video transform but not chrome visibility.
    await act(async () => {
      overlay.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        clientX: 400,
        clientY: 300,
        deltaY: -100,
      }));
    });
    expect(video.style.transform).toContain('scale(1.5)');
    expect(chrome().className).toContain('opacity-0');

    // A drag pans the zoomed video and is consumed as a transform gesture,
    // never as the tap that would wake the chrome.
    const beforePan = video.style.transform;
    await act(async () => {
      pointer('pointerdown', 400, 300);
      pointer('pointermove', 340, 300);
      pointer('pointerup', 340, 300);
    });
    expect(video.style.transform).not.toBe(beforePan);
    expect(chrome().className).toContain('opacity-0');
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

  // A video file carries no readable generation metadata of its own — the
  // metadata endpoint answers for one with the same-basename image beside it,
  // which is another file's metadata. The viewer must not claim it.
  it('offers no metadata toggle for a video and never fetches its sibling metadata', async () => {
    vi.useFakeTimers();

    await act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[makeVideoItem()]}
          index={0}
          showMetadataToggle
          onIndexChange={() => {}}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });

    await settleWorkflowProbe();

    expect(document.querySelector('button[aria-label="Toggle metadata"]')).toBeNull();
    expect(getImageMetadataMock).not.toHaveBeenCalled();
  });

  it('keeps the metadata toggle on a video whose item carries its own run metadata', async () => {
    vi.useFakeTimers();
    // Queue/history items attach metadata read from the run's own prompt —
    // honestly the video's — so the toggle stays, with no sibling fetch.
    const item: ViewerImage = { ...makeVideoItem(), metadata: { seeds: [123] } };

    await act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[item]}
          index={0}
          showMetadataToggle
          onIndexChange={() => {}}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });

    await settleWorkflowProbe();

    expect(document.querySelector('button[aria-label="Toggle metadata"]')).not.toBeNull();
    expect(getImageMetadataMock).not.toHaveBeenCalled();
  });

});

// Deleting an output leaves its history entry — and so its viewer slot —
// behind, which used to strand the user on "Unable to load this image" for
// every deleted file in a run of history. The viewer now confirms the file is
// really gone (404) and steps over the slot.
describe('MediaViewer deleted media', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onIndexChange: ReturnType<typeof vi.fn<(index: number) => void>>;

  const item = (name: string) => makeImageItem(`output/${name}`, name);

  const viewer = (items: ViewerImage[], index: number) =>
    act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={items}
          index={index}
          onIndexChange={onIndexChange}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });

  /** Fail the visible image and let the probe (and anything it triggers) run. */
  const failCurrentImage = async () => {
    const img = document.querySelector<HTMLImageElement>('#media-viewer-overlay img')!;
    await act(async () => {
      img.dispatchEvent(new Event('error'));
    });
    await flushEffects();
    await flushEffects();
  };

  const respondWith = (status: number) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status })));
  };

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onIndexChange = vi.fn();
    getFileWorkflowAvailabilityMock.mockReset();
    getFileWorkflowAvailabilityMock.mockResolvedValue(false);
    getImageMetadataMock.mockReset();
    getImageMetadataMock.mockResolvedValue({});
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('moves on from the slot it opened on when the file is gone', async () => {
    respondWith(404);
    await viewer([item('deleted.png'), item('kept.png')], 0);
    await failCurrentImage();

    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it('falls back to the previous slot when the deleted one is last', async () => {
    respondWith(404);
    await viewer([item('kept.png'), item('deleted.png')], 1);
    await failCurrentImage();

    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it('steps over a slot already known to be deleted', async () => {
    respondWith(404);
    const items = [item('first.png'), item('deleted.png'), item('third.png')];
    await viewer(items, 1);
    await failCurrentImage();
    onIndexChange.mockClear();

    // Back at a live slot, a swipe towards the deleted one must land past it.
    await viewer(items, 0);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  it('stays put when the load failed for a reason other than deletion', async () => {
    // A server restart or a dropped connection fails every image. Skipping on
    // that would hide the whole run instead of one deleted file.
    respondWith(500);
    await viewer([item('offline.png'), item('kept.png')], 0);
    await failCurrentImage();

    expect(onIndexChange).not.toHaveBeenCalled();
    expect(document.querySelector('.image-load-error')).not.toBeNull();
  });
});

describe('MediaViewer follow queue', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onIndexChange: ReturnType<typeof vi.fn<(index: number) => void>>;

  const item = (name: string) => makeImageItem(`output/${name}`, name);

  const viewer = (items: ViewerImage[], index: number) =>
    act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={items}
          index={index}
          onIndexChange={onIndexChange}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
        />,
      );
    });

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 500 })));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onIndexChange = vi.fn();
    getFileWorkflowAvailabilityMock.mockReset();
    getFileWorkflowAvailabilityMock.mockResolvedValue(false);
    getImageMetadataMock.mockReset();
    getImageMetadataMock.mockResolvedValue({});
    useWorkflowStore.getState().setFollowQueue(true);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    useWorkflowStore.getState().setFollowQueue(false);
  });

  it('stops following once the user cycles to another generation', async () => {
    // Following exists to yank the viewer to the newest output the moment one
    // lands. Stepping away is a decision to look at THAT one, so leaving the
    // mode on meant every browse backwards was undone by the next completion.
    await viewer([item('newest.png'), item('older.png')], 0);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(onIndexChange).toHaveBeenCalledWith(1);
    expect(useWorkflowStore.getState().followQueue).toBe(false);
  });

  it('keeps following when the step could not go anywhere', async () => {
    await viewer([item('only.png')], 0);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(onIndexChange).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().followQueue).toBe(true);
  });
});

describe('MediaViewer video framing', () => {
  let container: HTMLDivElement;
  let root: Root;
  let resizeCallbacks: Array<() => void>;

  /** Captures its callback so a test can drive a container measurement pass. */
  class CapturingResizeObserver {
    constructor(callback: () => void) {
      resizeCallbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  const measure = (el: Element, width: number, height: number) => {
    Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  };

  beforeEach(() => {
    resizeCallbacks = [];
    // jsdom defines no pointer capture at all, and the viewer claims it on
    // every pointerdown. Without these the double-tap below throws out of
    // React's dispatch and vitest reports an unhandled error. Assigned rather
    // than spied because there is nothing there to spy on.
    Object.assign(Element.prototype, {
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      hasPointerCapture: () => false,
    });
    vi.stubGlobal('ResizeObserver', CapturingResizeObserver);
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 500 })));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getFileWorkflowAvailabilityMock.mockReset();
    getFileWorkflowAvailabilityMock.mockResolvedValue(false);
    getImageMetadataMock.mockReset();
    getImageMetadataMock.mockResolvedValue({});
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Render the viewer on `items` at `index`, measuring the viewport at 400x800. */
  const openAt = async (items: ViewerImage[], index: number) => {
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

  /** Report a portrait clip's dimensions and let the viewer measure. */
  const reportPortraitVideo = async () => {
    const viewport = document.querySelector('#media-viewer-overlay > div')!;
    measure(viewport, 400, 800);
    const video = document.querySelector<HTMLVideoElement>('#media-viewer-overlay video')!;
    Object.defineProperty(video, 'videoWidth', { value: 720, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 1600, configurable: true });
    await act(async () => {
      video.dispatchEvent(new Event('loadedmetadata'));
      resizeCallbacks.forEach((run) => run());
    });
    return video;
  };

  const scaleOf = (video: HTMLVideoElement) =>
    Number(/scale\(([\d.]+)\)/.exec(video.style.transform)?.[1]);

  it('fits a new arrival to the height even after the last one was zoomed to cover', async () => {
    // Follow mode delivers every generation at index 0, so sitting at the front
    // means the index never changes — and the zoom mode used to reset only on
    // an index change. A `cover` left behind by a double tap therefore carried
    // into the next arrival, and for a portrait clip `cover` IS scale 1, which
    // is fit-to-width. Intermittent because it needed a double tap first.
    const first = { ...makeVideoItem('output/renders/first.mp4'), src: '/view?filename=first.mp4&subfolder=renders&type=output' };
    const second = { ...makeVideoItem('output/renders/second.mp4'), src: '/view?filename=second.mp4&subfolder=renders&type=output' };

    await openAt([first], 0);
    const firstVideo = await reportPortraitVideo();
    expect(scaleOf(firstVideo)).toBeLessThan(1);

    // Double tap to cover — two taps inside the double-tap window.
    const viewport = document.querySelector('#media-viewer-overlay > div')!;
    const tap = (id: number) => {
      const down = new MouseEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 400 });
      const up = new MouseEvent('pointerup', { bubbles: true, clientX: 200, clientY: 400 });
      for (const event of [down, up]) {
        Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: true } });
      }
      viewport.dispatchEvent(down);
      viewport.dispatchEvent(up);
    };
    await act(async () => { tap(1); tap(2); });
    expect(scaleOf(firstVideo)).toBe(1);

    // The next generation lands at the same index — a different clip entirely.
    await openAt([second], 0);
    const secondVideo = await reportPortraitVideo();
    expect(scaleOf(secondVideo)).toBeLessThan(1);
  });

  it('fits a tall video to the screen height even when its metadata arrived first', async () => {
    // The race this closes: the effect that clears the recorded dimensions on
    // an item change and the element's own `loadedmetadata` are not ordered
    // against each other. When the event won, its dimensions were recorded and
    // then wiped — and since it never fires twice, nothing ever re-measured.
    // A missing base size makes the fit scale 1, which is fit-to-WIDTH, so a
    // portrait clip opened cropped to the full screen width.
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

    const viewport = document.querySelector('#media-viewer-overlay > div')!;
    measure(viewport, 400, 800);
    const video = document.querySelector<HTMLVideoElement>('#media-viewer-overlay video')!;
    // Reported by the element but never handed to React — the state the lost
    // `loadedmetadata` leaves behind.
    Object.defineProperty(video, 'videoWidth', { value: 720, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 1600, configurable: true });

    await act(async () => {
      resizeCallbacks.forEach((run) => run());
    });

    // Width-fitted the clip would stand 888px in an 800px viewport, so fitting
    // asks for 800/888 of that.
    const scale = Number(/scale\(([\d.]+)\)/.exec(video.style.transform)?.[1]);
    expect(scale).toBeCloseTo(800 / (1600 * (400 / 720)), 3);
    expect(scale).toBeLessThan(1);
  });
});

describe('MediaViewer pick mode', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (pickAction: Record<string, unknown> | null) =>
    act(async () => {
      root.render(
        <MediaViewer
          open={true}
          items={[makeImageItem('output/a.png', 'a.png')]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => {}}
          onDelete={() => {}}
          onLoadWorkflow={() => {}}
          onLoadInWorkflow={() => {}}
          onToggleFavorite={() => {}}
          onReject={() => {}}
          onDownload={() => {}}
          showMetadataToggle
          pickAction={pickAction as never}
        />,
      );
    });

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 500 })));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getFileWorkflowAvailabilityMock.mockReset();
    getFileWorkflowAvailabilityMock.mockResolvedValue(true);
    getImageMetadataMock.mockReset();
    getImageMetadataMock.mockResolvedValue({});
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('centres the pick button and hands the item on screen back', async () => {
    const onPick = vi.fn();
    await render({ label: 'Select current', onPick });

    const button = document.querySelector<HTMLButtonElement>('.viewer-pick-action');
    expect(button?.textContent).toBe('Select current');
    // Centred on the row, not merely between the side groups.
    expect(button?.className).toContain('left-1/2');
    expect(button?.className).toContain('-translate-x-1/2');

    await act(async () => button?.click());
    expect(onPick).toHaveBeenCalledTimes(1);
    expect((onPick.mock.calls[0][0] as { filename?: string }).filename).toBe('a.png');
  });

  it('clears the room the answer needs, the way select mode does', async () => {
    // Delete, download and the two "take this into the workflow" buttons all
    // act on the file as a destination, which is not the question being asked
    // while picking — and the room they take is what stops the answer being
    // centred. Triage and metadata stay.
    await render({ label: 'Select current', onPick: () => {} });

    expect(document.querySelector('button[aria-label="Delete output"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Use in workflow"]')).toBeNull();
    expect(document.querySelector('.viewer-pick-action')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Favorite"]')).not.toBeNull();
  });

  it('leaves the ordinary viewer untouched when nothing is picking', async () => {
    await render(null);

    expect(document.querySelector('.viewer-pick-action')).toBeNull();
    expect(document.querySelector('button[aria-label="Delete output"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Use in workflow"]')).not.toBeNull();
  });
});

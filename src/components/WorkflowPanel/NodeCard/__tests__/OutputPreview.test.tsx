import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeCardOutputPreview } from '@/components/WorkflowPanel/NodeCard/OutputPreview';
import {
  getImagePreviewUrl,
  getImageUrl,
  getMediaThumbnailUrl,
  getPlayableVideoUrl,
} from '@/api/client';
import { useImageViewerStore } from '@/hooks/useImageViewer';

describe('NodeCardOutputPreview', () => {
  let container: HTMLDivElement;
  let root: Root;
  let playSpy: ReturnType<typeof vi.spyOn>;
  let pauseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    useImageViewerStore.getState().setViewerState({ viewerOpen: false });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    useImageViewerStore.getState().setViewerState({ viewerOpen: false });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('prefers a real preview image over a latent preview when both exist', async () => {
    const previewImage = {
      filename: 'final.png',
      subfolder: 'output',
      type: 'output',
    };

    await act(async () => {
      root.render(
        <NodeCardOutputPreview
          show
          previewImage={previewImage}
          latentPreviewUrl="blob:latent-preview"
          displayName="Preview node"
          isExecuting={false}
          overallProgress={null}
          displayNodeProgress={0}
        />
      );
    });

    const image = document.querySelector('img');
    // The inline preview displays the fast WebP variant, not the full PNG.
    expect(image?.getAttribute('src')).toBe(
      getImagePreviewUrl(previewImage.filename, previewImage.subfolder, previewImage.type)
    );
  });

  it('tiles all batch outputs into a grid when given more than one image', async () => {
    const previewImages = [
      { displaySrc: 'blob:a', alt: 'n' },
      { displaySrc: 'blob:b', alt: 'n' },
      { displaySrc: 'blob:c', alt: 'n' },
    ];
    const clicked: number[] = [];

    await act(async () => {
      root.render(
        <NodeCardOutputPreview
          show
          previewImage={null}
          previewImages={previewImages}
          displayName="Batch node"
          onPreviewImageClick={(i) => clicked.push(i)}
          isExecuting={false}
          overallProgress={null}
          displayNodeProgress={0}
        />
      );
    });

    const grid = document.querySelector('.output-batch-grid');
    expect(grid).not.toBeNull();
    const images = document.querySelectorAll('.output-batch-grid img');
    expect(images.length).toBe(3);
    expect(images[1].getAttribute('src')).toBe('blob:b');

    await act(async () => {
      (images[2] as HTMLElement).click();
    });
    expect(clicked).toEqual([2]);
  });

  it('does not tile a single output (falls back to the single preview)', async () => {
    await act(async () => {
      root.render(
        <NodeCardOutputPreview
          show
          previewImage={{ filename: 'one.png', subfolder: 'output', type: 'output' }}
          previewImages={[{ displaySrc: 'blob:only', alt: 'n' }]}
          displayName="Single node"
          isExecuting={false}
          overallProgress={null}
          displayNodeProgress={0}
        />
      );
    });
    expect(document.querySelector('.output-batch-grid')).toBeNull();
    expect(document.querySelector('img')).not.toBeNull();
  });

  it('renders a single video through the playable gateway and starts it inline', async () => {
    const previewVideo = {
      filename: 'clip one.mp4',
      subfolder: 'video/2026',
      type: 'output',
    };

    await act(async () => {
      root.render(
        <NodeCardOutputPreview
          show
          previewImage={previewVideo}
          displayName="Video combine"
          isExecuting={false}
          overallProgress={null}
          displayNodeProgress={0}
        />
      );
    });

    const video = document.querySelector('video');
    const originalSrc = getImageUrl(
      previewVideo.filename,
      previewVideo.subfolder,
      previewVideo.type,
    );
    expect(video).not.toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(video?.getAttribute('src')).toBe(getPlayableVideoUrl(originalSrc));
    expect(video?.getAttribute('poster')).toBe(getMediaThumbnailUrl(
      previewVideo.filename,
      previewVideo.subfolder,
      previewVideo.type,
    ));
    expect(video?.controls).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.preload).toBe('metadata');
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps mixed image/video batches playable without auto-starting every video', async () => {
    const previewMedia = [
      { displaySrc: 'blob:image-a', alt: 'Batch node', mediaType: 'image' as const },
      {
        displaySrc: '/mobile/api/video/playable?filename=a.mp4',
        poster: '/mobile/api/thumbnail?filename=a.mp4',
        alt: 'Batch node',
        mediaType: 'video' as const,
      },
      {
        displaySrc: '/mobile/api/video/playable?filename=b.webm',
        poster: '/mobile/api/thumbnail?filename=b.webm',
        alt: 'Batch node',
        mediaType: 'video' as const,
      },
    ];

    await act(async () => {
      root.render(
        <NodeCardOutputPreview
          show
          previewImage={null}
          previewImages={previewMedia}
          displayName="Batch node"
          isExecuting={false}
          overallProgress={null}
          displayNodeProgress={0}
        />
      );
    });

    expect(document.querySelectorAll('.output-batch-grid img')).toHaveLength(1);
    const videos = document.querySelectorAll<HTMLVideoElement>('.output-batch-grid video');
    expect(videos).toHaveLength(2);
    expect(videos[0].getAttribute('poster')).toBe('/mobile/api/thumbnail?filename=a.mp4');
    expect(videos[1].controls).toBe(true);
    expect(videos[1].playsInline).toBe(true);
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('restores and switches a persisted frontend preview history', async () => {
    const item = (name: string) => ({
      src: `/mobile/api/video/playable?filename=${name}`,
      poster: `/mobile/api/thumbnail?filename=${name}`,
      mediaType: 'video' as const,
      autoPlay: false,
      loop: true,
    });
    const changed = vi.fn();
    await act(async () => {
      root.render(
        <NodeCardOutputPreview
          show
          previewImage={null}
          frontendPreview={{
            ...item('second.mp4'),
            source: 'oasis-widget',
            playlist: [item('first.mp4'), item('second.mp4')],
            activeIndex: 1,
            playMode: 'cycle',
          }}
          displayName="Oasis"
          onFrontendPreviewStateChange={changed}
          isExecuting={false}
          overallProgress={null}
          displayNodeProgress={0}
        />
      );
    });

    expect(container.querySelector('video')?.getAttribute('src')).toContain('second.mp4');
    expect(container.querySelector('video')?.loop).toBe(false);
    await act(async () => {
      container.querySelector('video')?.dispatchEvent(new Event('ended', { bubbles: true }));
    });
    expect(container.querySelector('video')?.getAttribute('src')).toContain('first.mp4');
    expect(changed).toHaveBeenCalledWith({ activeIndex: 0 });

    const mode = container.querySelector<HTMLButtonElement>('button[aria-label="Playback mode: cycle"]')!;
    await act(async () => mode.click());
    expect(changed).toHaveBeenCalledWith({ playMode: 'off' });

    const first = container.querySelector<HTMLButtonElement>('button[aria-label="Show preview 1"]')!;
    await act(async () => first.click());
    expect(container.querySelector('video')?.getAttribute('src')).toContain('first.mp4');
    expect(first.getAttribute('aria-pressed')).toBe('true');
  });

  it('pauses another workflow preview when a video starts playing', async () => {
    await act(async () => {
      root.render(
        <>
          <NodeCardOutputPreview
            show
            previewImage={{ filename: 'first.mp4', subfolder: '', type: 'output' }}
            displayName="First"
            isExecuting={false}
            overallProgress={null}
            displayNodeProgress={0}
          />
          <NodeCardOutputPreview
            show
            previewImage={{ filename: 'second.mp4', subfolder: '', type: 'output' }}
            displayName="Second"
            isExecuting={false}
            overallProgress={null}
            displayNodeProgress={0}
          />
        </>
      );
    });

    const videos = document.querySelectorAll<HTMLVideoElement>('video');
    pauseSpy.mockClear();
    await act(async () => {
      videos[1].dispatchEvent(new Event('play', { bubbles: true }));
    });
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy.mock.instances[0]).toBe(videos[0]);
  });

  it('pauses inline playback while the fullscreen viewer is open', async () => {
    await act(async () => {
      root.render(
        <NodeCardOutputPreview
          show
          previewImage={{ filename: 'inline.mp4', subfolder: '', type: 'output' }}
          displayName="Inline"
          isExecuting={false}
          overallProgress={null}
          displayNodeProgress={0}
        />
      );
    });

    const video = container.querySelector<HTMLVideoElement>('video');
    pauseSpy.mockClear();
    await act(async () => {
      useImageViewerStore.getState().setViewerState({ viewerOpen: true });
    });
    expect(pauseSpy.mock.instances).toContain(video);
  });

  it('shows a recoverable error over a video whose playback fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => {
      root.render(
        <NodeCardOutputPreview
          show
          previewImage={{ filename: 'broken.mov', subfolder: '', type: 'temp' }}
          displayName="Broken video"
          isExecuting={false}
          overallProgress={null}
          displayNodeProgress={0}
        />
      );
    });

    const video = document.querySelector<HTMLVideoElement>('video');
    await act(async () => {
      video?.dispatchEvent(new Event('error', { bubbles: true }));
    });
    expect(container.textContent).toContain('Unable to play this video.');
    expect(warn).toHaveBeenCalledWith(
      '[video] Playback issue',
      expect.objectContaining({ context: 'workflow output preview', kind: 'error' }),
    );

    await act(async () => {
      video?.dispatchEvent(new Event('canplay', { bubbles: true }));
    });
    expect(container.textContent).not.toContain('Unable to play this video.');
  });

  it('autoplays only when initially visible and pauses when the preview is hidden', async () => {
    let intersectionCallback: IntersectionObserverCallback | null = null;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
      observe() {}
      disconnect = disconnect;
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = '';
      thresholds = [0.01];
    });

    await act(async () => {
      root.render(
        <NodeCardOutputPreview
          show
          previewImage={{ filename: 'visible.mp4', subfolder: '', type: 'output' }}
          displayName="Visible video"
          isExecuting={false}
          overallProgress={null}
          displayNodeProgress={0}
        />
      );
    });
    const video = container.querySelector<HTMLVideoElement>('video');
    expect(playSpy).not.toHaveBeenCalled();

    await act(async () => {
      intersectionCallback?.([
        { isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry,
      ], {} as IntersectionObserver);
    });
    expect(playSpy).toHaveBeenCalledTimes(1);

    pauseSpy.mockClear();
    await act(async () => {
      intersectionCallback?.([
        { isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry,
      ], {} as IntersectionObserver);
    });
    expect(pauseSpy).toHaveBeenCalledWith();
    expect(pauseSpy.mock.instances).toContain(video);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('does not autoplay later when the preview was hidden on arrival', async () => {
    let intersectionCallback: IntersectionObserverCallback | null = null;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = '';
      thresholds = [0.01];
    });

    await act(async () => {
      root.render(
        <NodeCardOutputPreview
          show
          previewImage={{ filename: 'initially-hidden.mp4', subfolder: '', type: 'output' }}
          displayName="Hidden video"
          isExecuting={false}
          overallProgress={null}
          displayNodeProgress={0}
        />
      );
    });

    await act(async () => {
      intersectionCallback?.([
        { isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry,
      ], {} as IntersectionObserver);
      intersectionCallback?.([
        { isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry,
      ], {} as IntersectionObserver);
    });
    expect(playSpy).not.toHaveBeenCalled();
  });
});

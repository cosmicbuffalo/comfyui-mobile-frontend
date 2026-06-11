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
    src: 'http://example.local/clip.mp4',
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

describe('MediaViewer workflow availability', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getFileWorkflowAvailabilityMock.mockReset();
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

    await flushEffects();
    await flushEffects();

    expect(getFileWorkflowAvailabilityMock).toHaveBeenCalledWith(
      'renders/clip.mp4',
      'output',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      document.querySelector('button[aria-label="Load workflow"]'),
    ).not.toBeNull();
  });

  it('keeps load workflow button hidden for video when availability endpoint reports false', async () => {
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

    await flushEffects();
    await flushEffects();

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
});

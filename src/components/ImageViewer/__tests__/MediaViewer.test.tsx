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
});

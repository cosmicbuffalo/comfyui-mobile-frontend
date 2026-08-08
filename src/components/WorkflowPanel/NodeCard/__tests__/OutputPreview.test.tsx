import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeCardOutputPreview } from '@/components/WorkflowPanel/NodeCard/OutputPreview';
import { getImagePreviewUrl } from '@/api/client';

describe('NodeCardOutputPreview', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
});

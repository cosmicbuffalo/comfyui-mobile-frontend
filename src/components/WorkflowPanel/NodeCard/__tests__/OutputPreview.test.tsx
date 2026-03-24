import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeCardOutputPreview } from '@/components/WorkflowPanel/NodeCard/OutputPreview';
import { getImageUrl } from '@/api/client';

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
    expect(image?.getAttribute('src')).toBe(
      getImageUrl(previewImage.filename, previewImage.subfolder, previewImage.type)
    );
  });
});

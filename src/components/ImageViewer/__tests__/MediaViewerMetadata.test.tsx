import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaViewerMetadata } from '../MediaViewer/Metadata';

describe('MediaViewerMetadata seeds', () => {
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

  async function render(seeds: number[] | undefined) {
    await act(async () => {
      root.render(
        <MediaViewerMetadata
          isVideo={false}
          showMetadataToggle
          showMetadataOverlay
          metadataIsLoading={false}
          metadata={{ model: 'a-model', seeds }}
          durationLabel=""
        />,
      );
    });
    return container.querySelector('.viewer-seed-badge');
  }

  it('names a single seed in the singular', async () => {
    expect((await render([3947389889]))?.textContent).toBe('seed: 3947389889');
  });

  it('lists every seed the run used', async () => {
    // A video workflow routinely carries one seed per sampler stage; naming
    // only the first would attribute the image to the wrong one.
    expect((await render([3947389889, 2795446733]))?.textContent)
      .toBe('seeds: 3947389889, 2795446733');
  });

  it('shows no badge for an output whose prompt carried no seed', async () => {
    expect(await render(undefined)).toBeNull();
  });
});

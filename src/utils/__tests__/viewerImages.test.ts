import { describe, expect, it } from 'vitest';
import { buildViewerImages, type HistoryImageItem } from '../viewerImages';

describe('buildViewerImages', () => {
  const items: HistoryImageItem[] = [
    {
      outputs: {
        images: [
          { filename: 'saved-a.png', subfolder: 'out', type: 'output' },
          { filename: 'preview-a.png', subfolder: 'tmp', type: 'temp' },
          { filename: 'saved-b.png', subfolder: 'out', type: 'output' },
        ],
      },
      prompt: {},
    },
  ];

  it('includes preview/temp images by default and preserves source order', () => {
    const images = buildViewerImages(items, { alt: 'Generation' });
    expect(images.map((img) => img.filename)).toEqual([
      'saved-a.png',
      'preview-a.png',
      'saved-b.png',
    ]);
  });

  it('can filter to output-only images when requested', () => {
    const images = buildViewerImages(items, { onlyOutput: true, alt: 'Generation' });
    expect(images.map((img) => img.filename)).toEqual([
      'saved-a.png',
      'saved-b.png',
    ]);
  });
});

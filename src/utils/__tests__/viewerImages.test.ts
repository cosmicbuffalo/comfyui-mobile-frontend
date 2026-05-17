import { describe, expect, it } from 'vitest';
import {
  buildOutputPreferredViewerImages,
  buildViewerImages,
  type HistoryImageItem,
} from '../viewerImages';

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

  it('prefers output images and skips previews when outputs exist', () => {
    const images = buildOutputPreferredViewerImages(items, { alt: 'Generation' });
    expect(images.map((img) => img.filename)).toEqual([
      'saved-a.png',
      'saved-b.png',
    ]);
  });

  it('falls back to previews when there are no output images', () => {
    const previewOnlyItems: HistoryImageItem[] = [
      {
        outputs: {
          images: [
            { filename: 'preview-a.png', subfolder: 'tmp', type: 'temp' },
            { filename: 'preview-b.png', subfolder: 'tmp', type: 'temp' },
          ],
        },
        prompt: {},
      },
    ];

    const images = buildOutputPreferredViewerImages(previewOnlyItems, { alt: 'Generation' });
    expect(images.map((img) => img.filename)).toEqual([
      'preview-a.png',
      'preview-b.png',
    ]);
  });
});

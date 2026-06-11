import { describe, expect, it } from 'vitest';
import type { HistoryOutputImage } from '@/api/types';
import {
  getBatchSources,
  getDisplayableQueueOutputs,
  getPromptInputImages,
  preserveQueueImageOrder,
} from '../queueUtils';
import type { UnifiedItem } from '../types';

const output = (
  filename: string,
  type: HistoryOutputImage['type'] = 'output',
  subfolder = '',
): HistoryOutputImage => ({
  filename,
  subfolder,
  type,
});

describe('queueUtils', () => {
  it('filters temporary video refs but keeps saved video outputs and image previews', () => {
    const items = [
      output('saved-video.mp4'),
      output('preview-video.mp4', 'temp'),
      output('preview-image.png', 'temp'),
      output('saved-image.png'),
      output(''),
    ];

    expect(getDisplayableQueueOutputs(items)).toEqual([
      output('saved-video.mp4'),
      output('preview-image.png', 'temp'),
      output('saved-image.png'),
    ]);
  });

  it('only includes input images when requested', () => {
    const items = [
      output('source.png', 'input'),
      output('preview-image.png', 'temp'),
      output('saved-image.png'),
    ];

    expect(getDisplayableQueueOutputs(items)).toEqual([
      output('preview-image.png', 'temp'),
      output('saved-image.png'),
    ]);
    expect(getDisplayableQueueOutputs(items, { includeInputImages: true })).toEqual([
      output('source.png', 'input'),
      output('preview-image.png', 'temp'),
      output('saved-image.png'),
    ]);
  });

  it('preserves live media order when history returns matching outputs in another order', () => {
    expect(preserveQueueImageOrder(
      [
        'output/video/clip.mp4',
        'output/images/still.png',
      ],
      [
        output('new.png', 'output', 'images'),
        output('still.png', 'output', 'images'),
        output('clip.mp4', 'output', 'video'),
      ],
    )).toEqual([
      output('clip.mp4', 'output', 'video'),
      output('still.png', 'output', 'images'),
      output('new.png', 'output', 'images'),
    ]);
  });

  it('extracts load image inputs from a prompt', () => {
    expect(getPromptInputImages({
      '1': {
        class_type: 'LoadImage',
        inputs: { image: 'poses/source.png' },
      },
      '2': {
        class_type: 'KSampler',
        inputs: { image: 'not-a-load-image.png' },
      },
      '3': {
        class_type: 'Comfy_Load_Image',
        inputs: { image: { filename: 'mask.png', subfolder: 'masks', type: 'input' } },
      },
      '4': {
        class_type: 'LoadImage',
        inputs: { image: 'poses/source.png' },
      },
    })).toEqual([
      output('source.png', 'input', 'poses'),
      output('mask.png', 'input', 'masks'),
    ]);
  });

  it('does not include temporary video refs in batch download sources', () => {
    const list: UnifiedItem[] = [
      {
        id: 'prompt-1',
        status: 'done',
        timestamp: 123,
        data: {
          prompt_id: 'prompt-1',
          timestamp: 123,
          outputs: {
            images: [
              output('saved-video.mp4'),
              output('preview-video.mp4', 'temp'),
              output('preview-image.png', 'temp'),
            ],
          },
          prompt: {},
        },
      },
    ];

    expect(getBatchSources('prompt-1', list)).toEqual([
      '/view?filename=saved-video.mp4&subfolder=&type=output',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import type { HistoryOutputImage } from '@/api/types';
import {
  compareUnifiedQueueItems,
  getBatchSources,
  getDisplayableQueueOutputs,
  getPromptInputImages,
  isQueueItemHidden,
  isPendingSectionCollapsed,
  shouldLatchPendingAutoCollapse,
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
  it('identifies hidden completed and live queue items', () => {
    const hiddenHistory: UnifiedItem = {
      id: 'done-hidden',
      status: 'done',
      data: {
        prompt_id: 'done-hidden',
        timestamp: 1,
        outputs: { images: [] },
        prompt: {},
        hidden: true,
      },
    };
    const hiddenPending: UnifiedItem = {
      id: 'pending-hidden',
      status: 'pending',
      data: {
        number: 1,
        prompt_id: 'pending-hidden',
        prompt: {},
        extra: { mobile_hidden_workflow: true },
        outputs_to_execute: [],
      },
    };
    const visiblePending: UnifiedItem = {
      ...hiddenPending,
      id: 'pending-visible',
      data: { ...hiddenPending.data, extra: {} },
    };

    expect(isQueueItemHidden(hiddenHistory)).toBe(true);
    expect(isQueueItemHidden(hiddenPending)).toBe(true);
    expect(isQueueItemHidden(visiblePending)).toBe(false);
  });

  it('shows pending above running with the next-to-run prompt at the pending bottom', () => {
    const queueItem = (
      id: string,
      status: UnifiedItem['status'],
      number: number,
    ): UnifiedItem => ({
      id,
      status,
      data: {
        number,
        prompt_id: id,
        prompt: {},
        extra: {},
        outputs_to_execute: [],
      },
    });
    const items: UnifiedItem[] = [
      queueItem('append-newer', 'pending', 8),
      queueItem('front-older', 'pending', -4),
      queueItem('running', 'running', 2),
      queueItem('append-older', 'pending', 7),
      queueItem('front-newer', 'pending', -5),
      {
        id: 'done',
        status: 'done',
        timestamp: 10,
        data: {
          prompt_id: 'done',
          timestamp: 10,
          outputs: { images: [] },
          prompt: {},
        },
      },
    ];

    expect(items.sort(compareUnifiedQueueItems).map((item) => item.id)).toEqual([
      'append-newer',
      'append-older',
      'front-older',
      'front-newer',
      'running',
      'done',
    ]);
  });

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

describe('isPendingSectionCollapsed', () => {
  it('leaves a short pending list open', () => {
    expect(isPendingSectionCollapsed(null, 0)).toBe(false);
    expect(isPendingSectionCollapsed(null, 2)).toBe(false);
  });

  it('folds a batch bigger than the threshold', () => {
    expect(isPendingSectionCollapsed(null, 3)).toBe(true);
    expect(isPendingSectionCollapsed(null, 40)).toBe(true);
  });

  it('lets an explicit choice override the count either way', () => {
    // Unfolding a 40-job batch must stick, and folding a 1-job one too.
    expect(isPendingSectionCollapsed(false, 40)).toBe(false);
    expect(isPendingSectionCollapsed(true, 1)).toBe(true);
  });
});

describe('shouldLatchPendingAutoCollapse', () => {
  it('latches the first time a batch is big enough to fold itself', () => {
    expect(shouldLatchPendingAutoCollapse(null, 3)).toBe(true);
    expect(shouldLatchPendingAutoCollapse(null, 40)).toBe(true);
  });

  it('does not latch a batch that was never folded', () => {
    expect(shouldLatchPendingAutoCollapse(null, 0)).toBe(false);
    expect(shouldLatchPendingAutoCollapse(null, 2)).toBe(false);
  });

  it('never overrules a choice the reader has already made', () => {
    // Having unfolded a big batch by hand, it must not be re-folded from under
    // them on the next poll.
    expect(shouldLatchPendingAutoCollapse(false, 40)).toBe(false);
    // And a standing fold needs no re-writing.
    expect(shouldLatchPendingAutoCollapse(true, 40)).toBe(false);
  });

  it('is what stops a draining queue unfolding itself', () => {
    // The whole point, as a sequence. A batch of five arrives with nothing on
    // record, so it folds and that answer is written down…
    let override: boolean | null = null;
    expect(isPendingSectionCollapsed(override, 5)).toBe(true);
    expect(shouldLatchPendingAutoCollapse(override, 5)).toBe(true);
    override = true;

    // …and now the count can fall as far as it likes without opening it. Read
    // live instead of latched, a count of 2 here would report `false` and drop
    // the remaining cards into the top of the list unasked.
    for (const remaining of [4, 3, 2, 1]) {
      expect(isPendingSectionCollapsed(override, remaining)).toBe(true);
      expect(shouldLatchPendingAutoCollapse(override, remaining)).toBe(false);
    }
    expect(isPendingSectionCollapsed(null, 2)).toBe(false);

    // Refilling does not re-decide anything either; it is already folded.
    expect(isPendingSectionCollapsed(override, 30)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { HistoryOutputImage } from '@/api/types';
import {
  getQueueMediaSignature,
  shouldHoldPreviousQueueMedia,
} from '../queueMediaHandoff';

const image = (
  filename: string,
  type: HistoryOutputImage['type'],
): HistoryOutputImage => ({ filename, subfolder: '', type });

describe('queue media handoff', () => {
  it('holds a websocket preview until different final media is ready', () => {
    const preview = [image('preview.png', 'temp')];
    const final = [image('final.png', 'output')];

    expect(shouldHoldPreviousQueueMedia({
      isDone: true,
      previousImages: preview,
      nextImages: final,
      readySignature: null,
    })).toBe(true);

    expect(shouldHoldPreviousQueueMedia({
      isDone: true,
      previousImages: preview,
      nextImages: final,
      readySignature: getQueueMediaSignature(final),
    })).toBe(false);
  });

  it('does not delay matching media or initial history rendering', () => {
    const final = [image('final.png', 'output')];

    expect(shouldHoldPreviousQueueMedia({
      isDone: true,
      previousImages: final,
      nextImages: final,
      readySignature: null,
    })).toBe(false);
    expect(shouldHoldPreviousQueueMedia({
      isDone: true,
      previousImages: [],
      nextImages: final,
      readySignature: null,
    })).toBe(false);
  });
});

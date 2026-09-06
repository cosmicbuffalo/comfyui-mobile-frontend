import { describe, expect, it } from 'vitest';
import {
  MASK_HISTORY_MEMORY_BUDGET_BYTES,
  MAX_MASK_HISTORY_STEPS,
  MIN_MASK_HISTORY_STEPS,
  maskHistoryLimitForDimensions,
} from '../historyLimit';

describe('maskHistoryLimitForDimensions', () => {
  it('keeps the full history for small images', () => {
    expect(maskHistoryLimitForDimensions(512, 512)).toBe(MAX_MASK_HISTORY_STEPS);
  });

  it('scales common larger images against the raw history budget', () => {
    expect(maskHistoryLimitForDimensions(1024, 1024)).toBe(12);
    expect(maskHistoryLimitForDimensions(1920, 1080)).toBe(6);
    expect(maskHistoryLimitForDimensions(2048, 2048)).toBe(3);
  });

  it('keeps only two states for very large images', () => {
    expect(maskHistoryLimitForDimensions(3840, 2160)).toBe(MIN_MASK_HISTORY_STEPS);
    expect(maskHistoryLimitForDimensions(4096, 4096)).toBe(MIN_MASK_HISTORY_STEPS);
  });

  it('never returns more steps than the byte budget allows above the minimum', () => {
    const width = 1536;
    const height = 1536;
    const steps = maskHistoryLimitForDimensions(width, height);
    expect(steps * width * height * 8).toBeLessThanOrEqual(MASK_HISTORY_MEMORY_BUDGET_BYTES);
  });

  it('fails closed to the minimum for invalid dimensions', () => {
    expect(maskHistoryLimitForDimensions(0, 1024)).toBe(MIN_MASK_HISTORY_STEPS);
    expect(maskHistoryLimitForDimensions(Number.NaN, 1024)).toBe(MIN_MASK_HISTORY_STEPS);
  });
});

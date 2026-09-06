import { describe, expect, it } from 'vitest';
import { hasDotHiddenPathSegment } from '@/utils/hiddenPath';

describe('hasDotHiddenPathSegment', () => {
  it('recognizes hidden model names and folders on either path separator', () => {
    expect(hasDotHiddenPathSegment('.hidden.safetensors')).toBe(true);
    expect(hasDotHiddenPathSegment('models/.hidden/model.safetensors')).toBe(true);
    expect(hasDotHiddenPathSegment('models\\.hidden\\model.safetensors')).toBe(true);
    expect(hasDotHiddenPathSegment('models/public/model.safetensors')).toBe(false);
  });
});

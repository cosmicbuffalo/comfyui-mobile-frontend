import { afterEach, describe, expect, it, vi } from 'vitest';
import { processDynamicPrompt } from '../dynamicPrompts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('processDynamicPrompt', () => {
  it('strips line and block comments', () => {
    expect(processDynamicPrompt('a cat // with a hat\n/* draft */on a mat')).toBe('a cat \non a mat');
  });

  it('picks one option per choice block, recursing into the pick', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    expect(processDynamicPrompt('a {red|{pale|deep} blue} sky')).toBe('a deep blue sky');
  });

  it('keeps escaped braces and bars literal', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(processDynamicPrompt('\\{literal\\|text\\} and {one|two}')).toBe('{literal|text} and one');
  });

  it('leaves plain text alone', () => {
    expect(processDynamicPrompt('masterpiece, best quality')).toBe('masterpiece, best quality');
  });
});

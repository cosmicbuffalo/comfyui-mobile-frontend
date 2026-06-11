import { describe, expect, it } from 'vitest';
import {
  fuzzyMatch,
  isSubsequence,
  normalizeSearchText,
  normalizeTypes,
} from '@/utils/workflowSearch';

describe('normalizeTypes', () => {
  it('splits, trims, upper-cases and drops empties', () => {
    expect(normalizeTypes('image, MASK ,, latent')).toEqual(['IMAGE', 'MASK', 'LATENT']);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeTypes('')).toEqual([]);
  });
});

describe('normalizeSearchText', () => {
  it('lower-cases and collapses underscores/dashes/whitespace', () => {
    expect(normalizeSearchText('Load__Image-Node   v2')).toBe('load image node v2');
  });
});

describe('isSubsequence', () => {
  it('matches in-order non-contiguous chars', () => {
    expect(isSubsequence('ace', 'abcde')).toBe(true);
  });

  it('rejects out-of-order chars', () => {
    expect(isSubsequence('aec', 'abcde')).toBe(false);
  });

  it('treats empty needle as a match', () => {
    expect(isSubsequence('', 'anything')).toBe(true);
  });
});

describe('fuzzyMatch', () => {
  it('matches when every token is a substring', () => {
    expect(fuzzyMatch('load image', 'Load Image Node')).toBe(true);
  });

  it('matches via subsequence when not a substring', () => {
    // "ksmpl" is a subsequence of "ksampler"
    expect(fuzzyMatch('ksmpl', 'KSampler')).toBe(true);
  });

  it('fails when a token matches neither substring nor subsequence', () => {
    expect(fuzzyMatch('zzz', 'KSampler')).toBe(false);
  });

  it('is separator-insensitive', () => {
    expect(fuzzyMatch('load-image', 'load image')).toBe(true);
  });

  it('returns true for blank query', () => {
    expect(fuzzyMatch('   ', 'anything')).toBe(true);
  });
});

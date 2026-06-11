import { describe, expect, it } from 'vitest';
import { getSelectionRangeIds } from '@/utils/selectionRange';

describe('getSelectionRangeIds', () => {
  it('returns the inclusive range between anchor and target', () => {
    expect(getSelectionRangeIds(['a', 'b', 'c', 'd'], 'b', 'd')).toEqual(['b', 'c', 'd']);
  });

  it('handles reverse ranges', () => {
    expect(getSelectionRangeIds(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  it('returns null when the anchor is not available', () => {
    expect(getSelectionRangeIds(['a', 'b', 'c'], null, 'c')).toBeNull();
    expect(getSelectionRangeIds(['a', 'b', 'c'], 'x', 'c')).toBeNull();
  });
});

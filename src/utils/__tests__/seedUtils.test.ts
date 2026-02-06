import { describe, it, expect } from 'vitest';
import {
  isSpecialSeedValue,
  getSpecialSeedMode,
  getSpecialSeedValueForMode,
  getSeedRandomBounds,
  SPECIAL_SEED_RANDOM,
  SPECIAL_SEED_INCREMENT,
  SPECIAL_SEED_DECREMENT,
  DEFAULT_SPECIAL_SEED_RANGE
} from '../seedUtils';

describe('isSpecialSeedValue', () => {
  it('returns true for -1, -2, -3', () => {
    expect(isSpecialSeedValue(-1)).toBe(true);
    expect(isSpecialSeedValue(-2)).toBe(true);
    expect(isSpecialSeedValue(-3)).toBe(true);
  });

  it('returns false for other values', () => {
    expect(isSpecialSeedValue(0)).toBe(false);
    expect(isSpecialSeedValue(1)).toBe(false);
    expect(isSpecialSeedValue(-4)).toBe(false);
    expect(isSpecialSeedValue(42)).toBe(false);
  });
});

describe('getSpecialSeedMode', () => {
  it('maps special seed values to modes', () => {
    expect(getSpecialSeedMode(SPECIAL_SEED_RANDOM)).toBe('randomize');
    expect(getSpecialSeedMode(SPECIAL_SEED_INCREMENT)).toBe('increment');
    expect(getSpecialSeedMode(SPECIAL_SEED_DECREMENT)).toBe('decrement');
  });

  it('returns null for non-special values', () => {
    expect(getSpecialSeedMode(0)).toBeNull();
    expect(getSpecialSeedMode(42)).toBeNull();
  });
});

describe('getSpecialSeedValueForMode', () => {
  it('maps modes to special seed values', () => {
    expect(getSpecialSeedValueForMode('randomize')).toBe(SPECIAL_SEED_RANDOM);
    expect(getSpecialSeedValueForMode('increment')).toBe(SPECIAL_SEED_INCREMENT);
    expect(getSpecialSeedValueForMode('decrement')).toBe(SPECIAL_SEED_DECREMENT);
  });

  it('returns null for fixed mode', () => {
    expect(getSpecialSeedValueForMode('fixed')).toBeNull();
  });

  it('round-trips with getSpecialSeedMode', () => {
    for (const mode of ['randomize', 'increment', 'decrement'] as const) {
      const value = getSpecialSeedValueForMode(mode);
      expect(value).not.toBeNull();
      expect(getSpecialSeedMode(value!)).toBe(mode);
    }
  });
});

describe('getSeedRandomBounds', () => {
  const makeNode = (props?: Record<string, unknown>) =>
    ({ properties: props } as Parameters<typeof getSeedRandomBounds>[0]);

  it('uses defaults when no properties set', () => {
    const result = getSeedRandomBounds(makeNode());
    expect(result).toEqual({ min: 0, max: DEFAULT_SPECIAL_SEED_RANGE });
  });

  it('uses custom min/max from properties', () => {
    const result = getSeedRandomBounds(makeNode({ randomMin: 10, randomMax: 100 }));
    expect(result).toEqual({ min: 10, max: 100 });
  });

  it('clamps to DEFAULT_SPECIAL_SEED_RANGE bounds', () => {
    const result = getSeedRandomBounds(makeNode({
      randomMin: -999999999999999999,
      randomMax: 999999999999999999
    }));
    expect(result.min).toBe(-DEFAULT_SPECIAL_SEED_RANGE);
    expect(result.max).toBe(DEFAULT_SPECIAL_SEED_RANGE);
  });

  it('swaps min and max when min > max', () => {
    const result = getSeedRandomBounds(makeNode({ randomMin: 100, randomMax: 10 }));
    expect(result).toEqual({ min: 10, max: 100 });
  });

  it('handles non-finite values gracefully', () => {
    const result = getSeedRandomBounds(makeNode({ randomMin: NaN, randomMax: Infinity }));
    expect(result).toEqual({ min: 0, max: DEFAULT_SPECIAL_SEED_RANGE });
  });
});

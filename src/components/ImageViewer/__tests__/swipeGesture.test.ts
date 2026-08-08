import { describe, expect, it } from 'vitest';
import { classifySwipe, type SwipeSample } from '../swipeGesture';

function sample(overrides: Partial<SwipeSample> = {}): SwipeSample {
  return {
    dx: 0,
    dy: 0,
    durationMs: 200,
    isFitOrCover: true,
    canPanVertically: false,
    ...overrides,
  };
}

describe('classifySwipe', () => {
  it('pages forward and back on a horizontal flick', () => {
    expect(classifySwipe(sample({ dx: -120 }))).toBe('next');
    expect(classifySwipe(sample({ dx: 120 }))).toBe('previous');
  });

  it('closes on a downward flick', () => {
    expect(classifySwipe(sample({ dy: 140 }))).toBe('close');
  });

  it('ignores an upward flick', () => {
    expect(classifySwipe(sample({ dy: -140 }))).toBeNull();
  });

  it('keeps panning instead of closing when the media is taller than the screen', () => {
    expect(classifySwipe(sample({ dy: 140, canPanVertically: true }))).toBeNull();
  });

  it('does not close on a short downward drag', () => {
    // Past the horizontal threshold but under the (deliberately longer) close one.
    expect(classifySwipe(sample({ dy: 70 }))).toBeNull();
  });

  it('does not close on a slow downward drag', () => {
    expect(classifySwipe(sample({ dy: 140, durationMs: 900 }))).toBeNull();
  });

  it('prefers the dominant axis when a flick is diagonal', () => {
    expect(classifySwipe(sample({ dx: -120, dy: 100 }))).toBe('next');
    expect(classifySwipe(sample({ dx: 40, dy: 140 }))).toBe('close');
  });

  it('still reports a tap for a stationary press', () => {
    expect(classifySwipe(sample({ dx: 2, dy: 3, durationMs: 120 }))).toBe('tap');
  });

  it('leaves navigation off while pinched in', () => {
    expect(classifySwipe(sample({ dx: -120, isFitOrCover: false }))).toBeNull();
  });
});

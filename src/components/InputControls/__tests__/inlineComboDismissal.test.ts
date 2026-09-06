import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  afterCurrentPress,
  guardAgainstGhostClick,
} from '../inlineComboDismissal';

/** Dispatch and report whether anything cancelled it. */
const dispatch = (type: string) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  document.body.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('guardAgainstGhostClick', () => {
  let stop: (() => void) | null = null;
  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
  });

  it('cancels a click that arrives with no pointer press of its own', () => {
    stop = guardAgainstGhostClick();
    // Exactly what a touch device leaves behind after the finger has gone.
    expect(dispatch('mousedown')).toBe(true);
    expect(dispatch('mouseup')).toBe(true);
    expect(dispatch('click')).toBe(true);
  });

  it('stands down the moment the reader starts something new', () => {
    stop = guardAgainstGhostClick();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(dispatch('mousedown')).toBe(false);
    expect(dispatch('click')).toBe(false);
  });

  it('stops watching once the stray click has been taken', () => {
    stop = guardAgainstGhostClick();
    expect(dispatch('click')).toBe(true);
    // A second click is the reader's own.
    expect(dispatch('click')).toBe(false);
  });

  it('gives up on its own if no stray click ever comes', () => {
    vi.useFakeTimers();
    stop = guardAgainstGhostClick();
    vi.advanceTimersByTime(1000);
    expect(dispatch('click')).toBe(false);
  });
});

describe('afterCurrentPress', () => {
  afterEach(() => vi.useRealTimers());

  it('runs shortly after the finger lifts, not on a long timer', () => {
    vi.useFakeTimers();
    const done = vi.fn();
    afterCurrentPress(done);

    vi.advanceTimersByTime(40);
    expect(done).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('touchend'));
    vi.advanceTimersByTime(60);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('does not wait forever when no lift is ever seen', () => {
    vi.useFakeTimers();
    const done = vi.fn();
    afterCurrentPress(done);
    vi.advanceTimersByTime(200);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('can be called off before it fires', () => {
    vi.useFakeTimers();
    const done = vi.fn();
    afterCurrentPress(done)();
    window.dispatchEvent(new Event('pointerup'));
    vi.advanceTimersByTime(500);
    expect(done).not.toHaveBeenCalled();
  });
});

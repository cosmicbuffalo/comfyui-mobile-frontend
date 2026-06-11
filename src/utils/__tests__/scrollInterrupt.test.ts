import { describe, expect, it } from 'vitest';
import { userScrolledSince } from '@/utils/scrollInterrupt';

describe('scrollInterrupt', () => {
  it('marks a wheel gesture as a user scroll', () => {
    const before = Date.now() - 1;
    window.dispatchEvent(new Event('wheel'));
    expect(userScrolledSince(before)).toBe(true);
  });

  it('marks a touchmove gesture', () => {
    const before = Date.now() - 1;
    window.dispatchEvent(new Event('touchmove'));
    expect(userScrolledSince(before)).toBe(true);
  });

  it('does not report a scroll in the future', () => {
    window.dispatchEvent(new Event('wheel'));
    expect(userScrolledSince(Date.now() + 10_000)).toBe(false);
  });

  it('ignores a pointer tap (down + up, no movement)', () => {
    const before = Date.now() + 1; // strictly after any prior mark in this test
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 5, clientY: 5 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 6, clientY: 6 }));
    expect(userScrolledSince(before)).toBe(false);
  });

  it('treats a pointer drag past the threshold as a scroll', () => {
    const before = Date.now() - 1;
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientX: 0, clientY: 0 }));
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 0, clientY: 20 }));
    expect(userScrolledSince(before)).toBe(true);
  });
});

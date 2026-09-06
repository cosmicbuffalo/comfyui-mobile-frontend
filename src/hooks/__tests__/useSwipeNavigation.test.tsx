import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSwipeNavigation } from '@/hooks/useSwipeNavigation';

let container: HTMLDivElement;
let root: Root;

function Harness({ onSwipeLeft, onSwipeRight }: {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
}) {
  useSwipeNavigation({ onSwipeLeft, onSwipeRight, enabled: true });
  return null;
}

function touchEvent(type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }],
  });
  return event;
}

/** Play a path of [x, y] points as touchstart / touchmove* / touchend. */
function gesture(points: Array<[number, number]>) {
  const dispatched: Event[] = [];
  act(() => {
    document.dispatchEvent(touchEvent('touchstart', points[0][0], points[0][1]));
  });
  for (const [x, y] of points.slice(1)) {
    const move = touchEvent('touchmove', x, y);
    act(() => { document.dispatchEvent(move); });
    dispatched.push(move);
  }
  act(() => { document.dispatchEvent(touchEvent('touchend', 0, 0)); });
  return dispatched;
}

/**
 * A scroll that opens with a sideways flick of `jitter` px — a thumb pivoting
 * before the scroll takes over — and then travels 300px straight up.
 */
function thumbArcScroll(jitter: number): Array<[number, number]> {
  const points: Array<[number, number]> = [[200, 600], [200 + jitter, 585]];
  for (let i = 1; i <= 10; i++) {
    points.push([200 + jitter + Math.round(28 * i / 10), 585 - Math.round(285 * i / 10)]);
  }
  return points;
}

function mount() {
  const onSwipeLeft = vi.fn();
  const onSwipeRight = vi.fn();
  act(() => { root.render(<Harness onSwipeLeft={onSwipeLeft} onSwipeRight={onSwipeRight} />); });
  return { onSwipeLeft, onSwipeRight };
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('useSwipeNavigation', () => {
  it('navigates on a deliberate horizontal swipe', () => {
    const { onSwipeRight } = mount();
    gesture([[100, 400], [140, 404], [180, 408], [220, 410]]);
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it('navigates the other way on a leftward swipe', () => {
    const { onSwipeLeft } = mount();
    gesture([[300, 400], [260, 404], [220, 408], [180, 410]]);
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
  });

  it('ignores a horizontal drag that stays under the threshold', () => {
    const { onSwipeLeft, onSwipeRight } = mount();
    gesture([[100, 400], [130, 403], [140, 405]]);
    expect(onSwipeRight).not.toHaveBeenCalled();
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  it('ignores a straight vertical scroll', () => {
    const { onSwipeLeft, onSwipeRight } = mount();
    const points: Array<[number, number]> = [[200, 600]];
    for (let i = 1; i <= 12; i++) {
      points.push([200 + Math.round(4 * i / 12), 600 - Math.round(300 * i / 12)]);
    }
    gesture(points);
    expect(onSwipeRight).not.toHaveBeenCalled();
    expect(onSwipeLeft).not.toHaveBeenCalled();
  });

  // The regression. Intent locks on the first move past the dead zone, and a
  // thumb pivoting into a scroll reads as sideways in that one sample. These
  // gestures all end up 300px vertical against ~60px horizontal, and used to
  // navigate anyway once the opening flick cleared 28px.
  it.each([29, 32, 40, 60, 90])(
    'ignores a 300px scroll that opened with a %ipx sideways flick',
    (jitter) => {
      const { onSwipeLeft, onSwipeRight } = mount();
      gesture(thumbArcScroll(jitter));
      expect(onSwipeRight).not.toHaveBeenCalled();
      expect(onSwipeLeft).not.toHaveBeenCalled();
    },
  );

  it('hands the scroll back once a gesture that locked sideways turns vertical', () => {
    mount();
    const moves = gesture(thumbArcScroll(32));
    // The move that locks intent decides and returns, so it is never held.
    expect(moves[0].defaultPrevented).toBe(false);
    // The next one is held: sideways is still the best reading of the gesture.
    expect(moves[1].defaultPrevented).toBe(true);
    // From the point it reads as a scroll, every move reaches the compositor —
    // without this the page would stay frozen for the rest of the gesture.
    expect(moves.slice(2).some((move) => move.defaultPrevented)).toBe(false);
  });
});

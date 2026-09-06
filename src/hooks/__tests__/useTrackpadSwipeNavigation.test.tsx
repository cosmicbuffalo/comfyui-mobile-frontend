import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTrackpadSwipeNavigation } from '@/hooks/useTrackpadSwipeNavigation';
import { DESKTOP_MIN_WIDTH } from '@/hooks/useIsDesktop';

let container: HTMLDivElement;
let root: Root;

function Harness({ onSwipeLeft, onSwipeRight }: {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
}) {
  useTrackpadSwipeNavigation({ onSwipeLeft, onSwipeRight });
  return null;
}

/** A horizontal strip that opts out of swipe navigation, like the tab bar. */
function makeIgnoredStrip(): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-swipe-nav-ignore', 'true');
  const strip = document.createElement('div');
  wrapper.appendChild(strip);
  document.body.appendChild(wrapper);
  return strip;
}

function wheel(target: EventTarget, deltaX: number, deltaY = 0) {
  act(() => {
    target.dispatchEvent(
      new WheelEvent('wheel', { deltaX, deltaY, bubbles: true, cancelable: true })
    );
  });
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes(String(DESKTOP_MIN_WIDTH)),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('useTrackpadSwipeNavigation', () => {
  const render = () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    act(() => {
      root.render(<Harness onSwipeLeft={onSwipeLeft} onSwipeRight={onSwipeRight} />);
    });
    return { onSwipeLeft, onSwipeRight };
  };

  it('navigates on a horizontal wheel gesture over ordinary content', () => {
    const { onSwipeLeft } = render();
    const plain = document.createElement('div');
    document.body.appendChild(plain);

    // Past TRIGGER_THRESHOLD (140px) of cumulative horizontal delta.
    wheel(plain, 60);
    wheel(plain, 60);
    wheel(plain, 60);

    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
  });

  /**
   * Normal scrolling around the workflow panel must never switch panels, even
   * when the fingers drift sideways mid-scroll. Once a gesture has scrolled
   * vertically past the lock threshold it is a scroll for its whole lifetime.
   */
  it('does not navigate when a vertical scroll drifts sideways', () => {
    const { onSwipeLeft, onSwipeRight } = render();
    const plain = document.createElement('div');
    document.body.appendChild(plain);

    // A vertical scroll locks the gesture...
    wheel(plain, 0, 120);
    // ...so even heavy sideways drift in the same stream cannot navigate.
    for (let i = 0; i < 8; i += 1) wheel(plain, 80, 0);

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('does not navigate on a diagonal scroll that never becomes clearly horizontal', () => {
    const { onSwipeLeft, onSwipeRight } = render();
    const plain = document.createElement('div');
    document.body.appendChild(plain);

    // dx never reaches 2x dominance over dy; the growing dy locks it as a
    // scroll before the horizontal total could matter.
    for (let i = 0; i < 8; i += 1) wheel(plain, 50, 40);

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('re-arms after an idle gap so a deliberate swipe still works post-scroll', () => {
    vi.useFakeTimers();
    try {
      const { onSwipeLeft } = render();
      const plain = document.createElement('div');
      document.body.appendChild(plain);

      // Scroll locks the current gesture.
      wheel(plain, 0, 120);
      wheel(plain, 80, 0);
      expect(onSwipeLeft).not.toHaveBeenCalled();

      // The idle gap ends the gesture; a fresh horizontal swipe navigates.
      act(() => {
        vi.advanceTimersByTime(300);
      });
      wheel(plain, 80);
      wheel(plain, 80);
      expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The workflow tab strip scrolls horizontally. Its own scroll must survive
   * reaching either end — the previous behaviour only deferred while the strip
   * could still scroll further, so flicking to the last tab navigated away and
   * lost the user's place.
   */
  it('never navigates from a region marked data-swipe-nav-ignore', () => {
    const { onSwipeLeft, onSwipeRight } = render();
    const strip = makeIgnoredStrip();

    // Well past the threshold, in both directions, with no scroll room at all
    // (jsdom reports scrollWidth === clientWidth === 0).
    for (let i = 0; i < 6; i += 1) wheel(strip, 60);
    for (let i = 0; i < 6; i += 1) wheel(strip, -60);

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('honours an ignored region when the wheel target is an SVG child', () => {
    const { onSwipeLeft, onSwipeRight } = render();
    const strip = makeIgnoredStrip();
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.appendChild(path);
    strip.appendChild(svg);

    wheel(path, 60);
    wheel(path, 60);

    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('does not let an ignored region poison a later gesture elsewhere', () => {
    const { onSwipeLeft } = render();
    const strip = makeIgnoredStrip();
    const plain = document.createElement('div');
    document.body.appendChild(plain);

    for (let i = 0; i < 6; i += 1) wheel(strip, 60);
    expect(onSwipeLeft).not.toHaveBeenCalled();

    wheel(plain, 60);
    wheel(plain, 60);
    wheel(plain, 60);
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
  });
});

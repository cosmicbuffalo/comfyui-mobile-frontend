import { useEffect, useRef } from 'react';
import { useIsDesktop } from './useIsDesktop';

interface UseTrackpadSwipeNavigationOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  enabled?: boolean;
}

// Cumulative horizontal delta (px) a gesture must reach before it navigates.
const TRIGGER_THRESHOLD = 140;
// A deliberate two-finger horizontal swipe on a trackpad is nearly pure
// horizontal; diagonal drift while scrolling is not. Demanding 2x dominance
// keeps sloppy scroll starts from reading as navigation.
const HORIZONTAL_INTENT_RATIO = 2;
// Cumulative vertical delta past which a non-horizontal gesture is locked in
// as a scroll for its whole lifetime — sideways drift later in the same
// stream can no longer turn it into a navigation.
const SCROLL_LOCK_THRESHOLD = 60;
// Gap with no wheel events that ends the current gesture, re-arming the next.
const GESTURE_IDLE_MS = 250;

// Regions that opt out of swipe navigation entirely, using the same attribute
// the touch handler honours (useSwipeNavigation). Unlike the scroll check
// below this does not depend on remaining scroll distance: a horizontal strip
// like the workflow tab bar must keep its own gesture even once it is scrolled
// hard against either end, or flicking through tabs throws you into another
// panel just as you reach the last one.
function isSwipeNavIgnored(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('[data-swipe-nav-ignore="true"]'));
}

// True when the event target sits inside a horizontally-scrollable region that
// can still scroll further in the swipe direction — let it scroll instead of
// navigating panels.
function targetCanScrollHorizontally(target: EventTarget | null, deltaX: number): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.body) {
    if (el instanceof HTMLElement) {
      const overflowX = getComputedStyle(el).overflowX;
      if ((overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
        const max = el.scrollWidth - el.clientWidth;
        if (deltaX > 0 && el.scrollLeft < max - 1) return true;
        if (deltaX < 0 && el.scrollLeft > 1) return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Desktop trackpad swipe navigation. A two-finger horizontal swipe on a
 * trackpad reaches the browser as `wheel` events with a dominant `deltaX`;
 * accumulating that lets us drive the same panel navigation the touch swipe
 * handler provides on phones. (True three-finger swipes are captured by the OS
 * and never reach the page, so this maps to the two-finger horizontal gesture.)
 *
 * We claim horizontal-dominant gestures with preventDefault so the browser's
 * own back/forward swipe doesn't fire alongside the panel change. Vertical
 * scrolling is left untouched (we bail before preventing default).
 */
export function useTrackpadSwipeNavigation({
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
}: UseTrackpadSwipeNavigationOptions) {
  const isDesktop = useIsDesktop();
  // Keep the latest handlers in a ref so the listener isn't re-bound each render.
  const handlersRef = useRef({ onSwipeLeft, onSwipeRight });
  useEffect(() => {
    handlersRef.current = { onSwipeLeft, onSwipeRight };
  }, [onSwipeLeft, onSwipeRight]);

  useEffect(() => {
    if (!enabled || !isDesktop) return;

    // Accumulate BOTH axes over the gesture and decide on the cumulative totals
    // — per-event axis checks are jittery across a momentum stream and made the
    // gesture fire inconsistently.
    let accumX = 0;
    let accumY = 0;
    let fired = false;
    let lockedToScroll = false;
    let idleTimer = 0;

    const endGesture = () => {
      accumX = 0;
      accumY = 0;
      fired = false;
      lockedToScroll = false;
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return; // pinch-zoom
      // Opted-out region under the pointer: never navigate from here.
      if (isSwipeNavIgnored(event.target)) return;
      // Let a horizontally-scrollable region under the pointer scroll natively.
      if (targetCanScrollHorizontally(event.target, event.deltaX)) return;

      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(endGesture, GESTURE_IDLE_MS);

      // Already navigated this gesture: keep swallowing its horizontal tail so
      // the browser's own back/forward swipe doesn't fire.
      if (fired) {
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && event.cancelable) {
          event.preventDefault();
        }
        return;
      }

      accumX += event.deltaX;
      accumY += event.deltaY;
      // A gesture locked in as a scroll stays a scroll until the idle gap
      // re-arms — mirrors the touch handler, where a scroll that opened
      // sideways can no longer switch panels.
      if (lockedToScroll) return;
      const horizontal = Math.abs(accumX) >= Math.abs(accumY) * HORIZONTAL_INTENT_RATIO;
      if (!horizontal && Math.abs(accumY) > SCROLL_LOCK_THRESHOLD) {
        lockedToScroll = true;
        return;
      }

      // Once the gesture is clearly horizontal, claim it (suppresses history
      // swipe) even before it reaches the navigation threshold.
      if (
        horizontal
        && Math.abs(event.deltaX) >= Math.abs(event.deltaY) * HORIZONTAL_INTENT_RATIO
        && event.cancelable
      ) {
        event.preventDefault();
      }
      if (!horizontal || Math.abs(accumX) < TRIGGER_THRESHOLD) return;

      if (event.cancelable) event.preventDefault();
      if (accumX > 0) handlersRef.current.onSwipeLeft?.();
      else handlersRef.current.onSwipeRight?.();
      fired = true;
    };

    document.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      document.removeEventListener('wheel', handleWheel);
      window.clearTimeout(idleTimer);
    };
  }, [enabled, isDesktop]);
}

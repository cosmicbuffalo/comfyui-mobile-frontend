import { useCallback, useEffect, useRef, useState } from 'react';

interface SwipeState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isHorizontal: boolean | null;
  isTracking: boolean;
}

interface UseSwipeNavigationOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  enabled?: boolean;
  threshold?: number;
  preventScroll?: boolean;
  deferResetOnSwipe?: boolean;
  deferResetDurationMs?: number;
}

const INTENT_DEAD_ZONE_PX = 28;
const HORIZONTAL_INTENT_RATIO = 1.35;

export function useSwipeNavigation({
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
  enabled = true,
  threshold = 50,
  preventScroll = true,
  deferResetOnSwipe = false,
  deferResetDurationMs = 350
}: UseSwipeNavigationOptions) {
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipeEnabled, setLocalSwipeEnabled] = useState(enabled);
  const swipeRef = useRef<SwipeState | null>(null);
  const resetTimerRef = useRef<number | null>(null);

  // Update local state when prop changes
  useEffect(() => {
    setLocalSwipeEnabled(enabled);
  }, [enabled]);

  const resetSwipeState = useCallback(() => {
    swipeRef.current = null;
    setIsSwiping(false);
  }, []);

  const setSwipeEnabled = useCallback((value: boolean) => {
    setLocalSwipeEnabled(value);
  }, []);

  useEffect(() => {
    if (!swipeEnabled) return;

    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.closest('[data-swipe-nav-ignore="true"]')) return true;
      if (target.isContentEditable) return true;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select';
    };

    // Some controls (e.g. the image comparer slider) want a buffer *around*
    // themselves where swipes are also ignored, so a touch that lands just
    // outside their bounds doesn't trigger navigation. They opt in by setting
    // data-swipe-nav-ignore-margin="<px>"; the rect is inflated by that margin.
    const isInIgnoreDeadZone = (x: number, y: number) => {
      const zones = document.querySelectorAll<HTMLElement>(
        '[data-swipe-nav-ignore-margin]'
      );
      for (const zone of Array.from(zones)) {
        const margin = parseFloat(zone.dataset.swipeNavIgnoreMargin ?? '');
        if (!Number.isFinite(margin) || margin <= 0) continue;
        const r = zone.getBoundingClientRect();
        // A zone with zero width OR height has no real area to guard, and its
        // left/right/top/bottom can still satisfy the comparisons below — skip it.
        if (r.width <= 0 || r.height <= 0) continue;
        if (
          x >= r.left - margin &&
          x <= r.right + margin &&
          y >= r.top - margin &&
          y <= r.bottom + margin
        ) {
          return true;
        }
      }
      return false;
    };

    // The non-passive touchmove listener (needed so a horizontal swipe can
    // preventDefault) is attached only while a candidate gesture is being
    // tracked. A permanently registered non-passive document listener would
    // force every scroll frame app-wide through this handler; detaching as
    // soon as the gesture locks vertical restores compositor scrolling for
    // the rest of that scroll.
    let moveListenerAttached = false;
    const attachMoveListener = () => {
      if (moveListenerAttached) return;
      moveListenerAttached = true;
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
    };
    const detachMoveListener = () => {
      if (!moveListenerAttached) return;
      moveListenerAttached = false;
      document.removeEventListener('touchmove', handleTouchMove);
    };

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (
        isEditableTarget(e.target) ||
        isEditableTarget(document.activeElement) ||
        (touch && isInIgnoreDeadZone(touch.clientX, touch.clientY))
      ) {
        return;
      }
      if (!touch) return;
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      swipeRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        currentX: touch.clientX,
        currentY: touch.clientY,
        isHorizontal: null,
        isTracking: true
      };
      attachMoveListener();
    };

    const handleTouchMove = (e: TouchEvent) => {
      const swipe = swipeRef.current;
      if (!swipe?.isTracking) return;

      const touch = e.touches[0];
      const dx = touch.clientX - swipe.startX;
      const dy = touch.clientY - swipe.startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (swipe.isHorizontal === null) {
        if (absDx > INTENT_DEAD_ZONE_PX || absDy > INTENT_DEAD_ZONE_PX) {
          const isHorizontal =
            absDx > INTENT_DEAD_ZONE_PX && absDx >= absDy * HORIZONTAL_INTENT_RATIO;
          swipe.isHorizontal = isHorizontal;

          if (isHorizontal) {
            // Only start swiping if we have a handler for that direction
            const hasHandler = dx > 0 ? !!onSwipeRight : !!onSwipeLeft;
            if (hasHandler) {
              setIsSwiping(true);
            } else {
              swipe.isTracking = false;
              detachMoveListener();
            }
          } else {
            // Vertical movement: hand the rest of the scroll back to the
            // compositor unless a vertical handler needs the end position.
            const hasHandler = dy > 0 ? !!onSwipeDown : !!onSwipeUp;
            if (!hasHandler) {
              swipe.isTracking = false;
              detachMoveListener();
            }
          }
        }
        return;
      }

      // Both axes are tracked from here on, whichever way intent locked. The
      // end-of-gesture check needs the axis the lock didn't pick, and these are
      // ref writes — nothing renders them, so they cost no re-render.
      swipe.currentX = touch.clientX;
      swipe.currentY = touch.clientY;

      if (swipe.isHorizontal) {
        // Intent locked on the first sample past the dead zone, and one sample
        // is a poor witness: a thumb pivoting into a scroll moves sideways
        // before it moves down. Once the gesture has clearly become a scroll,
        // abandon the swipe candidate — stop preventing default so the rest of
        // it scrolls normally, and stop tracking so touchend can't navigate.
        if (absDy > INTENT_DEAD_ZONE_PX && absDy > absDx * HORIZONTAL_INTENT_RATIO) {
          swipe.isTracking = false;
          setIsSwiping(false);
          detachMoveListener();
          return;
        }
        if (preventScroll && e.cancelable) {
          e.preventDefault();
        }
      }
    };

    const handleTouchEnd = () => {
      detachMoveListener();
      const swipe = swipeRef.current;
      if (!swipe?.isTracking) {
        resetSwipeState();
        return;
      }

      const dx = swipe.currentX - swipe.startX;
      const dy = swipe.currentY - swipe.startY;
      const moveThreshold = threshold || window.innerWidth * 0.25;

      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      let didSwipe = false;
      // The lock was a guess from one early sample; the completed gesture is
      // the evidence. Navigate only if the gesture stayed dominated by the axis
      // it locked to, so a long scroll that opened with a sideways flick is
      // still a scroll by the time the finger lifts.
      if (swipe.isHorizontal === true && absDx >= absDy * HORIZONTAL_INTENT_RATIO) {
        if (dx < -moveThreshold && onSwipeLeft) {
          onSwipeLeft();
          didSwipe = true;
        } else if (dx > moveThreshold && onSwipeRight) {
          onSwipeRight();
          didSwipe = true;
        }
      } else if (swipe.isHorizontal === false && absDy >= absDx * HORIZONTAL_INTENT_RATIO) {
        if (dy < -moveThreshold && onSwipeUp) {
          onSwipeUp();
          didSwipe = true;
        } else if (dy > moveThreshold && onSwipeDown) {
          onSwipeDown();
          didSwipe = true;
        }
      }

      // Delay resetSwipeState to allow panel state to update first
      // This prevents a race condition where isSwiping becomes false
      // before the panel open/close state has updated
      if (didSwipe) {
        if (deferResetOnSwipe) {
          swipeRef.current = null;
          setIsSwiping(false);
          if (resetTimerRef.current !== null) {
            window.clearTimeout(resetTimerRef.current);
          }
          resetTimerRef.current = window.setTimeout(() => {
            resetSwipeState();
            resetTimerRef.current = null;
          }, deferResetDurationMs);
        } else {
          requestAnimationFrame(() => {
            resetSwipeState();
          });
        }
      } else {
        resetSwipeState();
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      detachMoveListener();
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      resetSwipeState();
    };
  }, [swipeEnabled, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, threshold, preventScroll, deferResetOnSwipe, deferResetDurationMs, resetSwipeState]);

  return {
    isSwiping,
    setSwipeEnabled,
    resetSwipeState
  };
}

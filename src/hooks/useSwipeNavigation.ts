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
  const [swipeOffset, setSwipeOffset] = useState(0);
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
    setSwipeOffset(0);
  }, []);

  const setSwipeEnabled = useCallback((value: boolean) => {
    setLocalSwipeEnabled(value);
  }, []);

  useEffect(() => {
    if (!swipeEnabled) return;

    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select';
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) {
        return;
      }
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      const touch = e.touches[0];
      swipeRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        currentX: touch.clientX,
        currentY: touch.clientY,
        isHorizontal: null,
        isTracking: true
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      const swipe = swipeRef.current;
      if (!swipe?.isTracking) return;

      const touch = e.touches[0];
      const dx = touch.clientX - swipe.startX;
      const dy = touch.clientY - swipe.startY;

      if (swipe.isHorizontal === null) {
        if (Math.abs(dx) > 20 || Math.abs(dy) > 20) {
          const isHorizontal = Math.abs(dx) > Math.abs(dy);
          swipe.isHorizontal = isHorizontal;
          
          if (isHorizontal) {
            // Only start swiping if we have a handler for that direction
            const hasHandler = dx > 0 ? !!onSwipeRight : !!onSwipeLeft;
            if (hasHandler) {
              setIsSwiping(true);
            } else {
              swipe.isTracking = false;
            }
          } else {
            // Vertical movement
            const hasHandler = dy > 0 ? !!onSwipeDown : !!onSwipeUp;
            if (!hasHandler) {
              swipe.isTracking = false;
            }
          }
        }
        return;
      }

      if (swipe.isHorizontal) {
        if (preventScroll && e.cancelable) {
          e.preventDefault();
        }
        swipe.currentX = touch.clientX;
        setSwipeOffset(touch.clientX - swipe.startX);
      } else {
        // We don't currently track vertical offset but we could
        swipe.currentY = touch.clientY;
      }
    };

    const handleTouchEnd = () => {
      const swipe = swipeRef.current;
      if (!swipe?.isTracking) {
        resetSwipeState();
        return;
      }

      const dx = swipe.currentX - swipe.startX;
      const dy = swipe.currentY - swipe.startY;
      const moveThreshold = threshold || window.innerWidth * 0.25;

      let didSwipe = false;
      if (swipe.isHorizontal === true) {
        if (dx < -moveThreshold && onSwipeLeft) {
          onSwipeLeft();
          didSwipe = true;
        } else if (dx > moveThreshold && onSwipeRight) {
          onSwipeRight();
          didSwipe = true;
        }
      } else if (swipe.isHorizontal === false) {
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
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
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
    swipeOffset,
    isSwiping,
    setSwipeEnabled,
    resetSwipeState
  };
}

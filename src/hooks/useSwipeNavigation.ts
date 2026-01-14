import { useCallback, useEffect, useRef, useState } from 'react';

interface SwipeState {
  startX: number;
  startY: number;
  currentX: number;
  isHorizontal: boolean | null;
  isTracking: boolean;
}

interface UseSwipeNavigationOptions {
  queueOpen: boolean;
  setQueuePanelOpen: (open: boolean) => void;
  isInputFocused: boolean;
  viewerOpen: boolean;
  menuOpen: boolean;
}

export function useSwipeNavigation({
  queueOpen,
  setQueuePanelOpen,
  isInputFocused,
  viewerOpen,
  menuOpen
}: UseSwipeNavigationOptions) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipeEnabled, setSwipeEnabled] = useState(true);
  const swipeRef = useRef<SwipeState | null>(null);

  const resetSwipeState = useCallback(() => {
    swipeRef.current = null;
    setIsSwiping(false);
    setSwipeOffset(0);
  }, []);

  useEffect(() => {
    // Don't attach listeners when swipe is disabled or overlays are open
    if (!swipeEnabled || isInputFocused || viewerOpen || menuOpen) return;

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
      const touch = e.touches[0];
      swipeRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        currentX: touch.clientX,
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

      // Determine direction on first significant movement
      if (swipe.isHorizontal === null) {
        // Wait for more movement before deciding (20px instead of 10px)
        if (Math.abs(dx) > 20 || Math.abs(dy) > 20) {
          // More lenient horizontal detection - just needs to be more horizontal than vertical
          const isHorizontal = Math.abs(dx) > Math.abs(dy);
          if (isHorizontal) {
            // Check if swiping in valid direction
            const isValidDirection = queueOpen ? dx > 0 : dx < 0;
            if (isValidDirection) {
              swipe.isHorizontal = true;
              setIsSwiping(true);
            } else {
              swipe.isTracking = false;
            }
          } else {
            // Vertical scroll, stop tracking
            swipe.isTracking = false;
          }
        }
        return;
      }

      // We've determined it's a horizontal swipe
      if (swipe.isHorizontal) {
        e.preventDefault();
        swipe.currentX = touch.clientX;
        const offset = touch.clientX - swipe.startX;
        const maxOffset = window.innerWidth;
        if (queueOpen) {
          setSwipeOffset(Math.max(0, Math.min(maxOffset, offset)));
        } else {
          setSwipeOffset(Math.min(0, Math.max(-maxOffset, offset)));
        }
      }
    };

    const handleTouchEnd = () => {
      const swipe = swipeRef.current;
      if (!swipe?.isTracking || swipe.isHorizontal !== true) {
        resetSwipeState();
        return;
      }

      const dx = swipe.currentX - swipe.startX;
      const threshold = window.innerWidth * 0.25;

      if (queueOpen && dx > threshold) {
        setQueuePanelOpen(false);
      } else if (!queueOpen && dx < -threshold) {
        setQueuePanelOpen(true);
      }

      resetSwipeState();
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
      resetSwipeState();
    };
  }, [
    swipeEnabled,
    isInputFocused,
    viewerOpen,
    menuOpen,
    queueOpen,
    setQueuePanelOpen,
    resetSwipeState
  ]);

  return {
    swipeOffset,
    isSwiping,
    setSwipeEnabled,
    resetSwipeState
  };
}

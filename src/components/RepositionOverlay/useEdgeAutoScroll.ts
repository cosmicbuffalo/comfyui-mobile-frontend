import { useCallback, useRef } from "react";
import type { RefObject } from "react";

// Edge auto-scroll tuning: ramp from slow to fast after a short dwell so a brief
// edge touch nudges gently while a sustained one accelerates.
const EDGE_SCROLL_SLOW_PX_PER_SEC = 120;
const EDGE_SCROLL_FAST_PX_PER_SEC = 640;
const EDGE_SCROLL_ACCEL_DELAY_MS = 350;
const EDGE_SCROLL_ACCEL_DURATION_MS = 300;

/**
 * Drives the reposition overlay's edge auto-scroll: while a drag is held in the
 * top/bottom edge zone, scroll the container in that direction, accelerating the
 * longer it dwells. Self-contained — owns its RAF + timing refs.
 *
 * `pendingDragRef` and `isDragging` are read to stop scrolling the instant the
 * drag ends. Call `startAutoScroll(direction)` from the pointer-move edge check
 * and `stopAutoScroll()` on drag end / cleanup.
 */
export function useEdgeAutoScroll(
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  pendingDragRef: RefObject<unknown>,
  isDragging: boolean,
): {
  startAutoScroll: (direction: -1 | 1) => void;
  stopAutoScroll: () => void;
} {
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollDirectionRef = useRef<-1 | 1 | null>(null);
  const autoScrollZoneEnteredAtRef = useRef(0);
  const autoScrollLastFrameAtRef = useRef(0);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current != null) {
      window.cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
    autoScrollDirectionRef.current = null;
    autoScrollZoneEnteredAtRef.current = 0;
    autoScrollLastFrameAtRef.current = 0;
  }, []);

  const startAutoScroll = useCallback(
    (direction: -1 | 1) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const now = performance.now();
      if (autoScrollDirectionRef.current !== direction) {
        autoScrollDirectionRef.current = direction;
        autoScrollZoneEnteredAtRef.current = now;
        autoScrollLastFrameAtRef.current = now;
      }

      if (autoScrollRafRef.current != null) return;

      const tick = (frameNow: number) => {
        const el = scrollContainerRef.current;
        const activeDirection = autoScrollDirectionRef.current;
        if (!el || activeDirection == null || !pendingDragRef.current || !isDragging) {
          autoScrollRafRef.current = null;
          return;
        }

        const lastFrame = autoScrollLastFrameAtRef.current || frameNow;
        const dtMs = Math.max(0, frameNow - lastFrame);
        autoScrollLastFrameAtRef.current = frameNow;

        const zoneElapsed = Math.max(
          0,
          frameNow - autoScrollZoneEnteredAtRef.current - EDGE_SCROLL_ACCEL_DELAY_MS,
        );
        const accelProgress =
          EDGE_SCROLL_ACCEL_DURATION_MS > 0
            ? Math.min(1, zoneElapsed / EDGE_SCROLL_ACCEL_DURATION_MS)
            : 1;
        const speedPxPerSec =
          EDGE_SCROLL_SLOW_PX_PER_SEC +
          (EDGE_SCROLL_FAST_PX_PER_SEC - EDGE_SCROLL_SLOW_PX_PER_SEC) *
            accelProgress;
        const deltaPx = (speedPxPerSec * dtMs) / 1000;

        const prevTop = el.scrollTop;
        const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
        const nextTop = Math.max(
          0,
          Math.min(maxTop, prevTop + activeDirection * deltaPx),
        );
        el.scrollTop = nextTop;

        if (nextTop === prevTop) {
          autoScrollRafRef.current = null;
          return;
        }

        autoScrollRafRef.current = window.requestAnimationFrame(tick);
      };

      autoScrollRafRef.current = window.requestAnimationFrame(tick);
    },
    [isDragging, pendingDragRef, scrollContainerRef],
  );

  return { startAutoScroll, stopAutoScroll };
}

/**
 * Global "did the user just scroll/drag" signal, shared by the programmatic
 * auto-scroll routines (execution-follow and scrollToNode) so a genuine user
 * gesture can interrupt a scroll/reveal that's in flight.
 *
 * Only real input counts: `wheel` and `touchmove` fire solely on user action,
 * and pointer drags are gated by an 8px move threshold so a tap/click doesn't
 * register. Programmatic scrolling fires `scroll` (never wheel/touch/
 * pointermove), so it can't mark itself and won't self-cancel.
 *
 * Listeners are installed once, in capture phase on window, so they fire even
 * if a child stops propagation and never go stale against a remounting element.
 */
let lastUserScrollAt = 0;
let activePointer: { id: number; x: number; y: number } | null = null;

function mark(): void {
  lastUserScrollAt = Date.now();
}

if (typeof window !== "undefined") {
  const opts = { passive: true, capture: true } as const;
  window.addEventListener("wheel", mark, opts);
  window.addEventListener("touchmove", mark, opts);
  window.addEventListener(
    "pointerdown",
    (event: PointerEvent) => {
      activePointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
    },
    opts,
  );
  window.addEventListener(
    "pointermove",
    (event: PointerEvent) => {
      if (!activePointer || activePointer.id !== event.pointerId) return;
      if (
        Math.abs(event.clientX - activePointer.x) >= 8 ||
        Math.abs(event.clientY - activePointer.y) >= 8
      ) {
        mark();
      }
    },
    opts,
  );
  const clearPointer = (event: PointerEvent) => {
    if (activePointer && activePointer.id === event.pointerId) {
      activePointer = null;
    }
  };
  window.addEventListener("pointerup", clearPointer, opts);
  window.addEventListener("pointercancel", clearPointer, opts);
}

/** True if the user performed a scroll/drag gesture strictly after `timestamp`. */
export function userScrolledSince(timestamp: number): boolean {
  return lastUserScrollAt > timestamp;
}

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
let programmaticScrollUntil = 0;
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

/**
 * Declare that the APP is about to move a scroll container, so the `scroll`
 * events that follow are known to be its own doing rather than the user's.
 *
 * The recency test below infers intent, and inference has a floor: `touchmove`
 * marks on any movement at all, so a finger resting or drifting over an open
 * menu counts as a gesture. The queue panel then compensates for an arriving
 * image — a `scrollTop` write nobody asked for — and the menu closes. Nothing
 * about that sequence is a dismissal, and no heuristic can tell so from the
 * outside; the code doing the scrolling is the only thing that knows.
 *
 * `settleMs` covers the gap between the write and the event it provokes: a
 * `scrollTop` assignment reports on the next frame, while a `behavior: smooth`
 * scroll keeps reporting for the length of the animation and needs to say so.
 * The window is a ceiling, not a lock — a real gesture during it still marks,
 * and dismisses as soon as it expires.
 */
export function markProgrammaticScroll(settleMs = 150): void {
  programmaticScrollUntil = Math.max(programmaticScrollUntil, Date.now() + settleMs);
}

/**
 * Whether a `scroll` event arriving now should count as a deliberate
 * scroll-to-dismiss for something opened at `openedAt` (a `Date.now()` stamp).
 *
 * Three things have to be true. The app must not have just scrolled the list
 * itself (see `markProgrammaticScroll`). The open must not still be settling —
 * `graceMs` covers the scroll the opening itself provokes, and the jitter of
 * the finger that is usually still down. And a real gesture must have happened
 * AFTER the open: a fling keeps firing `scroll` for seconds after the finger
 * has left the glass, so "the list moved" is not on its own evidence that the
 * user asked for anything.
 */
export function shouldDismissOnScroll(openedAt: number, graceMs = 150): boolean {
  if (Date.now() < programmaticScrollUntil) return false;
  if (Date.now() - openedAt < graceMs) return false;
  return userScrolledSince(openedAt);
}

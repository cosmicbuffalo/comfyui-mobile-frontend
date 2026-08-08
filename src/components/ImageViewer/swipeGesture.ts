// Which gesture a finished single-pointer drag in the media viewer amounts to.
// Kept apart from MediaViewer's pointer plumbing so the thresholds are readable
// and testable on their own.

export interface SwipeSample {
  dx: number;
  dy: number;
  durationMs: number;
  // True while the image sits at (or very near) its fit/cover scale. A pinched-in
  // image is being panned, not swiped, so navigation stays off until it returns.
  isFitOrCover: boolean;
  // True when the media is taller than the viewport at the current scale, i.e.
  // a vertical drag has somewhere to pan (the same test clampTranslate applies).
  canPanVertically: boolean;
}

export type SwipeGesture = 'next' | 'previous' | 'close' | 'tap' | null;

// A flick, not a slow drag: past this the user is positioning, not gesturing.
const MAX_SWIPE_DURATION_MS = 350;
const MIN_HORIZONTAL_DISTANCE = 60;
// Deliberately longer than the horizontal threshold — a stray downward flick is
// easy to make while reaching across the screen, and dismissing the viewer by
// accident costs more than a missed page turn.
const MIN_CLOSE_DISTANCE = 90;
const MAX_TAP_DURATION_MS = 250;
const MAX_TAP_DISTANCE = 10;

export function classifySwipe({
  dx,
  dy,
  durationMs,
  isFitOrCover,
  canPanVertically,
}: SwipeSample): SwipeGesture {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (durationMs < MAX_TAP_DURATION_MS && absX < MAX_TAP_DISTANCE && absY < MAX_TAP_DISTANCE) {
    return 'tap';
  }
  if (durationMs > MAX_SWIPE_DURATION_MS) return null;

  if (absX > MIN_HORIZONTAL_DISTANCE && absX > absY && isFitOrCover) {
    return dx < 0 ? 'next' : 'previous';
  }
  // Downward flick dismisses — but only with no vertical pan available, so a
  // zoomed-in or taller-than-screen image keeps dragging instead of closing.
  if (dy > MIN_CLOSE_DISTANCE && absY > absX && !canPanVertically) {
    return 'close';
  }
  return null;
}

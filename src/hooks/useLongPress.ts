import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export const LONG_PRESS_MS = 500;
// How far the pointer may drift before the hold is treated as a drag/scroll
// rather than a press. One value for the whole app: two hand-maintained copies
// had drifted to 8px and 10px, which made the same gesture behave differently
// depending on which control you held.
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

interface UseLongPressOptions {
  /** Fired once the hold survives `delayMs` without moving too far. */
  onLongPress: () => void;
  /** Re-checked on every pointerdown; false makes the control press-only. */
  enabled?: boolean;
  delayMs?: number;
  moveTolerancePx?: number;
}

interface UseLongPressResult {
  /** Spread onto the element. Pointer capture keeps move/up routed here even
   *  after the finger leaves the element's box, so a drift that starts on the
   *  control can still cancel the hold. */
  handlers: {
    onPointerDown: (event: ReactPointerEvent<Element>) => void;
    onPointerMove: (event: ReactPointerEvent<Element>) => void;
    onPointerUp: (event: ReactPointerEvent<Element>) => void;
    onPointerCancel: (event: ReactPointerEvent<Element>) => void;
  };
  /**
   * Whether the long press already fired, clearing the flag as it reads.
   * Call this from the click handler: a real pointer click follows pointerup,
   * so without consuming it the hold and the release would both act.
   */
  consumeLongPress: () => boolean;
  /** Cancel a hold in flight (e.g. the control is unmounting or disabling). */
  cancel: () => void;
}

/**
 * Press-and-hold on a pointer target, with drift cancellation.
 *
 * Extracted from the Run button and node-card connection buttons, which had
 * grown near-identical copies of this timer/ref dance.
 */
export function useLongPress({
  onLongPress,
  enabled = true,
  delayMs = LONG_PRESS_MS,
  moveTolerancePx = LONG_PRESS_MOVE_TOLERANCE_PX,
}: UseLongPressOptions): UseLongPressResult {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const triggeredRef = useRef(false);
  // Kept in a ref so a caller passing an inline closure doesn't have to
  // memoize it to avoid re-arming the handlers every render. Only ever read
  // from the timer callback, well after the effect below has run.
  const onLongPressRef = useRef(onLongPress);
  useEffect(() => {
    onLongPressRef.current = onLongPress;
  }, [onLongPress]);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
    pointerIdRef.current = null;
  }, []);

  const consumeLongPress = useCallback(() => {
    const triggered = triggeredRef.current;
    triggeredRef.current = false;
    return triggered;
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<Element>) => {
    // Secondary buttons and non-primary contacts of a multi-touch gesture are
    // not presses.
    if (!enabled || event.button !== 0 || event.isPrimary === false) return;
    cancel();
    triggeredRef.current = false;
    startRef.current = { x: event.clientX, y: event.clientY };
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      triggeredRef.current = true;
      onLongPressRef.current();
    }, delayMs);
  }, [cancel, delayMs, enabled]);

  const onPointerMove = useCallback((event: ReactPointerEvent<Element>) => {
    if (pointerIdRef.current !== event.pointerId || !startRef.current) return;
    const dx = event.clientX - startRef.current.x;
    const dy = event.clientY - startRef.current.y;
    if (Math.hypot(dx, dy) > moveTolerancePx) cancel();
  }, [cancel, moveTolerancePx]);

  const finish = useCallback((event: ReactPointerEvent<Element>) => {
    if (pointerIdRef.current !== event.pointerId) return;
    cancel();
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
    consumeLongPress,
    cancel,
  };
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { createPortal } from "react-dom";

/**
 * Above every panel and bar, below the backend-status overlay. The option list
 * itself sits one step higher again, so it stays lit while the scrim dims
 * everything else.
 */
export const INLINE_COMBO_SCRIM_Z = 2600;
export const INLINE_COMBO_MENU_Z = INLINE_COMBO_SCRIM_Z + 1;

/**
 * How long the scrim element stays after the list closes: only long enough to
 * see out the press that dismissed it. It must not outlast the finger — a
 * full-screen element that does blocks the next scroll.
 */
export const INLINE_SCRIM_LINGER_MS = 150;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function sameRect(a: Rect, b: Rect) {
  return (
    Math.abs(a.top - b.top) < 0.5
    && Math.abs(a.left - b.left) < 0.5
    && Math.abs(a.width - b.width) < 0.5
    && Math.abs(a.height - b.height) < 0.5
  );
}

/**
 * The scrim behind an open inline combo.
 *
 * Two jobs. It absorbs the click that dismisses the list, so putting the list
 * away never also presses the button that happened to be underneath it. And it
 * dims the page around the control and its options — done with a spotlight
 * element whose 9999px box-shadow paints the dim *outside* one rectangle,
 * rather than by raising the control above an overlay, which would depend on
 * every ancestor between here and the body staying free of a stacking context.
 */
export function InlineComboScrim({
  controlRoot,
  dimmed,
  onDismiss,
}: {
  /** The `.combo-control-root` whose menu is open. */
  controlRoot: HTMLElement | null;
  /** False while the scrim lingers after a dismissal — see ComboControl. */
  dimmed: boolean;
  onDismiss: () => void;
}) {
  const [spotlight, setSpotlight] = useState<Rect | null>(null);
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  // The gesture that opened the list has not finished yet. On touch the list
  // opens at touchend, and the compatibility mousedown that follows would land
  // on this scrim — which react-select reads as an outside press and answers by
  // closing the list it has only just opened. So stay transparent to input
  // until that gesture is over, which the trailing click marks.
  useEffect(() => {
    const arm = () => {
      if (armedRef.current) return;
      armedRef.current = true;
      setArmed(true);
    };
    window.addEventListener("click", arm, true);
    // A list opened from the keyboard has no gesture to wait on.
    const timer = window.setTimeout(arm, 400);
    return () => {
      window.removeEventListener("click", arm, true);
      window.clearTimeout(timer);
    };
  }, []);

  useLayoutEffect(() => {
    if (!dimmed) return;
    const control = controlRoot?.querySelector<HTMLElement>(".rs__control");
    if (!control) return;
    // The list is portalled to the body, and only one inline list is ever open.
    const findMenu = () =>
      document.body.querySelector<HTMLElement>(".rs__menu-portal .rs__menu");

    const measure = () => {
      const controlRect = control.getBoundingClientRect();
      const menuRect = findMenu()?.getBoundingClientRect();
      const left = Math.min(controlRect.left, menuRect?.left ?? Infinity);
      const right = Math.max(controlRect.right, menuRect?.right ?? -Infinity);
      const bottom = Math.max(controlRect.bottom, menuRect?.bottom ?? -Infinity);
      const next = {
        top: controlRect.top,
        left,
        width: right - left,
        height: bottom - controlRect.top,
      };
      setSpotlight((previous) =>
        previous && sameRect(previous, next) ? previous : next);
    };

    measure();
    let observer: ResizeObserver | null = null;
    // The list mounts in the same commit as this scrim, so its size is only
    // knowable a frame later; after that a filtered list changes height freely.
    const frame = requestAnimationFrame(() => {
      measure();
      const menu = findMenu();
      if (!menu || typeof ResizeObserver === "undefined") return;
      observer = new ResizeObserver(measure);
      observer.observe(menu);
    });

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [controlRoot, dimmed]);

  // A press on the scrim is spent entirely on putting the list away: the
  // default actions that would otherwise follow it — moving focus, and the
  // whole synthetic mousedown/mouseup/click sequence a touch device generates
  // afterwards — are cancelled, so nothing underneath is focused or pressed.
  //
  // These are native listeners because they must be non-passive to cancel
  // anything, and touch listeners are passive by default.
  useEffect(() => {
    const node = backdropRef.current;
    if (!node) return;
    const swallow = (event: Event) => {
      if (!armedRef.current) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
    };
    const events = ["touchstart", "touchend", "mousedown", "mouseup", "click"];
    events.forEach((name) =>
      node.addEventListener(name, swallow, { passive: false }));
    return () => events.forEach((name) =>
      node.removeEventListener(name, swallow));
  }, []);

  const dismiss = (event: React.PointerEvent) => {
    if (event.cancelable) event.preventDefault();
    // react-select keeps focus on its own input after the list closes; without
    // this the control would still look focused behind a dismissed list.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    onDismiss();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      <div
        ref={backdropRef}
        className="combo-open-backdrop"
        style={{
          zIndex: INLINE_COMBO_SCRIM_Z,
          pointerEvents: armed ? "auto" : "none",
        }}
        onPointerDown={dismiss}
        aria-hidden="true"
      />
      {dimmed && spotlight && (
        <div
          className="combo-open-spotlight"
          style={{ zIndex: INLINE_COMBO_SCRIM_Z, ...spotlight }}
          aria-hidden="true"
        />
      )}
    </>,
    document.body,
  );
}

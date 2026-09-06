import { INLINE_SCRIM_LINGER_MS } from "./InlineComboScrim";

/** How soon after the finger lifts the scrim element goes. */
const AFTER_LIFT_MS = 50;

/**
 * How long a stray click is watched for once the element is gone. Safari can
 * hold a tap's synthetic click back by a few hundred ms, and that late click
 * is what used to land on — and focus — whatever sat under the dismissed list.
 */
const GHOST_CLICK_WINDOW_MS = 700;

/**
 * Cancel the click a dismissing tap leaves behind, without keeping anything on
 * screen to catch it.
 *
 * A full-screen catcher would work, but it also swallows the reader's next
 * scroll, and a touch that begins on a fixed, unscrollable element scrolls
 * nothing. So the wait happens in listeners instead. The stray click is
 * recognisable: it arrives with no `pointerdown` of its own, because the
 * pointer sequence it belongs to ended long ago. Anything that does start with
 * a pointerdown is the reader beginning something new, and ends the wait
 * untouched.
 *
 * Returns a teardown.
 */
export function guardAgainstGhostClick(): () => void {
  let newGesture = false;

  const stop = () => {
    window.clearTimeout(timer);
    document.removeEventListener("pointerdown", onPointerDown, true);
    cancelled.forEach((name) =>
      document.removeEventListener(name, kill, true));
  };

  const onPointerDown = () => {
    newGesture = true;
    stop();
  };

  const kill = (event: Event) => {
    if (newGesture) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
    // click is the last of the three; nothing else is coming.
    if (event.type === "click") stop();
  };

  const cancelled = ["mousedown", "mouseup", "click"];
  const timer = window.setTimeout(stop, GHOST_CLICK_WINDOW_MS);
  document.addEventListener("pointerdown", onPointerDown, true);
  cancelled.forEach((name) => document.addEventListener(name, kill, true));
  return stop;
}

/**
 * Run `whenDone` once the press that is currently underway has finished, so
 * the scrim can be taken down the moment the finger lifts rather than on a
 * timer. Returns a teardown.
 */
export function afterCurrentPress(whenDone: () => void): () => void {
  let timer = window.setTimeout(finish, INLINE_SCRIM_LINGER_MS);

  function finish() {
    stop();
    whenDone();
  }
  function onLift() {
    window.clearTimeout(timer);
    timer = window.setTimeout(finish, AFTER_LIFT_MS);
  }
  function stop() {
    window.clearTimeout(timer);
    window.removeEventListener("pointerup", onLift, true);
    window.removeEventListener("touchend", onLift, true);
    window.removeEventListener("pointercancel", onLift, true);
  }

  window.addEventListener("pointerup", onLift, true);
  window.addEventListener("touchend", onLift, true);
  window.addEventListener("pointercancel", onLift, true);
  return stop;
}

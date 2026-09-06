/** Animation frames to keep looking before falling back to slower retries. */
const FRAME_ATTEMPTS = 10;
/** Slower retries after that, for content that arrives on a later tick. */
const DELAYED_ATTEMPTS = 2;
const DELAY_MS = 200;

/**
 * Run `attempt` until it reports success, or the budget runs out.
 *
 * `onExhausted` is the caller's answer to "it never showed up": a widget row
 * only exists while its card renders it, so a jump aimed at one needs somewhere
 * to land when it does not — the card itself.
 *
 * A jump often changes the scope on its way, so the thing being jumped to does
 * not exist yet when the jump is issued — and the same is true of a card being
 * un-collapsed or a parent group being revealed. Retrying is what lets the
 * caller issue the jump and stop thinking about timing, which is the whole
 * reason there is no longer a `setTimeout` at each call site.
 */
export function retryReveal(attempt: () => boolean, onExhausted?: () => void): void {
  const run = (framesLeft: number, delaysLeft: number) => {
    if (attempt()) return;
    if (framesLeft > 0) {
      requestAnimationFrame(() => run(framesLeft - 1, delaysLeft));
    } else if (delaysLeft > 0) {
      setTimeout(() => run(FRAME_ATTEMPTS, delaysLeft - 1), DELAY_MS);
    } else {
      onExhausted?.();
    }
  };
  run(FRAME_ATTEMPTS, DELAYED_ATTEMPTS);
}

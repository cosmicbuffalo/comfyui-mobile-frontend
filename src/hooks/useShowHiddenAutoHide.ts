import { useEffect } from 'react';
import { useShowHiddenStore } from './useShowHidden';

/** How often the idle wait is checked while the app is on screen. */
const IDLE_POLL_MS = 30_000;

/** Events that count as someone still being here. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'focus'] as const;

/**
 * Turn hidden-file visibility back off once the app has been left alone.
 *
 * Showing hidden files is a deliberate, temporary act — you go looking for
 * something, find it, and then forget the switch is on. Left on, the next
 * person to pick up the phone, or to walk past the desktop, sees everything
 * that was meant to be tucked away.
 *
 * Two ways of being left alone, both on the same preference:
 *
 * - AWAY: the app is backgrounded. `visibilitychange` covers a backgrounded tab
 *   and a phone going to the home screen; `pagehide` is the one iOS Safari can
 *   be relied on for when the tab is discarded. Reporting twice is harmless —
 *   the store keeps the first mark, since both fire for one departure.
 * - IDLE: the tab is open and untouched. A desktop tab left on the outputs page
 *   never fires a visibility event at all, so without this the switch stayed on
 *   for as long as the browser did.
 *
 * The store holds the policy, including which of the two a given wait applies
 * to; this reports the events and ticks the clock.
 */
export function useShowHiddenAutoHide() {
  useEffect(() => {
    const { noteBackgrounded, noteForegrounded, noteActivity, noteIdleCheck } =
      useShowHiddenStore.getState();

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') noteBackgrounded(Date.now());
      else noteForegrounded(Date.now());
    };
    const handleHide = () => { noteBackgrounded(Date.now()); };
    const handleActivity = () => { noteActivity(Date.now()); };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handleHide);
    for (const event of ACTIVITY_EVENTS) {
      // Passive and captured: this only reads that something happened, and must
      // see it even when a handler below stops the event travelling further.
      window.addEventListener(event, handleActivity, { passive: true, capture: true });
    }

    // Polled rather than scheduled off each interaction: a timer re-armed on
    // every pointer event would be re-armed hundreds of times a scroll.
    const poll = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      noteIdleCheck(Date.now());
    }, IDLE_POLL_MS);

    noteActivity(Date.now());

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handleHide);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity, { capture: true });
      }
      clearInterval(poll);
    };
  }, []);
}

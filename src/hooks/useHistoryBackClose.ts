import { useEffect, useRef } from 'react';

/**
 * Shared Android/iOS back-button integration.
 *
 * Each open overlay (fullscreen viewer, app menu) and each subgraph level
 * pushes one browser history entry and registers a close callback. A single
 * popstate listener pops the most recent registration, so pressing Back
 * closes the topmost surface instead of leaving the app — and surfaces never
 * fight over the same pop.
 *
 * Entries are LIFO. Closing a surface through its own UI releases its entry
 * (consuming the pushed history state) so later Back presses aren't silently
 * eaten by leftovers.
 */

type BackCallback = () => void;

const stack: BackCallback[] = [];
let pendingSelfPops = 0;
let listenerInstalled = false;

function ensurePopStateListener() {
  if (listenerInstalled || typeof window === 'undefined') return;
  listenerInstalled = true;
  window.addEventListener('popstate', () => {
    if (pendingSelfPops > 0) {
      pendingSelfPops -= 1;
      return;
    }
    const onBack = stack.pop();
    if (onBack) onBack();
  });
}

/**
 * Push a history entry whose Back press invokes `onBack`. Returns a release
 * function to call when the surface closes through its own UI; it consumes
 * the pushed history entry (no-op if Back already consumed it).
 */
export function pushBackEntry(onBack: BackCallback): () => void {
  ensurePopStateListener();
  window.history.pushState({ mobileBackNav: true }, '');
  stack.push(onBack);
  return function release() {
    const index = stack.lastIndexOf(onBack);
    if (index === -1) return; // Back already consumed it
    const wasTop = index === stack.length - 1;
    stack.splice(index, 1);
    if (wasTop) {
      pendingSelfPops += 1;
      window.history.go(-1);
    }
    // A non-top (out-of-LIFO) close leaves its history entry behind; the
    // next Back still routes to the correct topmost surface, at worst one
    // trailing press is absorbed. In practice closes are LIFO.
  };
}

/**
 * While `isOpen`, the browser/hardware Back button closes the surface via
 * `onClose` instead of navigating away from the app.
 */
export function useHistoryBackClose(isOpen: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!isOpen) return;
    return pushBackEntry(() => onCloseRef.current());
  }, [isOpen]);
}

import { useEffect } from 'react';

// Module-level reference count so overlapping locks (e.g. a modal opened over a
// panel that also locks) compose: the body overflow is captured when the first
// lock engages and restored only when the last one releases.
let lockCount = 0;
let savedOverflow = '';

/**
 * Locks body scroll while `active` is true. Reference-counted across all callers
 * so an unmounting lock can't re-enable scrolling while another is still held.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = savedOverflow;
      }
    };
  }, [active]);
}

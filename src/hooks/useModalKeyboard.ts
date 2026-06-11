import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Keyboard affordances for a fullscreen modal: Escape closes it, and Tab is
 * trapped within `containerRef` so focus can't wander to the page behind it.
 * No-op while `isOpen` is false. Attach `containerRef` to the modal's root.
 *
 * Escape is ignored when a child already handled it (`defaultPrevented`), so a
 * nested control that uses Escape itself (e.g. a dropdown closing its menu)
 * keeps working without closing the whole modal.
 */
export function useModalKeyboard(
  isOpen: boolean,
  onClose: () => void,
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return;
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        // getClientRects (not offsetParent) so visible position:fixed controls
        // are still counted; the activeElement is always kept so the cycle can
        // advance off it even if a layout check is momentarily false.
      ).filter((el) => el.getClientRects().length > 0 || el === document.activeElement);
      if (focusable.length === 0) {
        // Nothing focusable inside: still trap Tab so focus can't move to the
        // page behind the modal.
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const outside = !active || !container.contains(active);

      if (e.shiftKey) {
        if (outside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (outside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, containerRef]);
}

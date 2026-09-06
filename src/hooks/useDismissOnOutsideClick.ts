import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useNavigationStore } from '@/hooks/useNavigation';

interface DismissOnOutsideClickOptions {
  open: boolean;
  onDismiss: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  ignoreScrollWithinContent?: boolean;
}

/**
 * How long after opening a scroll is treated as the opening's own doing rather
 * than a gesture to dismiss by.
 *
 * Opening a menu can itself provoke a scroll — the browser bringing the trigger
 * into view, a layout correction after the list changed height, or momentum
 * from the scroll that preceded the tap still settling. Those land within a
 * frame or two and used to close the menu instantly, which reads as the tap
 * being swallowed: the menu appears and vanishes before it is seen. Measured at
 * 10ms in the wild; this leaves an order of magnitude of headroom while keeping
 * a deliberate scroll-to-dismiss intact.
 */
const SCROLL_DISMISS_GRACE_MS = 150;

export function useDismissOnOutsideClick({
  open,
  onDismiss,
  triggerRef,
  contentRef,
  ignoreScrollWithinContent = false
}: DismissOnOutsideClickOptions) {
  // A menu belongs to the panel it was opened on. Panels stay mounted as you
  // swipe between them, so without this an open menu rides along and sits over
  // the outputs or the queue with nothing underneath it to act on.
  const currentPanel = useNavigationStore((s) => s.currentPanel);
  const openedOnPanel = useRef(currentPanel);
  useEffect(() => {
    if (open) openedOnPanel.current = currentPanel;
    // Deliberately keyed on `open` alone: recording the panel on every panel
    // change would make the check below compare a value with itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (currentPanel !== openedOnPanel.current) onDismiss();
  }, [open, currentPanel, onDismiss]);

  // Escape closes a menu the way it closes everything else. These menus are
  // built from ContextMenuBuilder, which never handled the key, so the only
  // ways out were a tap outside or a scroll.
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onDismiss();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onDismiss]);

  useEffect(() => {
    if (!open) return;
    const openedAt = performance.now();
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        (triggerRef.current && target && triggerRef.current.contains(target)) ||
        (contentRef.current && target && contentRef.current.contains(target))
      ) {
        return;
      }
      onDismiss();
    };
    const handleScroll = (event: Event) => {
      if (performance.now() - openedAt < SCROLL_DISMISS_GRACE_MS) return;
      if (ignoreScrollWithinContent) {
        const target = event.target as Node | null;
        if (contentRef.current && target && contentRef.current.contains(target)) {
          return;
        }
      }
      onDismiss();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, onDismiss, triggerRef, contentRef, ignoreScrollWithinContent]);
}

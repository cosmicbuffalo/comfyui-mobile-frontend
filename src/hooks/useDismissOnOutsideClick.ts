import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useNavigationStore } from '@/hooks/useNavigation';
import { shouldDismissOnScroll } from '@/utils/scrollInterrupt';

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
 * into view, or a layout correction after the list changed height. Those land
 * within a frame or two and used to close the menu instantly, which reads as
 * the tap being swallowed: the menu appears and vanishes before it is seen.
 * Measured at 10ms in the wild; this leaves an order of magnitude of headroom.
 *
 * The window alone was never enough for the case it was written for. Momentum
 * from a fling runs for SECONDS after the finger lifts, so a menu opened during
 * one was still killed by the next momentum frame once the grace expired. That
 * is `shouldDismissOnScroll`'s other half: a scroll only dismisses when a real
 * gesture — a wheel, a touchmove, a pointer drag — happened after the open.
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
  const openedAtRef = useRef(0);
  useEffect(() => {
    if (open) {
      openedOnPanel.current = currentPanel;
      openedAtRef.current = Date.now();
    }
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
    // Callback changes can reinstall listeners while the menu stays open.
    // They must not restart the grace period or erase a newer scroll gesture.
    const openedAt = openedAtRef.current;
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
      if (!shouldDismissOnScroll(openedAt, SCROLL_DISMISS_GRACE_MS)) return;
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

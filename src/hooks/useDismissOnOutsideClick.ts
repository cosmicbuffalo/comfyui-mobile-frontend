import { useEffect } from 'react';
import type { RefObject } from 'react';

interface DismissOnOutsideClickOptions {
  open: boolean;
  onDismiss: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  ignoreScrollWithinContent?: boolean;
}

export function useDismissOnOutsideClick({
  open,
  onDismiss,
  triggerRef,
  contentRef,
  ignoreScrollWithinContent = false
}: DismissOnOutsideClickOptions) {
  useEffect(() => {
    if (!open) return;
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

import { useEffect } from 'react';
import type { RefObject } from 'react';

interface DismissOnOutsideClickOptions {
  open: boolean;
  onDismiss: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  closeOnScroll?: boolean;
}

export function useDismissOnOutsideClick({
  open,
  onDismiss,
  triggerRef,
  contentRef,
  closeOnScroll = true
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
    const handleScroll = () => {
      if (closeOnScroll) {
        onDismiss();
      }
    };
    document.addEventListener('mousedown', handleClick);
    if (closeOnScroll) {
      document.addEventListener('scroll', handleScroll, true);
    }
    return () => {
      document.removeEventListener('mousedown', handleClick);
      if (closeOnScroll) {
        document.removeEventListener('scroll', handleScroll, true);
      }
    };
  }, [open, onDismiss, triggerRef, contentRef, closeOnScroll]);
}

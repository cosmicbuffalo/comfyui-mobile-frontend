import { useEffect, useRef } from 'react';
import { shouldDismissOnScroll } from '@/utils/scrollInterrupt';

export function useQueueMenuDismiss(
  open: boolean,
  onDismiss: () => void,
  menuId: string
) {
  const openedAtRef = useRef(0);
  useEffect(() => {
    if (open) openedAtRef.current = Date.now();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Momentum from the fling that preceded the tap keeps firing `scroll` long
    // after the finger has gone, and closed this menu before it could be read.
    // Only a gesture made after the menu opened counts as scroll-to-dismiss.
    // Queue updates and inline callbacks must not reset the opening time.
    const openedAt = openedAtRef.current;
    const handleScroll = () => {
      if (!shouldDismissOnScroll(openedAt)) return;
      onDismiss();
    };
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const menuEl = document.getElementById(menuId);
      if (menuEl && target && menuEl.contains(target)) return;
      onDismiss();
    };
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open, onDismiss, menuId]);
}

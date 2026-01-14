import { useEffect } from 'react';

export function useQueueMenuDismiss(
  open: boolean,
  onDismiss: () => void,
  menuId: string
) {
  useEffect(() => {
    if (!open) return;
    const handleScroll = () => onDismiss();
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

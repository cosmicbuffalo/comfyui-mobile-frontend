import { useCallback, useLayoutEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';

interface AnchoredMenuPositionOptions {
  open: boolean;
  buttonRef: RefObject<HTMLElement | null>;
  menuRef: RefObject<HTMLElement | null>;
  repositionToken?: unknown;
  menuWidth?: number;
  horizontalAnchorOffset?: number;
  viewportPadding?: number;
  bottomBarReserve?: number;
}

interface AnchoredMenuPositionResult {
  menuPosition: { top: number; left: number } | null;
  menuStyle: CSSProperties;
  resetMenuPosition: () => void;
}

export function useAnchoredMenuPosition({
  open,
  buttonRef,
  menuRef,
  repositionToken,
  menuWidth = 176,
  horizontalAnchorOffset = 160,
  viewportPadding = 8,
  bottomBarReserve = 104
}: AnchoredMenuPositionOptions): AnchoredMenuPositionResult {
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  const resetMenuPosition = useCallback(() => {
    setMenuPosition(null);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const button = buttonRef.current;
      const menu = menuRef.current;
      if (!button || !menu) return;

      const rect = button.getBoundingClientRect();
      const menuHeight = menu.getBoundingClientRect().height;
      const alignedBelowTop = rect.bottom;
      const alignedAboveTop = rect.top - menuHeight;
      const maxBottom = window.innerHeight - bottomBarReserve;
      const canOpenBelow = alignedBelowTop + menuHeight <= maxBottom;
      const canOpenAbove = alignedAboveTop >= viewportPadding;
      const unclampedTop = canOpenBelow
        ? alignedBelowTop
        : canOpenAbove
          ? alignedAboveTop
          : alignedBelowTop;
      const top = Math.max(
        viewportPadding,
        Math.min(unclampedTop, maxBottom - menuHeight)
      );
      const left = Math.max(
        viewportPadding,
        Math.min(
          rect.right - horizontalAnchorOffset,
          window.innerWidth - menuWidth - viewportPadding
        )
      );

      setMenuPosition({ top, left });
    };

    updatePosition();
    const raf1 = requestAnimationFrame(updatePosition);
    const raf2 = requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.removeEventListener('resize', updatePosition);
    };
  }, [
    open,
    buttonRef,
    menuRef,
    menuWidth,
    horizontalAnchorOffset,
    viewportPadding,
    bottomBarReserve,
    repositionToken
  ]);

  return {
    menuPosition,
    menuStyle: {
      top: menuPosition?.top ?? -9999,
      left: menuPosition?.left ?? -9999,
      visibility: menuPosition ? 'visible' : 'hidden'
    },
    resetMenuPosition
  };
}

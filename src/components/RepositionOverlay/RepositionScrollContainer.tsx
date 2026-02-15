import type { PointerEvent, ReactNode, RefObject } from 'react';

interface RepositionScrollContainerProps {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  isDragging: boolean;
  isPointerArmedForDrag: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

export function RepositionScrollContainer({
  scrollContainerRef,
  isDragging,
  isPointerArmedForDrag,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  children,
}: RepositionScrollContainerProps) {
  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-auto px-4 pt-4 pb-40"
      style={{
        touchAction: isDragging || isPointerArmedForDrag ? 'none' : 'pan-y',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {children}
    </div>
  );
}

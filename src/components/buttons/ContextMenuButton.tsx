import type { MouseEventHandler, RefObject } from 'react';
import type { ReactNode } from 'react';
import { EllipsisIcon } from '@/components/icons';

interface ContextMenuButtonProps {
  onClick: MouseEventHandler<HTMLButtonElement>;
  ariaLabel: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  icon?: ReactNode;
  buttonSize?: number;
  iconSize?: number;
}

export function ContextMenuButton({
  onClick,
  ariaLabel,
  buttonRef,
  icon,
  buttonSize = 10,
  iconSize = 5
}: ContextMenuButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`w-${buttonSize} h-${buttonSize} flex items-center justify-center rounded-lg bg-transparent hover:bg-transparent text-inherit`}
      ref={buttonRef}
    >
      {icon ?? <EllipsisIcon className={`w-${iconSize} h-${iconSize}`} />}
    </button>
  );
}

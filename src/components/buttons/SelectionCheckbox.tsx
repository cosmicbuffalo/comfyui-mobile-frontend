import type { MouseEvent } from 'react';
import { CheckIcon } from '@/components/icons';

interface SelectionCheckboxProps {
  selected: boolean;
  onClick: (event: MouseEvent) => void;
  ariaLabel: string;
  // Matches the kebab/context-menu button footprint it replaces in select mode
  // (NodeCard + group header both use an 8×8 / 32px tap target).
  className?: string;
}

/**
 * The unchecked/checked circle used in select modes: an empty ring when
 * unselected, a filled cyan disc with a check when selected. Same visual
 * language as the outputs panel's SelectionActionButton and FileCard badge.
 */
export function SelectionCheckbox({
  selected,
  onClick,
  ariaLabel,
  className,
}: SelectionCheckboxProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={selected}
      className={`selection-checkbox flex h-8 w-8 items-center justify-center ${className ?? ''}`}
    >
      <div
        className={`flex h-6 w-6 items-center justify-center rounded-full border-2 shadow-sm ${
          selected
            ? 'bg-cyan-500 border-cyan-500 text-slate-950'
            : 'border-slate-500 bg-transparent'
        }`}
      >
        {selected && <CheckIcon className="h-4 w-4" />}
      </div>
    </button>
  );
}

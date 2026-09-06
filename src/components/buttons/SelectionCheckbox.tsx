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
      <SelectionCheckMark selected={selected} />
    </button>
  );
}

/**
 * Just the ring/check, without a button around it.
 *
 * Split out so the media viewer can drop the same mark into an
 * OverlayCircleButton and inherit that button's footprint, disc and
 * pointer-events handling instead of re-deriving them here.
 */
export function SelectionCheckMark({
  selected,
  // Overridable because the media viewer sits on a photo rather than a panel,
  // where the default ring is too dim to find. Left alone everywhere else.
  unselectedBorderClassName = 'border-slate-500',
}: {
  selected: boolean;
  unselectedBorderClassName?: string;
}) {
  return (
    <div
      className={`selection-check-mark flex h-6 w-6 items-center justify-center rounded-full border-2 shadow-sm ${
        selected
          ? 'bg-cyan-500 border-cyan-500 text-slate-950'
          : `bg-transparent ${unselectedBorderClassName}`
      }`}
    >
      {selected && <CheckIcon className="h-4 w-4" />}
    </div>
  );
}

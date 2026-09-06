import type { MouseEvent } from 'react';
import { hexToRgba } from '@/utils/grouping';
import { BOOKMARK_CHIP_ALPHA } from '@/utils/workflowSurfaceColor';

/** The minimum a parent needs to be drawn; callers may carry more of their own. */
export interface ParentageChip {
  key: string;
  label: string;
  surfaceColor: string;
  borderColor: string;
}

interface ParentageEntryProps {
  /** What the item is called, on the first line. */
  label: string;
  /** The containers it sits in, outermost first, on the second. */
  parents: ParentageChip[];
  /** The item's own colour. Omitted leaves the neutral surface. */
  surfaceColor?: string;
  borderColor?: string;
  selected?: boolean;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  className?: string;
  parentClassName?: string;
  removeClassName?: string;
  /** Stable target for the bookmark-arrival flash when this is a bookmark. */
  bookmarkFlashKey?: string;
  onClick: () => void;
  /**
   * Supplied where the parents are somewhere to go; otherwise they are inert.
   * The event comes with it because a chip sits inside a control that also
   * acts, so the handler has to be able to stop it.
   */
  onParentClick?: (index: number, event: MouseEvent<HTMLButtonElement>) => void;
  parentAriaLabel?: (parent: ParentageChip) => string;
  /** Supplied where the entry can be removed, e.g. a bookmark. */
  onRemove?: () => void;
  removeAriaLabel?: string;
}

/**
 * An item named on one line with the containers it lives in on the next.
 *
 * Two things that share a name are told apart by where they sit — a bookmark on
 * a node buried three groups deep, one instance of a subgraph type among five.
 * That is the same problem everywhere it appears, so it is drawn by one
 * component rather than by each list's own approximation of the bookmark bar.
 *
 * What differs between them is what the parts DO: bookmarks navigate to their
 * parents and can be removed, instance lists neither. Those are props, so a
 * list only gets an affordance it actually has.
 */
export function ParentageEntry({
  label,
  parents,
  surfaceColor,
  borderColor,
  selected = false,
  disabled = false,
  title,
  ariaLabel,
  className = '',
  parentClassName = '',
  removeClassName = '',
  bookmarkFlashKey,
  onClick,
  onParentClick,
  parentAriaLabel,
  onRemove,
  removeAriaLabel,
}: ParentageEntryProps) {
  return (
    // The click lives on the whole entry, not just its label: the label is a
    // short string in a wide row, and the rest of the row looked pressable and
    // was not. The label stays a real button so the entry is still reachable
    // and announced by keyboard; both paths run the same action once, because
    // the inner one stops the bubble.
    <div
      role="presentation"
      data-bookmark-flash-key={bookmarkFlashKey}
      onClick={disabled ? undefined : onClick}
      className={`parentage-entry flex min-h-11 shrink-0 overflow-hidden rounded-lg border text-slate-100 shadow-md ${
        disabled ? '' : 'cursor-pointer'
      } ${
        selected ? 'border-cyan-400/50 bg-cyan-500/15' : 'border-white/10 bg-white/5'
      } ${disabled ? 'opacity-50' : ''} ${className}`}
      style={
        surfaceColor
          ? {
              backgroundColor: hexToRgba(surfaceColor, BOOKMARK_CHIP_ALPHA),
              borderColor: hexToRgba(borderColor ?? surfaceColor, BOOKMARK_CHIP_ALPHA),
            }
          : undefined
      }
    >
      <div className="min-w-0 flex-1 select-none px-3 py-2">
        <button
          type="button"
          className={`block w-full cursor-pointer break-words text-left text-sm font-semibold leading-snug hover:text-cyan-100 disabled:cursor-default ${
            selected ? 'text-cyan-100' : ''
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          disabled={disabled}
          title={title ?? label}
          aria-label={ariaLabel}
          aria-pressed={selected}
        >
          {label}
        </button>
        {parents.length > 0 && (
          <span className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px] leading-tight text-cyan-200/90">
            {parents.map((parent, index) => {
              const chipStyle = {
                backgroundColor: hexToRgba(parent.surfaceColor, BOOKMARK_CHIP_ALPHA),
                borderColor: hexToRgba(parent.borderColor, BOOKMARK_CHIP_ALPHA),
              };
              return (
                <span key={parent.key} className="inline-flex min-w-0 items-center gap-1">
                  <span aria-hidden="true">→</span>
                  {onParentClick ? (
                    <button
                      type="button"
                      className={`max-w-full cursor-pointer break-words rounded border px-1.5 py-0.5 text-slate-100 ${parentClassName}`}
                      aria-label={parentAriaLabel?.(parent)}
                      onClick={(event) => {
                        // A parent goes somewhere else; the entry's own click
                        // must not also fire underneath it.
                        event.stopPropagation();
                        onParentClick(index, event);
                      }}
                      style={chipStyle}
                    >
                      {parent.label}
                    </button>
                  ) : (
                    <span
                      className={`max-w-full break-words rounded border px-1.5 py-0.5 text-slate-100 ${parentClassName}`}
                      style={chipStyle}
                    >
                      {parent.label}
                    </span>
                  )}
                </span>
              );
            })}
          </span>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          className={`flex w-9 shrink-0 cursor-pointer items-center justify-center border-l border-white/10 text-slate-400 hover:bg-red-500/15 hover:text-red-200 ${removeClassName}`}
          aria-label={removeAriaLabel}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}

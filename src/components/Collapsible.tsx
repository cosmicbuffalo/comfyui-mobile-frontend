import { useEffect, useState, type ReactNode } from 'react';

const DURATION_MS = 150;

interface CollapsibleProps {
  open: boolean;
  children: ReactNode;
  /** Extra classes applied to the inner (clipped) content wrapper. */
  className?: string;
}

/**
 * Animates its children open/closed by transitioning the grid row track from
 * 0fr to 1fr. The content stays mounted so it animates in both directions; the
 * inner wrapper clips overflow during the transition. Matches the reveal used
 * by collapsible node cards and menu sections across the app.
 *
 * Overflow is only clipped while collapsed or animating — once fully open the
 * wrapper switches to `overflow-visible` so outset content (e.g. selection
 * rings on cards flush against a section edge) isn't cut off.
 */
export function Collapsible({ open, children, className }: CollapsibleProps) {
  // Closing clips instantly because `!open` is part of the render-derived
  // condition below; only the delayed reveal after opening needs state.
  const [overflowRevealed, setOverflowRevealed] = useState(open);

  useEffect(() => {
    if (!open) return;
    // Opening: stay clipped through the transition, then reveal overflow so
    // rings/shadows that extend past the content box can show.
    const timeout = window.setTimeout(
      () => setOverflowRevealed(true),
      DURATION_MS + 30,
    );
    return () => window.clearTimeout(timeout);
  }, [open]);

  const clip = !open || !overflowRevealed;

  return (
    <div
      inert={open ? undefined : true}
      aria-hidden={!open}
      className={`grid transition-[grid-template-rows,opacity] duration-150 ease-out ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
      onTransitionEnd={(event) => {
        // Once the close transition settles, drop the reveal flag so the next
        // open stays clipped through its own transition again.
        if (event.target === event.currentTarget && !open) {
          setOverflowRevealed(false);
        }
      }}
    >
      <div className={`min-h-0 ${clip ? 'overflow-hidden' : 'overflow-visible'} ${className ?? ''}`}>
        {children}
      </div>
    </div>
  );
}

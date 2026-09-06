import { normalizeHexColor } from '@/utils/colorUtils';

/**
 * Flattening for the workflow panel's colour tints.
 *
 * Every coloured surface in the panel is painted as a translucent tint over
 * whatever happens to be behind it, so the same node colour renders as a
 * different pixel colour depending on where it sits (a bare node card, a card
 * nested in a coloured group, a group header stacked on its own wrapper fill).
 * Anything that has to *quote* one of those colours somewhere else — the
 * bookmark bar being the reason this exists — has to reproduce that whole stack
 * or it lands on a visibly different colour.
 *
 * These helpers composite a tint stack down to one opaque colour, so a quoted
 * swatch is the exact pixel colour of the surface it points at and doesn't
 * shift with whatever is scrolling behind it.
 */

/**
 * The panel's own opaque backdrop: `bg-slate-950/88` over `bg-slate-950`, which
 * flattens back to plain slate-950. Every tint below is composited onto this.
 */
export const PANEL_SURFACE = '#020617';

/** Fill alpha of `.group-wrapper` and of a group header (each applies it once). */
export const GROUP_TINT_ALPHA = 0.15;

/** Fill alpha of a coloured NodeCard (`nodeTintColor` in NodeCard.tsx). */
export const NODE_TINT_ALPHA = 0.4;

/** Fill of an *uncoloured* NodeCard: `bg-slate-900/95`. */
const UNCOLOURED_NODE_FILL = '#0f172a';
const UNCOLOURED_NODE_ALPHA = 0.95;

/** A NodeCard's outline is `border-white/10` — neutral, never the node colour. */
const NODE_BORDER_OVERLAY = '#ffffff';
const NODE_BORDER_ALPHA = 0.1;

/** A `.group-wrapper`'s outline is its colour at 0.4 (see WorkflowPanel). */
export const GROUP_BORDER_ALPHA = 0.4;

function parseChannels(color: string): [number, number, number] | null {
  const normalized = normalizeHexColor(color);
  if (!normalized) return null;
  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ];
}

/**
 * Alpha-composites `overlay` at `alpha` onto the opaque `base`, returning an
 * opaque hex colour. Falls back to `base` when either colour can't be parsed.
 */
export function compositeOver(overlay: string, alpha: number, base: string): string {
  const top = parseChannels(overlay);
  const bottom = parseChannels(base);
  if (!top || !bottom) return normalizeHexColor(base) ?? PANEL_SURFACE;
  const weight = Math.min(1, Math.max(0, alpha));
  const channels = top.map((value, index) =>
    Math.round(value * weight + bottom[index] * (1 - weight)),
  );
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The opaque colour a group's *wrapper* paints — i.e. the backdrop its children
 * are drawn on.
 */
export function groupWrapperSurface(color: string, backdrop: string = PANEL_SURFACE): string {
  return compositeOver(color, GROUP_TINT_ALPHA, backdrop);
}

/**
 * The opaque colour a group *header* paints: the header tint sits on the
 * wrapper fill, which sits on whatever encloses the group.
 */
export function groupHeaderSurface(color: string, backdrop: string = PANEL_SURFACE): string {
  return compositeOver(color, GROUP_TINT_ALPHA, groupWrapperSurface(color, backdrop));
}

/**
 * The opaque colour a node card paints. An uncoloured node gets no tint at all
 * — it keeps the plain `bg-slate-900/95` card fill — so it can't be derived
 * from the palette's "no colour" swatch.
 */
export function nodeCardSurface(
  color: string,
  hasColor: boolean,
  backdrop: string = PANEL_SURFACE,
): string {
  return hasColor
    ? compositeOver(color, NODE_TINT_ALPHA, backdrop)
    : compositeOver(UNCOLOURED_NODE_FILL, UNCOLOURED_NODE_ALPHA, backdrop);
}

/**
 * The opaque colour a node card's outline paints. It's a neutral white wash
 * over the card's own fill, so it tracks the fill rather than the node colour.
 */
export function nodeCardBorderSurface(cardSurface: string): string {
  return compositeOver(NODE_BORDER_OVERLAY, NODE_BORDER_ALPHA, cardSurface);
}

/**
 * The opaque colour a group's outline paints. It sits on the *outside* of the
 * wrapper, so it composites onto whatever encloses the group, not onto the
 * wrapper's own fill.
 */
export function groupBorderSurface(color: string, backdrop: string = PANEL_SURFACE): string {
  return compositeOver(color, GROUP_BORDER_ALPHA, backdrop);
}

/**
 * How opaque a bookmark chip is painted. Just shy of solid: the chip still
 * reads as its target's colour, but the node list shows through it. The gutter's
 * pinned cycle controls stay fully opaque so they never blur into the content
 * behind them.
 */
export const BOOKMARK_CHIP_ALPHA = 0.9;

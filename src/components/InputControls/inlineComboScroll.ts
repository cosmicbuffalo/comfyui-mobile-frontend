/**
 * Scroll alignment for an inline combo (the react-select path used for short
 * choice lists on touch devices).
 *
 * The rules this has to satisfy, in order:
 *
 * 1. Opening a combo puts its *label* just below the visible top edge of the
 *    list it lives in, wherever the combo happened to be beforehand.
 * 2. Nothing but that list's `scrollTop` moves. The document must not scroll,
 *    because the top bar is `position: fixed` — a document scroll slides the
 *    list under the bar and reads as a wild overshoot.
 * 3. A combo in the final node still reaches the top, which needs scroll range
 *    the list does not naturally have.
 *
 * Rule 3 used to be met by growing the scroll container's own `padding-bottom`.
 * That cannot work: a flex item's automatic minimum size never compresses its
 * padding, so the container grew past the viewport, made the *document*
 * scrollable, and fed its new height back into the next measurement. The extra
 * range belongs on the content inside the scrollport instead — it changes
 * `scrollHeight` and nothing else.
 */

export const INLINE_COMBO_TOP_INSET = 8;
export const COMBO_SCROLL_SPACE_VAR = "--combo-open-scroll-space";

export interface InlineComboAlignment {
  /** Where the scroller must land for the label to sit at the top inset. */
  desiredScrollTop: number;
  /** Whether this scroller may be granted trailing range it does not have. */
  canGrantSpace: boolean;
}

/**
 * The element to scroll. Deliberately stops at the body: the document is never
 * an acceptable thing to scroll here.
 *
 * The workflow list qualifies even when its content currently fits, because it
 * can be granted the range it lacks — a combo lands in the same place whether
 * the workflow is one node or fifty.
 */
export function findComboScroller(
  element: HTMLElement | null,
): HTMLElement | null {
  const nodeList = element?.closest<HTMLElement>('[data-node-list="true"]');
  if (nodeList) return nodeList;

  let node = element?.parentElement ?? null;
  while (node && node !== document.body && node !== document.documentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    const scrollable =
      overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
    if (scrollable && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}

/** How far this scroller can currently be scrolled. */
function maxScrollTop(scroller: HTMLElement): number {
  return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
}

/** Extra trailing space this module has already granted the scroller. */
export function readComboScrollSpace(scroller: HTMLElement): number {
  const raw = scroller.style.getPropertyValue(COMBO_SCROLL_SPACE_VAR);
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Whether this scroller can be handed range it does not have.
 *
 * Two conditions. Only the workflow list renders the spacer that consumes the
 * variable. And the list has to scroll already: a workflow that fits on screen
 * has no scroll position for the combo's placement to vary with, so hoisting
 * it to the top would only push the node's own header off the top of a panel
 * that is then mostly empty.
 */
export function scrollerAcceptsExtraSpace(scroller: HTMLElement): boolean {
  if (scroller.dataset.nodeList !== "true") return false;
  return maxScrollTop(scroller) - readComboScrollSpace(scroller) > 0;
}

/**
 * The label is what has to clear the top edge, and the control root carries
 * padding above it, so measuring the root would park the label that much
 * further down. A combo rendered without a label falls back to the root.
 *
 * A label that carries a trailing accessory is wrapped in a `.control-label-row`
 * — the accessory has to be the label's SIBLING, or the label forwards clicks
 * to it (see controlStyles). The row sits exactly where the bare label used to,
 * so it is the same measurement; missing it here silently measured the padded
 * root instead and parked the menu a little low.
 */
export function inlineComboAnchor(target: HTMLElement): HTMLElement {
  return (
    target.querySelector<HTMLElement>(":scope > label, :scope > .control-label-row")
    ?? target
  );
}

export function measureInlineComboAlignment(
  target: HTMLElement,
  scroller: HTMLElement,
  inset: number = INLINE_COMBO_TOP_INSET,
): InlineComboAlignment {
  // Content-space offset, so the answer does not depend on where the scroller
  // currently sits or on a clamp that a style change may be about to apply.
  const contentTop =
    scroller.scrollTop +
    inlineComboAnchor(target).getBoundingClientRect().top -
    scroller.getBoundingClientRect().top;
  const desired = Math.max(0, contentTop - inset);
  const canGrantSpace = scrollerAcceptsExtraSpace(scroller);
  if (canGrantSpace) return { desiredScrollTop: desired, canGrantSpace };

  // Anywhere else, go as far as the host already allows and no further.
  return {
    desiredScrollTop: Math.min(desired, maxScrollTop(scroller)),
    canGrantSpace,
  };
}

/**
 * Grant enough trailing range to reach the target, then land on it.
 *
 * The shortfall is re-measured rather than calculated, because `scrollHeight`
 * is floored at the scrollport's height: content shorter than the viewport
 * absorbs the first grant without lengthening the scroll range at all. Reading
 * it back also forces the layout that makes each grant real, so the assignment
 * at the end is not clamped away.
 */
export function applyInlineComboAlignment(
  scroller: HTMLElement,
  { desiredScrollTop, canGrantSpace }: InlineComboAlignment,
): void {
  if (canGrantSpace) {
    let granted = readComboScrollSpace(scroller);
    // Two rounds cover both cases above; the third is only ever a backstop.
    for (let round = 0; round < 3; round += 1) {
      const shortfall = desiredScrollTop - maxScrollTop(scroller);
      if (shortfall <= 0) break;
      granted += Math.ceil(shortfall);
      scroller.style.setProperty(COMBO_SCROLL_SPACE_VAR, `${granted}px`);
    }
  }
  scroller.scrollTop = desiredScrollTop;
}

/**
 * How far below the scrollport's top edge the combo is sitting right now.
 *
 * Recorded before the list opens and used to put the reader back afterwards.
 * An offset rather than a `scrollTop`, so it still lands correctly if choosing
 * a value changed the height of anything above the combo.
 */
export function measureInlineComboOffset(
  target: HTMLElement,
  scroller: HTMLElement,
): number {
  return inlineComboAnchor(target).getBoundingClientRect().top
    - scroller.getBoundingClientRect().top;
}

/**
 * Put the combo back where it was before its list took it to the top, and hand
 * back the trailing range that was borrowed to get it there.
 *
 * The range goes first: dropping it can clamp the scroller, and the offset is
 * therefore measured afterwards so the correction accounts for that.
 */
export function restoreInlineComboOffset(
  target: HTMLElement,
  scroller: HTMLElement,
  offset: number,
): void {
  clearComboScrollSpace(scroller);
  scroller.scrollTop += measureInlineComboOffset(target, scroller) - offset;
}

/** Give back the borrowed range without moving anything. */
export function clearComboScrollSpace(scroller: HTMLElement): void {
  if (!readComboScrollSpace(scroller)) return;
  scroller.style.removeProperty(COMBO_SCROLL_SPACE_VAR);
  // Force the layout that shortens the scroll range, so a caller reading
  // scrollTop straight afterwards sees the clamped value.
  void scroller.scrollHeight;
}

export interface InlineComboScrollHold {
  release: () => void;
}

/**
 * Pin everything while the menu is open.
 *
 * The menu is portalled to the body and positioned once, in document
 * coordinates, at mount. Anything that scrolls afterwards — a mobile keyboard
 * nudging the document, a focus scroll, an inertial fling that survived the
 * tap — both detaches the menu from its control and undoes the alignment. So
 * the open state simply holds the two positions it was opened with.
 */
export function holdInlineComboScroll(
  scroller: HTMLElement,
  scrollTop: number,
  documentScroll: { x: number; y: number } = {
    x: window.scrollX,
    y: window.scrollY,
  },
): InlineComboScrollHold {
  const { x: docX, y: docY } = documentScroll;

  const reassert = () => {
    if (window.scrollX !== docX || window.scrollY !== docY) {
      window.scrollTo(docX, docY);
    }
    if (Math.abs(scroller.scrollTop - scrollTop) > 0.5) {
      scroller.scrollTop = scrollTop;
    }
  };

  // Capture phase: scroll does not bubble, and the list's own scroll has to be
  // caught as well as the document's.
  window.addEventListener("scroll", reassert, true);
  window.visualViewport?.addEventListener("resize", reassert);
  window.visualViewport?.addEventListener("scroll", reassert);

  return {
    release: () => {
      window.removeEventListener("scroll", reassert, true);
      window.visualViewport?.removeEventListener("resize", reassert);
      window.visualViewport?.removeEventListener("scroll", reassert);
    },
  };
}

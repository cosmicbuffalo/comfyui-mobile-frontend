import { markProgrammaticScroll } from '@/utils/scrollInterrupt';

export interface QueueScrollAnchor {
  itemId: string;
  offsetTop: number;
  // scrollTop of the container when this anchor was captured. Lets us tell
  // the user's own scrolling (scrollTop moves, offset follows) apart from an
  // involuntary layout shift (offset moves, scrollTop doesn't) so a finger drag
  // is never fought.
  scrollTop: number;
}

const QUEUE_ITEM_SELECTOR = '[data-queue-item-id]';
// Finer-grained anchor points tagged throughout a card (header, prompt-preview
// rows, each image, …). Anchoring on whichever of these the user is actually
// looking at — rather than the card's top — keeps that exact element fixed as
// content shifts higher up.
const SCROLL_ANCHOR_SELECTOR = '[data-scroll-anchor-id]';

export function shouldCaptureQueueScrollAnchor(
  scrollTop: number,
  userScrollIntent: boolean,
): boolean {
  return scrollTop > 1 && userScrollIntent;
}

export function isQueueTouchMomentumScroll(
  touchGestureActive: boolean,
  fingerDown: boolean,
  elapsedSinceLastScroll: number,
  momentumQuietMs: number,
): boolean {
  return touchGestureActive && !fingerDown && elapsedSinceLastScroll < momentumQuietMs;
}

export function captureQueueScrollAnchor(
  container: HTMLElement,
): QueueScrollAnchor | null {
  if (container.scrollTop <= 1) return null;

  const containerTop = container.getBoundingClientRect().top;

  // Phase 1: the topmost queue card touching the viewport — the card whose
  // content sits at the top of what the user currently sees.
  const cards = container.querySelectorAll<HTMLElement>(QUEUE_ITEM_SELECTOR);
  let topCard: HTMLElement | null = null;
  for (const card of cards) {
    if (card.getBoundingClientRect().bottom <= containerTop) continue;
    topCard = card;
    break;
  }
  if (!topCard) return null;

  // Phase 2: within that card, anchor on the finest element whose top edge is in
  // view (header, a prompt-preview row, an image…) — whatever the user is
  // looking at — so anything growing higher up compensates against it. Fall back
  // to the topmost partially-visible element, then the card itself.
  const anchorables = topCard.querySelectorAll<HTMLElement>(SCROLL_ANCHOR_SELECTOR);
  let partiallyVisibleFallback: QueueScrollAnchor | null = null;
  for (const el of anchorables) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= containerTop) continue;
    const itemId = el.dataset.scrollAnchorId;
    if (!itemId) continue;
    const anchor = {
      itemId,
      offsetTop: rect.top - containerTop,
      scrollTop: container.scrollTop,
    };
    if (rect.top >= containerTop) return anchor;
    partiallyVisibleFallback ??= anchor;
  }
  if (partiallyVisibleFallback) return partiallyVisibleFallback;

  const cardId = topCard.dataset.scrollAnchorId ?? topCard.dataset.queueItemId;
  if (!cardId) return null;
  return {
    itemId: cardId,
    offsetTop: topCard.getBoundingClientRect().top - containerTop,
    scrollTop: container.scrollTop,
  };
}

export function captureQueueScrollAnchorForItem(
  container: HTMLElement,
  element: HTMLElement,
): QueueScrollAnchor | null {
  if (container.scrollTop <= 1) return null;
  const itemId = element.dataset.scrollAnchorId ?? element.dataset.queueItemId;
  if (!itemId) return null;
  return {
    itemId,
    offsetTop: element.getBoundingClientRect().top - container.getBoundingClientRect().top,
    scrollTop: container.scrollTop,
  };
}

export function restoreQueueScrollAnchor(
  container: HTMLElement,
  anchor: QueueScrollAnchor | null,
): boolean {
  if (!anchor) return false;

  // Direct attribute lookup (stops at the first match) instead of collecting
  // every item and scanning — this runs on every render / resize frame.
  const escaped = anchor.itemId.replace(/["\\]/g, '\\$&');
  const item = container.querySelector<HTMLElement>(
    `[data-scroll-anchor-id="${escaped}"]`,
  );
  if (!item) return false;

  const containerTop = container.getBoundingClientRect().top;
  const currentOffsetTop = item.getBoundingClientRect().top - containerTop;
  // Where the anchored item should sit at the current scroll position if the
  // only change since capture was the user's own scrolling: scrolling down by N
  // moves the item up by N. Whatever offset is left over is an involuntary
  // shift (e.g. an image inserted above) — the only part worth compensating.
  const voluntaryScroll = container.scrollTop - anchor.scrollTop;
  const expectedOffsetTop = anchor.offsetTop - voluntaryScroll;
  const drift = currentOffsetTop - expectedOffsetTop;
  if (Math.abs(drift) < 0.5) return false;

  const before = container.scrollTop;
  // Declared before the write, not after: the compensation runs on every
  // arriving image while the reader sits still, and an open menu must not read
  // the app steadying the list under it as a request to close.
  markProgrammaticScroll();
  container.scrollTop += drift;
  // The shift grew/shrank the content above the anchor, moving the scroll
  // coordinate baseline with it. Re-baseline the captured reference past the
  // shift so the pinned offset still holds for the next comparison.
  //
  // BOTH halves have to move together. `expectedOffsetTop` is read as
  // "offsetTop, at scrollTop" — one line, not two independent numbers — so
  // advancing the scroll half alone silently redefines the pinned offset from
  // `offsetTop - voluntaryScroll` (where the item actually is) back to
  // `offsetTop` (where it was when the anchor was captured). The next call then
  // measures a drift of exactly -voluntaryScroll and scrolls the list by it:
  // whatever the reader had covered since the last capture is undone in one
  // frame. That is invisible while the anchor is re-captured on every scroll
  // event, and it is not: `handleScroll` deliberately leaves the anchor alone
  // while momentum coasts, and re-captures nothing at all for a scroll with no
  // user intent behind it (a deep-link jump, a restored position). A fling
  // followed by any involuntary shift is therefore enough to snap the list back
  // hundreds of pixels.
  //
  // The write can also be clamped at either end of the scroll range, so the
  // correction that landed is measured rather than assumed: scrolling down by
  // `applied` moves the item up by exactly `applied`.
  const applied = container.scrollTop - before;
  anchor.scrollTop = container.scrollTop;
  anchor.offsetTop = currentOffsetTop - applied;
  return true;
}

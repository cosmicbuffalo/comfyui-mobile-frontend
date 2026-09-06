export type ConnectionDirection = 'input' | 'output';

/**
 * DOM id of a connection button, unique within the currently rendered scope.
 * Navigation passes this id to `scrollToNode`, which flashes the button in sync
 * with the destination node's highlight pulse (see `.connection-highlight-pulse`
 * in index.css).
 */
export function connectionButtonDomId(
  nodeId: number,
  direction: ConnectionDirection,
  slotIndex: number,
): string {
  return `connection-button-${nodeId}-${direction}-${slotIndex}`;
}

/**
 * Reveal a boundary slot in the subgraph connections section and pulse it.
 *
 * The section is not a node, so `scrollToNode` — which resolves an item key and
 * waits for a node card — cannot reach it. It is also always at the top of the
 * scope and always mounted, so nothing needs revealing first: scrolling to the
 * button and flashing it is the whole job.
 */
export function revealBoundarySlot(
  sentinelNodeId: number,
  direction: ConnectionDirection,
  slotIndex: number,
): void {
  const element = document.getElementById(
    connectionButtonDomId(sentinelNodeId, direction, slotIndex),
  );
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document
    .querySelectorAll('.connection-highlight-pulse')
    .forEach((el) => el.classList.remove('connection-highlight-pulse'));
  // After the smooth scroll has had time to land. Pulsing immediately plays the
  // animation while the button is still travelling — usually still off screen,
  // so the arrival reads as a jump with no highlight at all.
  setTimeout(() => {
    element.classList.add('connection-highlight-pulse');
    if ('vibrate' in navigator) navigator.vibrate(10);
    setTimeout(() => element.classList.remove('connection-highlight-pulse'), 1200);
  }, FLASH_AFTER_SCROLL_MS);
}

/** Long enough for a smooth scroll to settle before the pulse starts. */
const FLASH_AFTER_SCROLL_MS = 300;

/**
 * Scroll a subgraph placeholder into view and pulse it.
 *
 * `scrollToNode` cannot be used for one: it waits for `node-card-<id>` and
 * gives up when it never appears, which is what happens to a placeholder
 * rendered as a container rather than a plain card. The reposition wrapper is
 * present either way, so it is the reliable thing to scroll to and, failing a
 * card, the thing to light up.
 */
export function revealPlaceholderNode(nodeId: number): void {
  const wrapper = document.querySelector(`[data-reposition-item="node-${nodeId}"]`);
  const target = document.getElementById(`node-card-${nodeId}`) ?? wrapper;
  if (!wrapper && !target) return;
  wrapper?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!(target instanceof HTMLElement)) return;
  document
    .querySelectorAll('.highlight-pulse')
    .forEach((el) => el.classList.remove('highlight-pulse'));
  target.classList.add('highlight-pulse');
  setTimeout(() => target.classList.remove('highlight-pulse'), 1200);
  if ('vibrate' in navigator) navigator.vibrate(10);
}

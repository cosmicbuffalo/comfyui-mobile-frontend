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

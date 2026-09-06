import type { HierarchicalKey } from '@/utils/workflowHierarchy';

/**
 * Somewhere in a workflow a jump can be aimed at.
 *
 * A tagged union rather than four functions: the differences between these are
 * which element to look for and what to light up, and everything around that —
 * travelling to the right scope, revealing ancestors, waiting for the render,
 * scrolling, flashing — is identical. Making the kind an argument is what keeps
 * that shared part shared.
 */
export type WorkflowJumpTarget =
  /** A node card. */
  | { kind: 'node'; itemKey: HierarchicalKey }
  /** A subgraph placeholder, which may draw as a card or as a container. */
  | { kind: 'subgraph'; itemKey: HierarchicalKey }
  /** A group container. */
  | { kind: 'group'; itemKey: HierarchicalKey; groupKey: string }
  /** A boundary slot in the current subgraph's connections section. */
  | { kind: 'boundarySlot'; domId: string }
  /**
   * One widget row inside a node card — the finest thing the panel can be sent
   * to. The card is named as well as the row: the row only exists while the
   * card renders it, so a jump has to be able to reveal the card first, and to
   * land on it when the row turns out not to be drawn (a widget promoted to a
   * subgraph boundary, or one of the specialised control rows).
   */
  | { kind: 'widget'; itemKey: HierarchicalKey; nodeId: number; domId: string };

/**
 * The DOM id of one widget row, unique among the cards on screen.
 *
 * Node ids are only unique within a scope, and the panel draws one scope at a
 * time — the same assumption `node-card-<id>` already makes.
 */
export function widgetRowDomId(nodeId: number, widgetIndex: number): string {
  return `widget-row-${nodeId}-${widgetIndex}`;
}

/**
 * The subgraph a group key belongs to, or null for root.
 *
 * Group keys are location pointers — `root/group:7`,
 * `root/subgraph:<id>/group:7` — so the scope is already written into the key
 * a caller has, and does not have to be passed alongside it.
 */
export function groupKeyScopeId(groupKey: string): string | null {
  const match = groupKey.match(/subgraph:([^/]+)/);
  return match ? match[1] : null;
}

import type { Workflow } from '@/api/types';
import { isUseEverywhereNode } from '@/utils/useEverywhere';

/**
 * Connection-button label for an Anything Everywhere slot — the type being
 * broadcast, on both the incoming and outgoing side.
 *
 * These nodes carry no widgets, and their slots are declared as the wildcard
 * `*`, so a card for one otherwise reads as a single anonymous `anything` row —
 * fifteen of them in a row in the workflow that prompted this work, all
 * identical and all meaningless. Naming the type makes the card legible, and
 * saying it on both halves means `MODEL` in reads as `MODEL` out. How many
 * inputs receive it is already on the button's own connection count.
 *
 * The outgoing side is synthesized from the input it re-publishes, so both
 * directions resolve through the same slot index.
 *
 * Returns `fallback` for non-UE nodes. Mirrors `setGetLabels.ts`, which does the
 * same job for the KJNodes wireless relays.
 */
export function resolveUseEverywhereConnectionLabel(
  workflow: Workflow,
  nodeId: number,
  slotIndex: number,
  fallback: string,
): string {
  const node = workflow.nodes.find((n) => n.id === nodeId);
  if (!node || !isUseEverywhereNode(node)) return fallback;

  const input = node.inputs?.[slotIndex];
  if (!input) return fallback;

  // Prefer the link's declared type: the slot itself stays "*" no matter what is
  // plugged into it.
  const link = input.link != null ? workflow.links.find((l) => l[0] === input.link) : undefined;
  const type = link?.[5] || input.label || input.type;
  return !type || type === '*' ? fallback : String(type);
}

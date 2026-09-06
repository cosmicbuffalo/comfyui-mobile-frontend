import type {
  NodeTypes,
  Workflow,
  WorkflowSubgraphDefinition,
  WorkflowSubgraphLink,
} from '@/api/types';
import { SUBGRAPH_INPUT_NODE_ID, SUBGRAPH_OUTPUT_NODE_ID } from '@/utils/canonicalWorkflowOps';
import { rebuildDefinitionLinkIds } from '@/utils/workflowValidator';
import { normalizeSubgraphPlaceholders } from '@/utils/normalizeSubgraphPlaceholders';
import { boundaryWidgetNames, reconcileInstanceWidgetValues } from '@/utils/instanceWidgetValues';

/**
 * Re-point every boundary link at its slot's new index after a slot was
 * removed, and drop the links belonging to the removed slot itself. Boundary
 * links address their slot positionally, so a removal that leaves them alone
 * silently rewires the slots after it.
 */
export function reindexBoundaryLinks(
  links: WorkflowSubgraphLink[],
  direction: 'input' | 'output',
  removedIndex: number,
): WorkflowSubgraphLink[] {
  return links.flatMap((link) => {
    if (direction === 'input') {
      if (link.origin_id !== SUBGRAPH_INPUT_NODE_ID) return [link];
      if (link.origin_slot === removedIndex) return [];
      return link.origin_slot > removedIndex
        ? [{ ...link, origin_slot: link.origin_slot - 1 }]
        : [link];
    }
    if (link.target_id !== SUBGRAPH_OUTPUT_NODE_ID) return [link];
    if (link.target_slot === removedIndex) return [];
    return link.target_slot > removedIndex
      ? [{ ...link, target_slot: link.target_slot - 1 }]
      : [link];
  });
}

function slotWired(
  links: WorkflowSubgraphLink[],
  direction: 'input' | 'output',
  slotIndex: number,
): boolean {
  return links.some((link) =>
    direction === 'input'
      ? link.origin_id === SUBGRAPH_INPUT_NODE_ID && link.origin_slot === slotIndex
      : link.target_id === SUBGRAPH_OUTPUT_NODE_ID && link.target_slot === slotIndex,
  );
}

/** Slot indices wired before the mutation and unwired after, highest first. */
function orphanedSlotIndices(
  beforeSg: WorkflowSubgraphDefinition,
  afterSg: WorkflowSubgraphDefinition,
  direction: 'input' | 'output',
): number[] {
  const beforeLinks = beforeSg.links ?? [];
  const afterLinks = afterSg.links ?? [];
  const slots = (direction === 'input' ? afterSg.inputs : afterSg.outputs) ?? [];
  const orphans: number[] = [];
  slots.forEach((_slot, index) => {
    if (slotWired(beforeLinks, direction, index) && !slotWired(afterLinks, direction, index)) {
      orphans.push(index);
    }
  });
  return orphans.reverse();
}

/**
 * Remove boundary slots orphaned by a node delete or link disconnect inside a
 * subgraph, and carry every surviving instance value by name.
 *
 * Whether a boundary slot is widget-backed is derived from its INTERIOR link
 * on both sides. When the inner node behind a promoted widget is deleted, the
 * slot survives with nothing behind it — and the two frontends then disagree
 * about it. Stock stops counting it (no interior widget, no value consumed),
 * while mobile's resolver falls back to a type check and keeps counting it, so
 * every promoted value AFTER the orphan is read one position off when the file
 * is opened in stock: silent value rotation. The two shapes cannot be told
 * apart after a save (`repairSubgraphLinkIds` rewrites the orphan's stale
 * linkIds to `[]`, identical to a truncated-serialization file that never had
 * them — the issue-#69 shape the fallback exists for), so the fix has to act
 * HERE, in the mutation epilogue, where "wired before, unwired after" is still
 * observable.
 *
 * The rule: a slot whose last interior link just went away is removed outright
 * — matching what its value semantics already became, since anything wired
 * into an orphaned slot from the parent scope feeds nothing. A slot that
 * never had an interior link is left alone; that is the legacy shape, not an
 * orphan. Values are then reconciled against the pre-mutation boundary order
 * by name, so each instance keeps its own surviving values (never a
 * neighbour's).
 *
 * `before` is the workflow as it stood when the mutation started; `after` is
 * the mutated one. Slot lists must be untouched between the two (deletes and
 * disconnects only change nodes/links), which is what keeps the index
 * comparison aligned; if they differ the sweep declines to guess.
 */
export function pruneOrphanedBoundarySlots(
  before: Workflow,
  after: Workflow,
  nodeTypes: NodeTypes | null,
  subgraphId: string,
): Workflow {
  const beforeSg = (before.definitions?.subgraphs ?? []).find((sg) => sg.id === subgraphId);
  const afterSg = (after.definitions?.subgraphs ?? []).find((sg) => sg.id === subgraphId);
  if (!beforeSg || !afterSg) return after;
  if (
    (beforeSg.inputs ?? []).length !== (afterSg.inputs ?? []).length
    || (beforeSg.outputs ?? []).length !== (afterSg.outputs ?? []).length
  ) {
    return after;
  }

  const inputOrphans = orphanedSlotIndices(beforeSg, afterSg, 'input');
  const outputOrphans = orphanedSlotIndices(beforeSg, afterSg, 'output');
  if (inputOrphans.length === 0 && outputOrphans.length === 0) return after;

  // Highest index first, so each removal leaves the remaining indices valid.
  let sg = afterSg;
  for (const index of inputOrphans) {
    sg = {
      ...sg,
      inputs: (sg.inputs ?? []).filter((_entry, i) => i !== index),
      links: reindexBoundaryLinks(sg.links ?? [], 'input', index),
    };
  }
  for (const index of outputOrphans) {
    sg = {
      ...sg,
      outputs: (sg.outputs ?? []).filter((_entry, i) => i !== index),
      links: reindexBoundaryLinks(sg.links ?? [], 'output', index),
    };
  }
  sg = rebuildDefinitionLinkIds(sg);

  const next = normalizeSubgraphPlaceholders({
    ...after,
    definitions: {
      ...(after.definitions ?? {}),
      subgraphs: (after.definitions?.subgraphs ?? []).map((entry) =>
        entry.id === subgraphId ? sg : entry,
      ),
    },
  });

  // By-name carry against the PRE-mutation order — the resolver is only
  // trustworthy on `before`, where the interior links still exist.
  const previousNames = boundaryWidgetNames(beforeSg);
  const currentNames = boundaryWidgetNames(
    (next.definitions?.subgraphs ?? []).find((entry) => entry.id === subgraphId),
  );
  const unchanged =
    previousNames.length === currentNames.length
    && previousNames.every((name, index) => name === currentNames[index]);
  return unchanged
    ? next
    : reconcileInstanceWidgetValues(next, subgraphId, nodeTypes, previousNames);
}

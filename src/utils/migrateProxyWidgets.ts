import type {
  Workflow,
  WorkflowNode,
  WorkflowSubgraphDefinition,
  WorkflowSubgraphLink,
} from '@/api/types';
import { SUBGRAPH_INPUT_NODE_ID } from '@/utils/canonicalWorkflowOps';
import { newBoundarySlotId } from '@/utils/subgraphBoundaryNames';
import { getSubgraphBoundaryWidgetSlots } from '@/utils/widgetDefinitions';

/**
 * Retire `properties.proxyWidgets` by turning it into real boundary inputs.
 *
 * `proxyWidgets` is the OLD way a placeholder said which widgets it draws: a
 * list of `[innerNodeId, widgetName]` pairs, with `widgets_values` serialized
 * in that order. Stock treats it as legacy — `proxyWidgetMigration.ts` converts
 * each entry into a boundary input via `subgraph.addInput`, quarantines what it
 * cannot resolve, and deletes the property. Its current model is that a
 * boundary input whose interior link lands on a widget-backed inner input IS
 * the promoted widget, and `widgets_values` is indexed by boundary order.
 *
 * We used to keep the legacy list alive and append to it, which meant carrying
 * TWO orders that had to agree: the boundary's, and the proxy list's. Every
 * value is positional, so any edit that changed one length without the other
 * silently handed each widget its neighbour's value — a promoted prompt reading
 * as a frame rate. Migrating on the way in leaves one order and one array.
 *
 * Deliberately NOT reordering the boundary to match the old widget order: the
 * order becomes the boundary's, exactly as it does in stock. Reordering would
 * renumber the slot indices every parent link addresses, which is the failure
 * this whole area is prone to, and it would diverge from stock again.
 */

export interface ProxyWidgetMigrationReport {
  /** Entries that found a boundary input already promoting them. */
  linked: number;
  /** Entries that needed a boundary input created for them. */
  created: number;
  /** Placeholders left alone because an entry could not be resolved. */
  skipped: number;
}

type ProxyEntry = [string, string];

function readProxyWidgets(node: WorkflowNode): ProxyEntry[] | null {
  const raw = (node.properties as Record<string, unknown> | undefined)?.proxyWidgets;
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((entry): entry is [unknown, unknown] => Array.isArray(entry) && entry.length >= 2)
    .map((entry): ProxyEntry => [String(entry[0]), String(entry[1])]);
}

/** Every link id in the file — interior ids share the root's allocator. */
function nextLinkId(workflow: Workflow): number {
  let max = workflow.last_link_id ?? 0;
  for (const link of workflow.links ?? []) max = Math.max(max, link[0]);
  for (const definition of workflow.definitions?.subgraphs ?? []) {
    for (const link of definition.links ?? []) max = Math.max(max, link.id);
  }
  return max + 1;
}

function uniqueBoundaryName(taken: Set<string>, wanted: string): string {
  if (!taken.has(wanted)) return wanted;
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${wanted}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The boundary input already promoting this inner widget, if there is one.
 *
 * Matched by where the interior link LANDS, not by name: a boundary slot can be
 * renamed, and two inner nodes can own widgets of the same name.
 */
function findPromotingSlot(
  definition: WorkflowSubgraphDefinition,
  innerNodeId: number,
  widgetName: string,
): number | null {
  const inner = (definition.nodes ?? []).find((node) => node.id === innerNodeId);
  if (!inner) return null;
  const inputIndex = (inner.inputs ?? []).findIndex(
    (input) => input.name === widgetName || input.widget?.name === widgetName,
  );
  if (inputIndex < 0) return null;
  const link = (definition.links ?? []).find(
    (candidate) => candidate.origin_id === SUBGRAPH_INPUT_NODE_ID
      && candidate.target_id === innerNodeId
      && candidate.target_slot === inputIndex,
  );
  return link ? link.origin_slot : null;
}

/**
 * Whether every entry could be migrated, checked WITHOUT mutating anything.
 *
 * Resolution creates boundary inputs as it goes, so a placeholder that turns out
 * to be unmigratable half way through would leave the ones already added behind.
 * The question is asked in full first, and only then acted on.
 */
function canResolveAll(
  definition: WorkflowSubgraphDefinition,
  entries: ProxyEntry[],
  values: unknown[],
): boolean {
  return entries.every(([rawNodeId, widgetName], index) => {
    // An entry that resolves is fine, and so is one that does not but holds no
    // value — those are dead weight the legacy list accumulated, and dropping
    // them costs nothing. Only an unresolvable entry that still owns a VALUE
    // forces the placeholder to stay as it is, since migrating would lose it.
    const holdsValue = values[index] !== undefined && values[index] !== null;
    const resolvable = (() => {
      if (rawNodeId === '-1') {
        return (definition.inputs ?? []).some((input) => input.name === widgetName);
      }
      const innerNodeId = Number(rawNodeId);
      if (!Number.isFinite(innerNodeId)) return false;
      const inner = (definition.nodes ?? []).find((node) => node.id === innerNodeId);
      if (!inner) return false;
      // Either it is already promoted, or it has an input slot to promote.
      return (inner.inputs ?? []).some(
        (input) => input.name === widgetName || input.widget?.name === widgetName,
      );
    })();
    return resolvable || !holdsValue;
  });
}

/** Create a boundary input for an inner widget and wire it through. */
function promoteToBoundary(
  definition: WorkflowSubgraphDefinition,
  innerNodeId: number,
  widgetName: string,
  linkId: number,
): number | null {
  const inner = (definition.nodes ?? []).find((node) => node.id === innerNodeId);
  if (!inner) return null;
  const inputIndex = (inner.inputs ?? []).findIndex(
    (input) => input.name === widgetName || input.widget?.name === widgetName,
  );
  // Without a materialized input slot there is nothing to link to, and the slot
  // can only be synthesized from a node definition this pass does not have.
  // Stock quarantines the same case rather than guessing a type.
  if (inputIndex < 0) return null;

  const inputs = definition.inputs ?? [];
  const taken = new Set(inputs.map((slot) => slot.name ?? ''));
  const slotIndex = inputs.length;
  definition.inputs = [
    ...inputs,
    {
      // Stock's schema wants a UUID here; a blank id is a validation problem on
      // every slot after it, which the parity suite refuses.
      id: newBoundarySlotId(inputs.map((slot) => slot.id ?? '')),
      name: uniqueBoundaryName(taken, widgetName),
      type: String(inner.inputs[inputIndex].type ?? '*'),
      linkIds: [linkId],
    },
  ];
  definition.links = [
    ...(definition.links ?? []),
    {
      id: linkId,
      origin_id: SUBGRAPH_INPUT_NODE_ID,
      origin_slot: slotIndex,
      target_id: innerNodeId,
      target_slot: inputIndex,
      type: String(inner.inputs[inputIndex].type ?? '*'),
    } as WorkflowSubgraphLink,
  ];
  inner.inputs = inner.inputs.map((input, index) => (
    index === inputIndex ? { ...input, link: linkId } : input
  ));
  return slotIndex;
}

/**
 * Migrate every placeholder in the workflow, and report what happened.
 *
 * Instances of one type are migrated together and in document order: creating a
 * boundary input changes the definition every instance shares, so the first
 * instance that needs one creates it and the rest find it already there.
 */
export function migrateProxyWidgets(
  workflow: Workflow,
): { workflow: Workflow; report: ProxyWidgetMigrationReport } {
  const report: ProxyWidgetMigrationReport = { linked: 0, created: 0, skipped: 0 };
  const definitions = workflow.definitions?.subgraphs ?? [];
  if (definitions.length === 0) return { workflow, report };

  const carriers = [
    ...(workflow.nodes ?? []),
    ...definitions.flatMap((definition) => definition.nodes ?? []),
  ].filter((node) => readProxyWidgets(node)?.length);
  if (carriers.length === 0) return { workflow, report };

  // One mutable copy for the whole pass: boundary inputs added for one instance
  // have to be visible to the next.
  const next = structuredClone(workflow) as Workflow;
  const nextDefinitions = next.definitions!.subgraphs!;
  const byId = new Map(nextDefinitions.map((definition) => [definition.id, definition]));
  let linkId = nextLinkId(next);

  /** Boundary slot each entry resolved to, per placeholder. */
  const resolvedFor = new Map<WorkflowNode, Array<{ slot: number | null; value: unknown }>>();

  const allNodes = [
    ...(next.nodes ?? []),
    ...nextDefinitions.flatMap((definition) => definition.nodes ?? []),
  ];
  for (const node of allNodes) {
    const entries = readProxyWidgets(node);
    const definition = byId.get(node.type);
    if (!entries?.length || !definition) continue;
    const values = Array.isArray(node.widgets_values) ? node.widgets_values : [];
    if (!canResolveAll(definition, entries, values)) {
      report.skipped += 1;
      continue;
    }

    const resolved = entries.map((entry, index) => {
      const [rawNodeId, widgetName] = entry;
      const value = values[index];
      // `-1` is stock's UNASSIGNED_NODE_ID: the entry names a boundary input
      // rather than an interior node, so it is matched by name.
      if (rawNodeId === '-1') {
        const slot = (definition.inputs ?? []).findIndex((input) => input.name === widgetName);
        return { slot: slot >= 0 ? slot : null, value, created: false };
      }
      const innerNodeId = Number(rawNodeId);
      if (!Number.isFinite(innerNodeId)) return { slot: null, value, created: false };
      const existing = findPromotingSlot(definition, innerNodeId, widgetName);
      if (existing !== null) return { slot: existing, value, created: false };
      // Promotion is attempted, but only kept if the WHOLE placeholder resolves.
      const created = promoteToBoundary(definition, innerNodeId, widgetName, linkId);
      if (created === null) return { slot: null, value, created: false };
      linkId += 1;
      return { slot: created, value, created: true };
    });

    // All or nothing. An entry naming a widget with no materialized input slot
    // cannot become a boundary input without a node definition this pass does
    // not have — and dropping it would take its VALUE with it. Stock quarantines
    // such an entry; we leave the placeholder on the legacy list untouched,
    // which loses nothing and keeps the two shapes from being half-mixed.
    for (const entry of resolved) {
      if (entry.slot === null) continue;
      if (entry.created) report.created += 1; else report.linked += 1;
    }
    resolvedFor.set(node, resolved);
  }

  // Only now that every boundary input exists is the widget order final, so the
  // values are laid out against it in a second pass.
  for (const [node, resolved] of resolvedFor) {
    const definition = byId.get(node.type)!;
    const widgetSlots = getSubgraphBoundaryWidgetSlots(definition);
    const valueBySlot = new Map<number, unknown>();
    for (const entry of resolved) {
      if (entry.slot === null || entry.value === undefined) continue;
      valueBySlot.set(entry.slot, entry.value);
    }
    const values = widgetSlots.map(({ boundarySlot }) => valueBySlot.get(boundarySlot) ?? null);
    // A trailing run of holes is dropped rather than written as null: stock
    // reads a null as a value and overwrites the inner widget's own default,
    // while an index past the end of the array leaves that default standing.
    while (values.length > 0 && values[values.length - 1] == null) values.pop();

    const properties = { ...(node.properties ?? {}) };
    delete (properties as Record<string, unknown>).proxyWidgets;
    node.properties = properties;
    node.widgets_values = values;
  }

  next.last_link_id = Math.max(next.last_link_id ?? 0, linkId - 1);
  return { workflow: next, report };
}

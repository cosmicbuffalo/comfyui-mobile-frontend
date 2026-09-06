import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { getSubgraphBoundaryWidgetSlots, getWidgetDefinitions } from '@/utils/widgetDefinitions';

/**
 * Carry sibling instances' values inside when a move takes their boundary slot.
 *
 * The boundary belongs to the DEFINITION, so moving a node into one instance
 * removes the slot it fed for every instance of that type. On a shared type
 * that is the whole problem: moving one section's prompt encoder in drops the
 * `positive` slot for all eleven sections at once, and the other ten encoders
 * are left feeding nothing — their text silently replaced by whatever the one
 * that moved in happens to hold.
 *
 * The value each sibling was feeding through that slot is not ours to drop, so
 * it comes with it: for every other instance, the node that fed the removed
 * slot is matched against the one that moved, and its widget values are copied
 * into that instance's own promoted widgets. Nothing is deleted here — the
 * source nodes are returned as candidates, because removing a node is the
 * caller's decision and one of them may still be feeding something else.
 */

export interface HarvestedValue {
  /** The placeholder that received the value. */
  instanceNodeId: number;
  /** The root node it was read from. */
  sourceNodeId: number;
  /** The promoted widget it landed on. */
  widgetName: string;
}

export interface HarvestSkip {
  instanceNodeId: number;
  sourceNodeId: number | null;
  reason: 'nothing-fed-the-slot' | 'different-node-type';
}

export interface HarvestedConnection {
  instanceNodeId: number;
  /** The boundary input that was wired. */
  slotName: string;
  /** The root node it was wired to. */
  sourceNodeId: number;
}

export interface HarvestResult {
  workflow: Workflow;
  harvested: HarvestedValue[];
  /** Connections made on sibling instances for boundary inputs the move added. */
  connected: HarvestedConnection[];
  skipped: HarvestSkip[];
  /**
   * Source nodes that are now feeding nothing at all, so removing them would
   * lose no connection. A node still feeding something else is NOT here, however
   * completely it was harvested — one encoder shared by every section is the
   * case that makes this distinction matter.
   */
  removable: number[];
}

function boundaryWidgetNames(workflow: Workflow, subgraphId: string): string[] {
  const definition = (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === subgraphId);
  if (!definition) return [];
  return getSubgraphBoundaryWidgetSlots(definition)
    .map(({ boundarySlot }) => (definition.inputs ?? [])[boundarySlot]?.name ?? '');
}

/** For each placeholder of the type: which root node fed each named input. */
function feedersByInstance(
  workflow: Workflow,
  subgraphId: string,
): Map<number, Map<string, number>> {
  const links = workflow.links ?? [];
  const result = new Map<number, Map<string, number>>();
  for (const node of workflow.nodes ?? []) {
    if (node.type !== subgraphId) continue;
    const bySlot = new Map<string, number>();
    (node.inputs ?? []).forEach((input) => {
      if (input.link == null) return;
      const link = links.find((candidate) => candidate[0] === input.link);
      if (link) bySlot.set(input.name, link[1]);
    });
    result.set(node.id, bySlot);
  }
  return result;
}

export function harvestSiblingInstanceValues(
  before: Workflow,
  after: Workflow,
  subgraphId: string,
  editedInstanceId: number,
  movedNodeIds: number[],
  nodeTypes: NodeTypes | null,
): HarvestResult {
  const empty: HarvestResult = { workflow: after, harvested: [], connected: [], skipped: [], removable: [] };
  if (!nodeTypes) return empty;

  const namesBefore = boundaryWidgetNames(before, subgraphId);
  const namesAfter = boundaryWidgetNames(after, subgraphId);
  const gainedWidgets = namesAfter.filter((name) => !namesBefore.includes(name));
  if (gainedWidgets.length === 0) return empty;

  // Which named inputs the move took off the boundary. Only those strand a
  // sibling: a slot that survived is still feeding every instance as before.
  const slotsBefore = new Set(
    ((before.definitions?.subgraphs ?? []).find((sg) => sg.id === subgraphId)?.inputs ?? [])
      .map((slot) => slot.name ?? ''),
  );
  const slotsAfter = new Set(
    ((after.definitions?.subgraphs ?? []).find((sg) => sg.id === subgraphId)?.inputs ?? [])
      .map((slot) => slot.name ?? ''),
  );
  const removedSlots = [...slotsBefore].filter((name) => !slotsAfter.has(name));
  if (removedSlots.length === 0) return empty;

  const beforeById = new Map((before.nodes ?? []).map((node) => [node.id, node]));
  const feeders = feedersByInstance(before, subgraphId);
  const movedByType = new Map<string, WorkflowNode>();
  for (const id of movedNodeIds) {
    const node = beforeById.get(id);
    if (node) movedByType.set(node.type, node);
  }
  if (movedByType.size === 0) return empty;

  const harvested: HarvestedValue[] = [];
  const skipped: HarvestSkip[] = [];
  /** instance node id → the node that was feeding it what the move took away. */
  const counterparts = new Map<number, WorkflowNode>();
  /** instance node id → { widget name → value } */
  const valuesFor = new Map<number, Map<string, unknown>>();

  for (const [instanceId, bySlot] of feeders) {
    if (instanceId === editedInstanceId) continue;
    for (const slotName of removedSlots) {
      const sourceId = bySlot.get(slotName);
      if (sourceId === undefined) {
        skipped.push({ instanceNodeId: instanceId, sourceNodeId: null, reason: 'nothing-fed-the-slot' });
        continue;
      }
      // The node that fed this sibling may BE one of the nodes that moved — a
      // single encoder wired into every instance. Then nothing was stranded and
      // nothing is orphaned: it is inside now, and every instance shares it.
      if (movedNodeIds.includes(sourceId)) continue;
      const source = beforeById.get(sourceId);
      const moved = source ? movedByType.get(source.type) : undefined;
      if (!source || !moved) {
        // A different kind of node fed this instance's slot — a switch, a
        // shared encoder, something the user wired deliberately. Its widgets
        // are not the ones that moved, so copying them would be an invention.
        skipped.push({ instanceNodeId: instanceId, sourceNodeId: sourceId, reason: 'different-node-type' });
        continue;
      }
      counterparts.set(instanceId, source);
      const movedWidgets = new Set(getWidgetDefinitions(nodeTypes, moved).map((w) => w.name));
      for (const widget of getWidgetDefinitions(nodeTypes, source)) {
        if (!gainedWidgets.includes(widget.name) || !movedWidgets.has(widget.name)) continue;
        const bucket = valuesFor.get(instanceId) ?? new Map<string, unknown>();
        bucket.set(widget.name, widget.value);
        valuesFor.set(instanceId, bucket);
        harvested.push({ instanceNodeId: instanceId, sourceNodeId: sourceId, widgetName: widget.name });
      }
    }
  }

  // ── connections for boundary inputs the move ADDED ────────────────────────
  // A moved node's own feeds become new boundary inputs, and only the instance
  // being edited gets them wired. On a shared type the other instances are left
  // with a required input and nothing in it, which the backend refuses — the
  // encoder's `clip` is exactly this. Each sibling is wired to whatever was
  // feeding the SAME input on its own counterpart.
  const afterDefinition = (after.definitions?.subgraphs ?? []).find((sg) => sg.id === subgraphId);
  const gainedConnections = [...slotsAfter]
    .filter((name) => !slotsBefore.has(name) && !namesAfter.includes(name));
  const connected: HarvestedConnection[] = [];
  const addedLinks: Workflow['links'] = [];
  let linkId = 1 + Math.max(
    after.last_link_id ?? 0,
    ...(after.links ?? []).map((link) => link[0]),
    ...(after.definitions?.subgraphs ?? []).flatMap((sg) => (sg.links ?? []).map((l) => l.id)),
  );
  const wiredInput = new Map<number, Map<number, number>>();

  for (const slotName of gainedConnections) {
    if (!afterDefinition) break;
    const boundarySlot = (afterDefinition.inputs ?? []).findIndex((slot) => slot.name === slotName);
    const interior = (afterDefinition.links ?? []).find(
      (link) => link.origin_id === -10 && link.origin_slot === boundarySlot,
    );
    if (!interior) continue;
    const innerNode = (afterDefinition.nodes ?? []).find((node) => node.id === interior.target_id);
    const innerInputName = innerNode?.inputs?.[interior.target_slot]?.name;
    if (!innerInputName) continue;

    for (const [instanceId, counterpart] of counterparts) {
      // What fed the same input on this instance's own copy of the node.
      const inputIndex = (counterpart.inputs ?? []).findIndex((i) => i.name === innerInputName);
      if (inputIndex < 0) continue;
      const feed = (before.links ?? []).find(
        (link) => link[3] === counterpart.id && link[4] === inputIndex,
      );
      if (!feed) continue;
      const placeholder = (after.nodes ?? []).find((node) => node.id === instanceId);
      const slotIndex = (placeholder?.inputs ?? []).findIndex((i) => i.name === slotName);
      if (!placeholder || slotIndex < 0 || placeholder.inputs[slotIndex].link != null) continue;

      addedLinks.push([linkId, feed[1], feed[2], instanceId, slotIndex, String(feed[5] ?? '*')]);
      const bySlot = wiredInput.get(instanceId) ?? new Map<number, number>();
      bySlot.set(slotIndex, linkId);
      wiredInput.set(instanceId, bySlot);
      connected.push({ instanceNodeId: instanceId, slotName, sourceNodeId: feed[1] });
      linkId += 1;
    }
  }

  if (harvested.length === 0 && connected.length === 0) return { ...empty, skipped };

  // Seat the harvested values by NAME against the boundary's widget order, and
  // record the links just made on each instance's own slot cache.
  const seat = (node: WorkflowNode): WorkflowNode => {
    const bucket = valuesFor.get(node.id);
    const wired = wiredInput.get(node.id);
    if ((!bucket && !wired) || node.type !== subgraphId) return node;
    let next = node;
    if (bucket) {
      const existing = Array.isArray(node.widgets_values) ? node.widgets_values : [];
      const values = namesAfter.map((name, index) => (
        bucket.has(name) ? bucket.get(name) : existing[index] ?? null
      ));
      while (values.length > 0 && values[values.length - 1] == null) values.pop();
      next = { ...next, widgets_values: values };
    }
    if (wired) {
      next = {
        ...next,
        inputs: (next.inputs ?? []).map((input, index) => (
          wired.has(index) ? { ...input, link: wired.get(index)! } : input
        )),
      };
    }
    return next;
  };

  // Only a source that is now feeding nothing at all can be offered for
  // removal. Counted on the workflow AFTER the move, since that is where the
  // links it lost have already gone.
  const afterLinks = after.links ?? [];
  const sources = new Set(harvested.map((entry) => entry.sourceNodeId));
  const removable = [...sources].filter(
    (id) => !movedNodeIds.includes(id) && !afterLinks.some((link) => link[1] === id),
  );

  const links = [...(after.links ?? []), ...(addedLinks ?? [])];
  // The nodes now feeding those inputs must say so too, or their outputs read as
  // unconnected and the next edit drops a link it cannot see.
  const withCaches = (after.nodes ?? []).map(seat).map((node) => ({
    ...node,
    outputs: (node.outputs ?? []).map((output, index) => {
      const found = links.filter((l) => l[1] === node.id && l[2] === index).map((l) => l[0]);
      return { ...output, links: found.length > 0 ? found : Array.isArray(output.links) ? [] : null };
    }),
  }));

  return {
    workflow: {
      ...after,
      nodes: withCaches,
      links,
      last_link_id: Math.max(after.last_link_id ?? 0, linkId - 1),
    },
    harvested,
    connected,
    skipped,
    removable,
  };
}

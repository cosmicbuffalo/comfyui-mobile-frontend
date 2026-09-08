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
  movedNodeIdMap: ReadonlyMap<number, number>,
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
  const editedFeeds = feeders.get(editedInstanceId);
  const afterDefinition = (after.definitions?.subgraphs ?? []).find((sg) => sg.id === subgraphId);
  // Boundary names may have suffixes (value, value_1). Resolve them through
  // their actual target instead of assuming they equal a widget's name.
  const promotedTargets = new Map<string, string>();
  for (const link of afterDefinition?.links ?? []) {
    if (link.origin_id !== -10) continue;
    const name = afterDefinition?.inputs?.[link.origin_slot]?.name;
    if (!name || !gainedWidgets.includes(name)) continue;
    const inner = afterDefinition?.nodes?.find((node) => node.id === link.target_id);
    const input = inner?.inputs?.[link.target_slot];
    if (input) promotedTargets.set(`${link.target_id}:${input.widget?.name ?? input.name}`, name);
  }

  const harvested: HarvestedValue[] = [];
  const skipped: HarvestSkip[] = [];
  /** instance node id → the node that was feeding it what the move took away. */
  const counterparts = new Map<number, Map<number, WorkflowNode>>();
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
      const movedId = editedFeeds?.get(slotName);
      const moved = movedId === undefined ? undefined : beforeById.get(movedId);
      if (!source || !moved || source.type !== moved.type || !movedNodeIds.includes(moved.id)) {
        // A different kind of node fed this instance's slot — a switch, a
        // shared encoder, something the user wired deliberately. Its widgets
        // are not the ones that moved, so copying them would be an invention.
        skipped.push({ instanceNodeId: instanceId, sourceNodeId: sourceId, reason: 'different-node-type' });
        continue;
      }
      const matched = counterparts.get(instanceId) ?? new Map<number, WorkflowNode>();
      counterparts.set(instanceId, matched);
      const pending = [{ moved, source }];
      while (pending.length > 0) {
        const pair = pending.pop()!;
        if (matched.has(pair.moved.id)) continue;
        matched.set(pair.moved.id, pair.source);
        const innerId = movedNodeIdMap.get(pair.moved.id);
        for (const widget of getWidgetDefinitions(nodeTypes, pair.source)) {
          const name = widget.inputName ?? widget.name;
          const boundaryName = promotedTargets.get(`${innerId}:${name}`);
          if (!boundaryName || widget.connected) continue;
          const bucket = valuesFor.get(instanceId) ?? new Map<string, unknown>();
          bucket.set(boundaryName, widget.value);
          valuesFor.set(instanceId, bucket);
          harvested.push({ instanceNodeId: instanceId, sourceNodeId: pair.source.id, widgetName: boundaryName });
        }
        // Walk only the portion that moved, pairing the same input and output
        // on each side. This carries a sibling's seconds primitive as well as
        // the expression it feeds, without guessing from node type alone.
        for (const [slot, input] of pair.moved.inputs.entries()) {
          const movedLink = (before.links ?? []).find((link) => link[3] === pair.moved.id && link[4] === slot);
          if (!movedLink || !movedNodeIds.includes(movedLink[1])) continue;
          const sourceSlot = pair.source.inputs.findIndex((candidate) => candidate.name === input.name);
          const sourceLink = (before.links ?? []).find((link) => link[3] === pair.source.id && link[4] === sourceSlot);
          const movedParent = beforeById.get(movedLink[1]);
          const sourceParent = sourceLink ? beforeById.get(sourceLink[1]) : undefined;
          if (!movedParent || !sourceParent || movedParent.type !== sourceParent.type || movedLink[2] !== sourceLink?.[2]) continue;
          pending.push({ moved: movedParent, source: sourceParent });
        }
      }
    }
  }

  // ── connections for boundary inputs the move ADDED ────────────────────────
  // A moved node's own feeds become new boundary inputs, and only the instance
  // being edited gets them wired. On a shared type the other instances are left
  // with a required input and nothing in it, which the backend refuses — the
  // encoder's `clip` is exactly this. Each sibling is wired to whatever was
  // feeding the SAME input on its own counterpart.
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
  const outerByInner = new Map([...movedNodeIdMap].map(([outer, inner]) => [inner, outer]));

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

    const originalId = innerNode ? outerByInner.get(innerNode.id) : undefined;
    for (const [instanceId, matched] of counterparts) {
      const counterpart = originalId === undefined ? undefined : matched.get(originalId);
      if (!counterpart) continue;
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
      // widgets_values is read through the instance's OWN proxy order when it
      // has one, and only falls back to boundary order without it. Seating by
      // boundary position regardless would rotate every value on an instance
      // whose list orders itself differently.
      const raw = (node.properties as Record<string, unknown> | undefined)?.proxyWidgets;
      const entries: Array<[string, string]> = Array.isArray(raw)
        ? raw
          .filter((entry): entry is [unknown, unknown] => Array.isArray(entry) && entry.length >= 2)
          .map((entry) => [String(entry[0]), String(entry[1])])
        : namesAfter.map((name) => ['-1', name]);
      const values = entries.map(([owner, name], index) => (
        owner === '-1' && bucket.has(name) ? bucket.get(name) : existing[index] ?? null
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

  // Counted against the links this harvest ends with, not the ones the move
  // left behind: a source re-wired into a sibling instance just above is
  // feeding something again, and reading the pre-harvest table would offer it
  // for removal anyway.
  const links = [...(after.links ?? []), ...(addedLinks ?? [])];

  // Which nodes the move left with nothing to do.
  //
  // The node that fed the retired slot is only the end of a chain. A `seconds`
  // primitive feeding a math expression feeding the boundary leaves BOTH with
  // no purpose once the expression's value is harvested, but one pass finds
  // neither removable: the expression still has the primitive pointing at it,
  // and the primitive still points at the expression. Each is held up by
  // something that is itself on the way out.
  //
  // So sweep to a fixed point. A node qualifies once every link out of it lands
  // on a node already going, and qualifying puts whatever fed IT up for the
  // same question. Repeat until a pass changes nothing, which also settles the
  // case where two harvested sources feed each other in list order.
  const afterById = new Map((after.nodes ?? []).map((node) => [node.id, node]));
  const definitionIds = new Set((after.definitions?.subgraphs ?? []).map((sg) => sg.id));
  const sources = new Set(harvested.map((entry) => entry.sourceNodeId));
  const candidates = new Set<number>(sources);
  const going = new Set<number>();
  const removable: number[] = [];
  let sweeping = true;
  while (sweeping) {
    sweeping = false;
    for (const id of [...candidates]) {
      if (going.has(id) || movedNodeIds.includes(id) || !afterById.has(id)) continue;
      // Still feeding something that is staying.
      if (links.some((link) => link[1] === id && !going.has(link[3]))) continue;
      going.add(id);
      removable.push(id);
      sweeping = true;
      for (const link of links) {
        if (link[3] !== id) continue;
        const parent = afterById.get(link[1]);
        // A subgraph instance is not a value holder — stranding one is a far
        // bigger claim than stranding a primitive, and it may be the point of
        // the graph rather than scaffolding. The sweep stops at it. Direct
        // feeders of the retired slot are seeded above and keep their old
        // eligibility whatever they are.
        if (!parent || definitionIds.has(parent.type) || !sources.has(parent.id)) continue;
        candidates.add(parent.id);
      }
    }
  }
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

import type {
  NodeTypes,
  Workflow,
  WorkflowNode,
  WorkflowSubgraphDefinition,
} from '@/api/types';
import { SUBGRAPH_INPUT_NODE_ID } from '@/utils/canonicalWorkflowOps';
import {
  getInputWidgetDefinitions,
  getSubgraphBoundaryWidgetSlots,
  getWidgetDefinitions,
} from '@/utils/widgetDefinitions';
import { getNodePropertyWidgetIndexMap } from '@/utils/workflowInputs';

/**
 * Keep every instance's promoted values in step with its subgraph's boundary.
 *
 * A placeholder holds one value per widget-backed boundary input, positionally,
 * and `properties.proxyWidgets` is what decides that order when it exists — it
 * is the list ComfyUI serializes values against. Boundary edits used to address
 * those values by a DIFFERENT index: the position among widget-backed boundary
 * inputs, ignoring the proxy list. The two agree only when the proxy list holds
 * nothing but boundary entries, and in the shipped templates it usually also
 * holds direct `[innerNodeId, widget]` entries — so an edit read, wrote or
 * spliced somebody else's value, and a sampler's step count could end up
 * holding a cfg or a prompt string.
 *
 * Rather than fix each edit's arithmetic separately, every edit now finishes
 * here: the proxy list is made to name each widget-backed boundary input
 * exactly once, values are carried across BY NAME rather than by position, and
 * anything the boundary no longer has is dropped. Direct proxy entries keep
 * their places and their values — this reconciles the boundary's half of the
 * list, not the whole of it.
 *
 * A boundary input that is widget-backed with no stored value is seeded from
 * the inner widget it drives, which is the value that would execute if nothing
 * were promoted. It cannot invent a per-instance value that was never written.
 */
export function reconcileInstanceWidgetValues(
  workflow: Workflow,
  subgraphId: string,
  nodeTypes: NodeTypes | null,
  /**
   * The widget-backed boundary names as they were BEFORE the edit. An instance
   * with no proxy list holds its values in that order and nothing else records
   * it, so without this the values cannot be matched to names — the first one
   * would be read as belonging to whichever slot now leads the boundary.
   */
  previousBoundaryNames?: string[],
): Workflow {
  const definition = (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === subgraphId);
  if (!definition) return workflow;

  const boundaryNames = getSubgraphBoundaryWidgetSlots(definition).flatMap(({ boundarySlot }) => {
    const name = (definition.inputs ?? [])[boundarySlot]?.name;
    return name ? [{ name, boundarySlot }] : [];
  });
  const seeds = new Map<string, unknown>(
    boundaryNames.map(({ name, boundarySlot }) => [
      name,
      readInnerSeedValue(definition, boundarySlot, nodeTypes),
    ]),
  );

  const previousNames = previousBoundaryNames ?? boundaryNames.map((entry) => entry.name);
  const reconcileNode = (node: WorkflowNode): WorkflowNode =>
    node.type === subgraphId
      ? reconcileInstance(node, boundaryNames, seeds, previousNames)
      : node;

  return {
    ...workflow,
    nodes: (workflow.nodes ?? []).map(reconcileNode),
    definitions: {
      ...(workflow.definitions ?? {}),
      subgraphs: (workflow.definitions?.subgraphs ?? []).map((sg) => ({
        ...sg,
        nodes: (sg.nodes ?? []).map(reconcileNode),
      })),
    },
  };
}

type ProxyEntry = [string, string];

function readProxyWidgets(node: WorkflowNode): ProxyEntry[] | null {
  const raw = (node.properties as Record<string, unknown> | undefined)?.proxyWidgets;
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((entry): entry is [unknown, unknown] => Array.isArray(entry) && entry.length >= 2)
    .map((entry): ProxyEntry => [String(entry[0]), String(entry[1])]);
}

function reconcileInstance(
  node: WorkflowNode,
  boundaryNames: Array<{ name: string; boundarySlot: number }>,
  seeds: Map<string, unknown>,
  previousNames: string[],
): WorkflowNode {
  const values = Array.isArray(node.widgets_values) ? node.widgets_values : [];
  const existingProxies = readProxyWidgets(node);

  // What this instance holds today, keyed the way it is actually read: a
  // boundary entry by name, a direct entry by inner node and widget.
  const heldByKey = new Map<string, unknown>();
  if (existingProxies) {
    existingProxies.forEach((entry, index) => {
      heldByKey.set(`${entry[0]} ${entry[1]}`, values[index]);
    });
  } else {
    // With no list, values sit in the widget-backed boundary order the instance
    // was written against, which is the order BEFORE this edit.
    previousNames.forEach((name, index) => {
      heldByKey.set(`-1 ${name}`, values[index]);
    });
  }

  // Boundary entries the list already has, in the order it has them, then any
  // the boundary has gained. Keeping existing positions means reconciling after
  // an unrelated edit does not reshuffle the card.
  const wanted = new Set(boundaryNames.map((entry) => entry.name));
  const seen = new Set<string>();
  const nextProxies: ProxyEntry[] = [];
  for (const entry of existingProxies ?? []) {
    if (entry[0] !== '-1') {
      nextProxies.push(entry);
      // A direct entry already occupies this widget's value slot, so the
      // boundary input of the same name must NOT be appended again below.
      // Without this the two describe one widget twice: a placeholder that
      // arrived with nine direct entries came back with nine more `-1` copies
      // of the same names, and every value after the first duplicate was read
      // one slot early — a promoted prompt resolving to a frame rate.
      seen.add(entry[1]);
      continue;
    }
    // A boundary entry the definition no longer has goes, and its value with it.
    if (!wanted.has(entry[1]) || seen.has(entry[1])) continue;
    seen.add(entry[1]);
    nextProxies.push(entry);
  }
  for (const { name } of boundaryNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    nextProxies.push(['-1', name]);
  }

  const nextValues = nextProxies.map((entry) => {
    const held = heldByKey.get(`${entry[0]} ${entry[1]}`);
    if (held !== undefined) return held;
    return entry[0] === '-1' ? (seeds.get(entry[1]) ?? null) : null;
  });

  // Trailing entries we have no value for are dropped rather than written as
  // null. The two are NOT the same to the desktop frontend on the path this
  // instance now takes: `_applyPromotedWidgetValues` guards on
  // `value !== undefined`, so a null is written into the widget store and
  // overwrites the inner widget's own default, while an index past the end of
  // the array is skipped and the default stands. Real templates serialize a
  // short array for exactly this reason.
  //
  // The loose `== null` also drops a trailing null the file already carried,
  // which is deliberate: null is not a valid widget value (litegraph's
  // `isWidgetValue` rejects it), so one sitting at the end of the list is an
  // instance claiming to promote a value it does not have. It reads the same
  // either way. `== null` is careful to leave a trailing `0`, `false` or `''`
  // alone — those ARE values, and losing them is the failure this guards.
  while (nextValues.length > 0 && nextValues[nextValues.length - 1] == null) {
    nextValues.pop();
  }

  // A list that is nothing but boundary entries, in boundary order, says
  // exactly what the boundary already says — and the desktop frontend cannot
  // resolve our `-1` sentinel to an interior node, so on load it quarantines
  // every such entry and leaves a `proxyWidgetErrorQuarantine` property behind.
  // (It rescues the values by input name, so nothing is lost, but the
  // diagnostic sticks to the file.) Writing the list only when it carries
  // something the boundary does not — direct entries, or an order of its own —
  // keeps the common case clean on both sides.
  const isRedundant =
    nextProxies.every((entry) => entry[0] === '-1')
    && nextProxies.length === boundaryNames.length
    && nextProxies.every((entry, index) => entry[1] === boundaryNames[index]?.name);

  const properties = { ...(node.properties ?? {}) };
  if (nextProxies.length > 0 && !isRedundant) {
    properties.proxyWidgets = nextProxies;
  } else {
    delete properties.proxyWidgets;
  }

  const unchanged =
    JSON.stringify(existingProxies ?? []) === JSON.stringify(isRedundant ? [] : nextProxies)
    && JSON.stringify(values) === JSON.stringify(nextValues);
  if (unchanged) return node;

  return { ...node, properties, widgets_values: nextValues };
}

/** The inner widget value a boundary input drives, for a slot with no stored value. */
function readInnerSeedValue(
  definition: WorkflowSubgraphDefinition,
  boundarySlot: number,
  nodeTypes: NodeTypes | null,
): unknown {
  for (const link of definition.links ?? []) {
    if (link.origin_id !== SUBGRAPH_INPUT_NODE_ID || link.origin_slot !== boundarySlot) continue;
    const innerNode = (definition.nodes ?? []).find((node) => node.id === link.target_id);
    const input = innerNode?.inputs?.[link.target_slot];
    const widgetName = input?.widget?.name ?? input?.name;
    if (!innerNode || !widgetName) continue;

    const values = innerNode.widgets_values;
    if (values && !Array.isArray(values) && typeof values === 'object') {
      return (values as Record<string, unknown>)[widgetName];
    }
    if (!Array.isArray(values)) continue;
    const byName = (widget: { name: string; inputName?: string }) =>
      (widget.inputName ?? widget.name) === widgetName;
    const index =
      getNodePropertyWidgetIndexMap(innerNode)?.[widgetName]
      ?? (nodeTypes
        ? (getWidgetDefinitions(nodeTypes, innerNode).find(byName)
          ?? getInputWidgetDefinitions(nodeTypes, innerNode).find(byName))?.widgetIndex
        : undefined);
    if (index != null && index >= 0) return values[index];
  }
  return undefined;
}

/** The widget-backed boundary input names of a definition, in boundary order. */
export function boundaryWidgetNames(
  definition: WorkflowSubgraphDefinition | undefined,
): string[] {
  if (!definition) return [];
  return getSubgraphBoundaryWidgetSlots(definition).flatMap(({ boundarySlot }) => {
    const name = (definition.inputs ?? [])[boundarySlot]?.name;
    return name ? [name] : [];
  });
}

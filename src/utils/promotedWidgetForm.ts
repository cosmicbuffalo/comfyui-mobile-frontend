import type {
  NodeTypes,
  Workflow,
  WorkflowNode,
  WorkflowSubgraphDefinition,
} from '@/api/types';
import { SUBGRAPH_INPUT_NODE_ID, type ScopeFrame } from '@/utils/canonicalWorkflowOps';
import {
  getInputWidgetDefinitions,
  getPlaceholderValueIndexForBoundarySlot,
  getSubgraphBoundaryWidgetIndexForSlot,
  getWidgetDefinitions,
  type LinkedWidgetRoute,
} from '@/utils/widgetDefinitions';
import { getNodePropertyWidgetIndexMap } from '@/utils/workflowInputs';

/**
 * How a promoted widget presents itself on the placeholder.
 *
 * Both forms are the same thing underneath — a subgraph boundary input wired to
 * an inner node's slot. What differs is whether that inner slot carries
 * `widget: { name }`:
 *
 * - `widget`: it does, so the boundary input counts as widget-backed. The
 *   placeholder draws an editable control and owns the value, per instance, in
 *   its `widgets_values`.
 * - `input`: it doesn't, so the slot is an ordinary socket. The placeholder
 *   draws a connection, holds no value of its own, and the inner node's own
 *   widget value — shared by every instance of the type — is what runs.
 *
 * This is the only lever ComfyUI itself reads (`getWidgetFromSlot` consults the
 * target slot's `widget`), which is why the form is stored there rather than in
 * metadata of our own: `normalizeSubgraphPlaceholders` rebuilds the
 * placeholder's slots from the definition on every load, so anything written
 * onto the placeholder would not survive the round trip.
 */
export type PromotedWidgetForm = 'widget' | 'input';

export interface PromotedWidgetSlot {
  /** Index into `definition.inputs`. */
  boundarySlot: number;
  /** The boundary input's name, which is what a `-1` proxy entry is keyed by. */
  boundaryName: string;
  form: PromotedWidgetForm;
  /** The inner node slot the boundary feeds. */
  targetSlot: number;
}

/**
 * Locate the boundary input that promotes one inner node's widget, in either
 * form. Scans the definition's links rather than `inputs[].linkIds`, which is a
 * cache the validator rebuilds and can be stale.
 */
export function findPromotedWidgetSlot(
  definition: WorkflowSubgraphDefinition | undefined,
  innerNodeId: number,
  widgetName: string,
): PromotedWidgetSlot | null {
  if (!definition) return null;
  const name = widgetName.trim();
  if (!name) return null;

  for (const link of definition.links ?? []) {
    if (link.origin_id !== SUBGRAPH_INPUT_NODE_ID) continue;
    if (link.target_id !== innerNodeId) continue;
    const boundary = (definition.inputs ?? [])[link.origin_slot];
    if (!boundary) continue;
    const innerNode = (definition.nodes ?? []).find((node) => node.id === innerNodeId);
    const targetInput = innerNode?.inputs?.[link.target_slot];
    if (!targetInput) continue;
    const slotName = targetInput.widget?.name ?? targetInput.name;
    if (slotName !== name) continue;
    return {
      boundarySlot: link.origin_slot,
      boundaryName: boundary.name ?? name,
      form: targetInput.widget != null ? 'widget' : 'input',
      targetSlot: link.target_slot,
    };
  }
  return null;
}

/** Apply a patch to every placeholder of `subgraphId`, in every scope. */
function patchInstances(
  workflow: Workflow,
  subgraphId: string,
  patch: (node: WorkflowNode) => WorkflowNode,
): Workflow {
  const patchNode = (node: WorkflowNode) => (node.type === subgraphId ? patch(node) : node);
  return {
    ...workflow,
    nodes: (workflow.nodes ?? []).map(patchNode),
    definitions: {
      ...(workflow.definitions ?? {}),
      subgraphs: (workflow.definitions?.subgraphs ?? []).map((sg) => ({
        ...sg,
        nodes: (sg.nodes ?? []).map(patchNode),
      })),
    },
  };
}

function readProxyWidgets(node: WorkflowNode): Array<[string, string]> | null {
  const raw = (node.properties as Record<string, unknown> | undefined)?.proxyWidgets;
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((entry): entry is [unknown, unknown] => Array.isArray(entry) && entry.length >= 2)
    .map((entry): [string, string] => [String(entry[0]), String(entry[1])]);
}

/**
 * Give every instance a value slot for a boundary input that has just become
 * widget-backed, at the index the boundary order assigns it.
 *
 * `widgets_values` is positional, so a widget appearing in the middle of the
 * boundary list has to push its neighbours along rather than be appended —
 * otherwise every later promoted widget reads its neighbour's value.
 */
export function insertPromotedValueOnInstances(
  workflow: Workflow,
  subgraphId: string,
  boundaryName: string,
  widgetIndex: number,
  value: unknown,
  /**
   * Every widget-backed boundary name in order, used to author a proxyWidgets
   * list for an instance that has none yet. ComfyUI orders a placeholder's
   * values by that list when it exists, so making it explicit the moment a
   * widget appears keeps our ordering and stock's from diverging.
   */
  boundaryWidgetNames?: string[],
): Workflow {
  return patchInstances(workflow, subgraphId, (node) => {
    const properties = { ...(node.properties ?? {}) };
    const existingProxies =
      readProxyWidgets(node)
      ?? (boundaryWidgetNames
        ? boundaryWidgetNames
            .filter((name) => name !== boundaryName)
            .map((name): [string, string] => ['-1', name])
        : null);
    if (existingProxies) {
      const withoutSelf = existingProxies.filter(
        (entry) => !(entry[0] === '-1' && entry[1] === boundaryName),
      );
      const at = Math.min(Math.max(widgetIndex, 0), withoutSelf.length);
      withoutSelf.splice(at, 0, ['-1', boundaryName]);
      properties.proxyWidgets = withoutSelf;
    }

    const values = Array.isArray(node.widgets_values)
      ? [...node.widgets_values]
      : node.widgets_values && typeof node.widgets_values === 'object'
        ? Object.values(node.widgets_values as Record<string, unknown>)
        : [];
    while (values.length < widgetIndex) values.push(null);
    values.splice(widgetIndex, 0, value);
    return { ...node, properties, widgets_values: values };
  });
}

/**
 * Drop the value slot a boundary input owned on every instance, along with the
 * `-1` proxy entry that named it.
 */
export function removePromotedValueFromInstances(
  workflow: Workflow,
  subgraphId: string,
  boundaryName: string,
  /** Null clears only the proxy entry, for a value slot already spliced out. */
  widgetIndex: number | null,
): Workflow {
  return patchInstances(workflow, subgraphId, (node) => {
    const properties = { ...(node.properties ?? {}) };
    const existingProxies = readProxyWidgets(node);
    if (existingProxies) {
      properties.proxyWidgets = existingProxies.filter(
        (entry) => !(entry[0] === '-1' && entry[1] === boundaryName),
      );
    }
    const values = node.widgets_values;
    const nextValues = widgetIndex != null && Array.isArray(values)
      ? values.filter((_value, index) => index !== widgetIndex)
      : values;
    return { ...node, properties, widgets_values: nextValues };
  });
}

/**
 * Write a value into an inner node's own widget store, so a widget losing its
 * per-instance home keeps the value it was showing rather than reverting to
 * whatever the shared definition last held.
 */
export function setInnerWidgetValue(
  node: WorkflowNode,
  widgetName: string,
  widgetIndex: number | null,
  value: unknown,
): WorkflowNode {
  const values = node.widgets_values;
  if (values && !Array.isArray(values) && typeof values === 'object') {
    return {
      ...node,
      widgets_values: { ...(values as Record<string, unknown>), [widgetName]: value },
    };
  }
  if (widgetIndex == null || widgetIndex < 0) return node;
  const next = Array.isArray(values) ? [...values] : [];
  while (next.length <= widgetIndex) next.push(null);
  next[widgetIndex] = value;
  return { ...node, widgets_values: next };
}

/**
 * The value one placeholder instance holds for a promoted widget. Reading it
 * per instance matters: the definition is shared, but the value is not, so
 * "the value on screen" is the one belonging to the instance the subgraph was
 * entered through.
 */
export function readInstancePromotedValue(
  workflow: Workflow,
  subgraphId: string,
  instanceNodeId: number | null,
  boundarySlot: number,
): unknown {
  const definition = (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === subgraphId);
  const instances: WorkflowNode[] = [
    ...(workflow.nodes ?? []),
    ...(workflow.definitions?.subgraphs ?? []).flatMap((sg) => sg.nodes ?? []),
  ].filter((node) => node.type === subgraphId);
  const instance =
    instances.find((node) => node.id === instanceNodeId) ?? instances[0];
  if (!instance) return undefined;
  // Resolved through the instance's OWN proxy order, which is what the card
  // reads and what execution reads. Counting widget-backed boundary inputs
  // instead lands on a different value the moment the instance also carries
  // direct proxy entries — and it then carries THAT value home.
  const index = getPlaceholderValueIndexForBoundarySlot(instance, definition, boundarySlot);
  const values = instance.widgets_values;
  if (index != null && Array.isArray(values)) return values[index];
  return undefined;
}

/** An inner node's own value for one of its widgets. */
export function readNodeWidgetValue(
  node: WorkflowNode,
  widgetName: string,
  widgetIndex: number | null,
): unknown {
  const values = node.widgets_values;
  if (values && !Array.isArray(values) && typeof values === 'object') {
    return (values as Record<string, unknown>)[widgetName];
  }
  if (widgetIndex == null || !Array.isArray(values)) return undefined;
  return values[widgetIndex];
}

/** One of this node's widgets, as seen from inside the subgraph that promotes it. */
export interface PromotedWidgetView {
  widgetName: string;
  /** Index into THIS node's own widget order — what the card's descriptors use. */
  innerWidgetIndex: number;
  form: PromotedWidgetForm;
  /**
   * Where the value lives when the form is `widget`: the placeholder instance
   * the scope was entered through. Absent for the `input` form, whose value
   * stays on the inner node.
   */
  route: LinkedWidgetRoute | null;
  /**
   * The boundary input is wired from outside on this instance, so the value
   * comes down the link and no control should be offered.
   */
  drivenByConnection: boolean;
  /** Index of this widget's slot in the definition's boundary input list. */
  boundarySlot: number;
  /** What the boundary calls this slot, which need not match the widget. */
  boundaryLabel: string;
  /**
   * Where the slot would land on a move, or null at that end of the list.
   * Computed over widget-backed slots only: stepping past a socket-only slot
   * would reorder the boundary without appearing to move the widget.
   */
  moveUpTo: number | null;
  moveDownTo: number | null;
  /**
   * The value the instance holds, for the `widget` form. The descriptors the
   * card builds carry the inner node's own (now unused) value, so the control
   * has to be shown this one instead.
   */
  value: unknown;
}

/**
 * The promoted widgets of one inner node, resolved through the instance the
 * subgraph was entered by.
 *
 * A promoted widget is still a widget of this node — promotion moves where the
 * value is STORED, not what the control is — so the card keeps drawing it and
 * routes reads and writes to the placeholder that owns the value. Which
 * placeholder matters: the definition is shared, the value is per instance.
 */
export function collectPromotedWidgetViews(
  workflow: Workflow | null,
  scopeStack: ScopeFrame[],
  node: WorkflowNode,
  nodeTypes: NodeTypes | null,
): PromotedWidgetView[] {
  if (!workflow) return [];
  const frame = scopeStack[scopeStack.length - 1];
  if (frame?.type !== 'subgraph') return [];
  const definition = (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === frame.id);
  if (!definition) return [];

  const parentFrame = scopeStack[scopeStack.length - 2];
  const parentSubgraphId = parentFrame?.type === 'subgraph' ? parentFrame.id : null;
  const parentNodes = parentSubgraphId
    ? ((workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === parentSubgraphId)?.nodes ?? [])
    : (workflow.nodes ?? []);
  const placeholder = parentNodes.find((candidate) => candidate.id === frame.placeholderNodeId);

  const views: PromotedWidgetView[] = [];
  (node.inputs ?? []).forEach((input, inputSlot) => {
    if (input.link == null) return;
    const link = (definition.links ?? []).find((candidate) => candidate.id === input.link);
    if (!link || link.origin_id !== SUBGRAPH_INPUT_NODE_ID) return;
    if (link.target_id !== node.id || link.target_slot !== inputSlot) return;

    const boundary = (definition.inputs ?? [])[link.origin_slot];
    const widgetName = input.widget?.name ?? input.name;
    if (!widgetName) return;
    const innerWidgetIndex = resolveInnerWidgetIndex(node, widgetName, nodeTypes);
    if (innerWidgetIndex == null) return;

    const form: PromotedWidgetForm = input.widget != null ? 'widget' : 'input';
    const valueIndex = getPlaceholderValueIndexForBoundarySlot(
      placeholder,
      definition,
      link.origin_slot,
    );
    const drivenByConnection = placeholder?.inputs?.[link.origin_slot]?.link != null;

    const instanceValue =
      form === 'widget' && placeholder && valueIndex != null
        ? readNodeValueAt(placeholder, valueIndex, widgetName)
        : undefined;

    const widgetSlots = (definition.inputs ?? []).flatMap((slot, index) =>
      getSubgraphBoundaryWidgetIndexForSlot(definition, index) === null ? [] : [index],
    );
    const position = widgetSlots.indexOf(link.origin_slot);

    views.push({
      widgetName,
      innerWidgetIndex,
      form,
      drivenByConnection,
      boundarySlot: link.origin_slot,
      boundaryLabel:
        boundary?.label || boundary?.localized_name || boundary?.name || `#${link.origin_slot}`,
      moveUpTo: position > 0 ? widgetSlots[position - 1] : null,
      moveDownTo:
        position >= 0 && position < widgetSlots.length - 1 ? widgetSlots[position + 1] : null,
      value: instanceValue,
      route:
        form === 'widget' && placeholder && valueIndex != null
          ? {
              subgraphId: parentSubgraphId,
              nodeId: placeholder.id,
              widgetIndex: valueIndex,
              widgetName,
              itemKey: placeholder.itemKey,
            }
          : null,
    });
  });
  return views;
}

/** Which slot of the node's own widgets_values a widget owns. */
function resolveInnerWidgetIndex(
  node: WorkflowNode,
  widgetName: string,
  nodeTypes: NodeTypes | null,
): number | null {
  const byName = (widget: { name: string; inputName?: string }) =>
    (widget.inputName ?? widget.name) === widgetName;
  return (
    getNodePropertyWidgetIndexMap(node)?.[widgetName]
    ?? (nodeTypes
      ? (getWidgetDefinitions(nodeTypes, node).find(byName)
        ?? getInputWidgetDefinitions(nodeTypes, node).find(byName))?.widgetIndex
      : undefined)
    ?? null
  );
}

/** One entry of a node's widgets_values, by index or by name. */
function readNodeValueAt(
  node: WorkflowNode,
  index: number,
  widgetName: string,
): unknown {
  const values = node.widgets_values;
  if (Array.isArray(values)) return values[index];
  if (values && typeof values === 'object') {
    return (values as Record<string, unknown>)[widgetName];
  }
  return undefined;
}

/**
 * Permute every instance's promoted values to follow a new boundary order.
 *
 * `widgets_values` is positional, so a slot that moves without its value takes
 * its neighbour's number — the same class of corruption as a displaced link,
 * and just as silent when the two happen to be the same type. The permutation
 * is computed from the names rather than the indices for that reason.
 *
 * `proxyWidgets` decides the order when it exists, so it is permuted in step;
 * direct proxy entries (those naming an inner node) keep their positions, since
 * this reorder is about the boundary.
 */
export function reorderInstancePromotedValues(
  workflow: Workflow,
  subgraphId: string,
  order: {
    /** Widget-backed boundary names, before and after — the order values sit in
     *  when an instance has no explicit proxyWidgets list. */
    oldWidgetNames: string[];
    newWidgetNames: string[];
    /**
     * EVERY boundary input name in the new order. Promoted entries are ranked
     * against this, not the widget-backed subset: an input-form promotion is a
     * promoted slot with no widget, so ranking by the subset cannot place it
     * and would sink it to the end on any move at all.
     */
    newBoundaryNames: string[];
  },
): Workflow {
  const { oldWidgetNames, newWidgetNames, newBoundaryNames } = order;
  if (oldWidgetNames.length !== newWidgetNames.length) return workflow;

  return patchInstances(workflow, subgraphId, (node) => {
    const values = Array.isArray(node.widgets_values) ? node.widgets_values : null;
    const proxies = readProxyWidgets(node);

    if (proxies) {
      // Only the boundary-routed entries take part, and only among themselves.
      // Zipping them against the FULL widget-backed boundary list renamed them
      // to the first N slots instead of reordering the ones they name — with
      // the values left at their indices, so a seed silently became a width.
      const promotedNames = proxies
        .filter((entry) => entry[0] === '-1')
        .map((entry) => entry[1]);
      const rank = (name: string) => {
        const index = newBoundaryNames.indexOf(name);
        return index < 0 ? Number.MAX_SAFE_INTEGER : index;
      };
      const queue = promotedNames
        .map((name, index) => ({ name, index }))
        .sort((left, right) => rank(left.name) - rank(right.name) || left.index - right.index)
        .map((entry) => entry.name);
      const nextProxies = proxies.map((entry): [string, string] =>
        entry[0] === '-1' && queue.length > 0 ? ['-1', queue.shift()!] : entry,
      );
      const nextValues = values
        ? nextProxies.map((entry, index) => {
            const from = proxies.findIndex(
              (candidate) => candidate[0] === entry[0] && candidate[1] === entry[1],
            );
            return from >= 0 ? values[from] : values[index];
          })
        : node.widgets_values;
      return {
        ...node,
        properties: { ...(node.properties ?? {}), proxyWidgets: nextProxies },
        widgets_values: nextValues,
      };
    }

    if (!values) return node;
    return {
      ...node,
      widgets_values: newWidgetNames.map((name, index) => {
        const from = oldWidgetNames.indexOf(name);
        return from >= 0 ? values[from] : values[index];
      }),
    };
  });
}

/**
 * The inner widget names one boundary input feeds.
 *
 * A promoted widget is shown under the BOUNDARY's name on the placeholder, and
 * that name need not match the widget it drives — a slot called "positive" can
 * feed a `text` widget. Naming both, the way a connection row does, is what
 * tells you which inner control you are actually turning.
 */
export function resolveBoundaryTargetWidgetNames(
  definition: WorkflowSubgraphDefinition | undefined,
  boundarySlot: number,
): string[] {
  if (!definition) return [];
  const names: string[] = [];
  for (const link of definition.links ?? []) {
    if (link.origin_id !== SUBGRAPH_INPUT_NODE_ID || link.origin_slot !== boundarySlot) continue;
    const innerNode = (definition.nodes ?? []).find((node) => node.id === link.target_id);
    const input = innerNode?.inputs?.[link.target_slot];
    const name = input?.widget?.name ?? input?.name;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

import type { WorkflowNode, NodeTypeDefinition } from '@/api/types';
import { DYNAMIC_COMBO_V3, getDynamicComboSubInputs, orderedInputNames, type DynamicComboSubInput } from './comboValues';
import { buildDefaultWidgetValues, getDefaultWidgetValue, getDynamicComboConnectionInputs, isUnsavedWidgetType, isWidgetBackedInput } from './defaultInputs';
import { getNodePropertyWidgetIndexMap, getWidgetValue, skipImplicitSeedControlSlot } from './widgetSlots';
import { isDynamicGroup, groupRowCount, groupFields, getDynamicGroupSubInputs, readGroupRows, type DynamicGroupEdit } from './dynamicGroups';

export function occupiesWidgetSlot(
  node: WorkflowNode,
  name: string,
  typeOrOptions: string | unknown[],
  inputOptions?: Record<string, unknown>
): boolean {
  const inputEntry = node.inputs.find((i) => i.name === name);
  if (inputOptions?.forceInput === true || inputOptions?.defaultInput === true) return false;
  // Stock never saves these, so they hold no position in widgets_values.
  if (isUnsavedWidgetType(typeOrOptions)) return false;
  if (inputEntry?.widget) return true;
  if (isWidgetBackedInput(typeOrOptions, inputOptions)) return true;
  // Saved workflows omit socketless/legacy custom widgets from node.inputs.
  // Preserve that concrete workflow evidence even when object_info lacks a
  // modern `socketless` or `widgetType` declaration.
  return inputEntry === undefined;
}

export interface ActiveNodeInputDefinition extends DynamicComboSubInput {
  widgetIndex: number | null;
  inputIndex: number;
  connected: boolean;
  value: unknown;
}

/**
 * Flatten the currently active input schema in widgets_values order. Dynamic
 * children retain their fully-qualified names so two branches may safely reuse
 * a bare child name and nested DynamicCombos can be addressed unambiguously.
 */

export function getActiveNodeInputDefinitions(
  typeDef: NodeTypeDefinition,
  node: WorkflowNode,
  widgetIndexMap?: Record<string, number> | null,
): ActiveNodeInputDefinition[] {
  const required = typeDef.input?.required ?? {};
  const optional = typeDef.input?.optional ?? {};
  const order = orderedInputNames(typeDef);
  const propertyMap = getNodePropertyWidgetIndexMap(node);
  const definitions: ActiveNodeInputDefinition[] = [];
  let cursor = 0;

  const process = (
    name: string,
    qualifiedName: string,
    inputDef: [string | unknown[], Record<string, unknown>?],
    groupField = false,
  ) => {
    const [typeOrOptions, inputOptions] = inputDef;
    const inputIndex = node.inputs.findIndex((entry) => entry.name === qualifiedName);
    const inputEntry = inputIndex >= 0 ? node.inputs[inputIndex] : undefined;
    const hasWidgetSlot = occupiesWidgetSlot(node, qualifiedName, typeOrOptions, inputOptions);
    const mappedIndex = widgetIndexMap?.[qualifiedName]
      ?? propertyMap?.[qualifiedName]
      ?? (qualifiedName === name ? widgetIndexMap?.[name] ?? propertyMap?.[name] : undefined);
    const widgetIndex = hasWidgetSlot ? mappedIndex ?? cursor : null;
    const storedValue = widgetIndex === null
      ? undefined
      : getWidgetValue(node, qualifiedName, widgetIndex);
    const value = storedValue ?? (groupField ? getDefaultWidgetValue(typeOrOptions, inputOptions) : undefined);

    definitions.push({
      name,
      qualifiedName,
      inputDef,
      widgetIndex,
      inputIndex,
      connected: inputEntry?.link != null,
      value,
    });

    if (!hasWidgetSlot) return;
    const ownWidgetIndex = widgetIndex ?? cursor;
    cursor = Math.max(cursor + 1, ownWidgetIndex + 1);
    if (isDynamicGroup(typeOrOptions)) {
      for (const sub of getDynamicGroupSubInputs(inputOptions, qualifiedName, groupRowCount(value, inputOptions))) {
        process(sub.name, sub.qualifiedName, sub.inputDef, true);
      }
      return;
    }
    if (
      typeof typeOrOptions === 'string' && typeOrOptions.toUpperCase() === 'INT' &&
      (name === 'seed' || name === 'noise_seed') &&
      skipImplicitSeedControlSlot(node, ownWidgetIndex + 1)
    ) {
      cursor = Math.max(cursor, ownWidgetIndex + 2);
    }
    if (typeof typeOrOptions !== 'string' || typeOrOptions.toUpperCase() !== DYNAMIC_COMBO_V3) return;

    const selected = value ?? getDefaultWidgetValue(typeOrOptions, inputOptions);
    for (const sub of getDynamicComboSubInputs(
      typeOrOptions,
      inputOptions,
      selected,
      qualifiedName,
    )) {
      process(sub.name, sub.qualifiedName, sub.inputDef);
    }
  };

  for (const name of order) {
    const inputDef = required[name] ?? optional[name];
    if (inputDef) process(name, name, inputDef);
  }
  return definitions;
}

/** Index just past the slots this option's sub-inputs occupy on `node`. */

function advancePastSubInputs(
  node: WorkflowNode,
  subInputs: DynamicComboSubInput[],
  startIndex: number
): number {
  let index = startIndex;
  for (const sub of subInputs) {
    const [subType, subOpts] = sub.inputDef;
    if (!occupiesWidgetSlot(node, sub.qualifiedName, subType, subOpts)) continue;
    const ownIndex = index;
    index += 1;
    if (String(subType).toUpperCase() === 'INT' && (sub.name === 'seed' || sub.name === 'noise_seed')) {
      if (skipImplicitSeedControlSlot(node, index)) index += 1;
    }
    if (String(subType).toUpperCase() === DYNAMIC_COMBO_V3) {
      // Nested DynamicCombo (e.g. SaveVideo.codec/h264/encoding): its own
      // sub-inputs sit inline, so recurse using the value actually stored.
      const selected = getWidgetValue(node, sub.qualifiedName, ownIndex);
      index = advancePastSubInputs(
        node,
        getDynamicComboSubInputs(subType, subOpts, selected, sub.qualifiedName),
        index
      );
    } else if (isDynamicGroup(subType)) {
      // A DynamicGroup's rows follow its count slot inline, like a nested combo's branch.
      const count = groupRowCount(getWidgetValue(node, sub.qualifiedName, ownIndex), subOpts);
      index = advancePastSubInputs(node, getDynamicGroupSubInputs(subOpts, sub.qualifiedName, count), index);
    }
  }
  return index;
}

/**
 * Switching a COMFY_DYNAMICCOMBO_V3 to a different option swaps which
 * conditional sub-inputs exist, so the slots the old option occupied have to be
 * replaced by defaults for the new one. Writing only the combo value leaves the
 * previous option's values in place: every later widget reads one slot off, and
 * the queued prompt silently carries the wrong values (a stale width arriving
 * as a scale multiplier, a scale_method resolved from a leftover integer).
 *
 * Returns the rebuilt widgets_values, or null when nothing needs to change.
 */

export function rebuildDynamicComboWidgetValues(
  node: WorkflowNode,
  inputName: string,
  inputDef: [string | unknown[], Record<string, unknown>?],
  comboIndex: number,
  nextValue: unknown
): unknown[] | null {
  const [typeOrOptions, inputOptions] = inputDef;
  if (String(typeOrOptions).toUpperCase() !== DYNAMIC_COMBO_V3) return null;
  if (!Array.isArray(node.widgets_values)) return null;
  if (comboIndex < 0 || comboIndex >= node.widgets_values.length) return null;

  const previousValue = node.widgets_values[comboIndex];
  if (String(previousValue) === String(nextValue)) return null;

  const oldSubInputs = getDynamicComboSubInputs(typeOrOptions, inputOptions, previousValue, inputName);
  const newSubInputs = getDynamicComboSubInputs(typeOrOptions, inputOptions, nextValue, inputName);
  // Unknown selection on either side: leave the values alone rather than guess.
  if (oldSubInputs.length === 0 && newSubInputs.length === 0) return null;

  const spanStart = comboIndex + 1;
  const spanEnd = advancePastSubInputs(node, oldSubInputs, spanStart);

  // The replacement values are for a fresh selection, so no sockets are
  // materialized and buildDefaultWidgetValues' slot rules apply directly.
  const replacement = buildDefaultWidgetValues({
    input: {
      required: Object.fromEntries(newSubInputs.map((s) => [s.name, s.inputDef])),
    },
    input_order: { required: newSubInputs.map((s) => s.name) },
  });

  const next = [...node.widgets_values];
  next.splice(spanStart, spanEnd - spanStart, ...replacement);
  next[comboIndex] = nextValue;
  return next;
}

export interface DynamicComboNodeRebuild {
  node: WorkflowNode;
  removedLinkIds: number[];
}

/**
 * Reconcile a DynamicCombo's conditional sockets alongside its widget span.
 * Shared sockets keep their links; sockets exclusive to the old option are
 * removed and reported so the workflow's link table/source outputs can be
 * cleaned by the owning scope.
 */

export function rebuildDynamicComboNode(
  node: WorkflowNode,
  typeDef: NodeTypeDefinition,
  inputName: string,
  inputDef: [string | unknown[], Record<string, unknown>?],
  comboIndex: number,
  nextValue: unknown,
): DynamicComboNodeRebuild | null {
  if (isDynamicGroup(inputDef[0])) return rebuildDynamicGroupNode(node, typeDef, inputName, inputDef[1], comboIndex, nextValue);
  const rebuiltValues = rebuildDynamicComboWidgetValues(
    node,
    inputName,
    inputDef,
    comboIndex,
    nextValue,
  );
  if (!rebuiltValues) return null;

  const prefix = `${inputName}.`;
  const oldDescendantNames = new Set(
    getActiveNodeInputDefinitions(typeDef, node)
      .map((definition) => definition.qualifiedName)
      .filter((name) => name.startsWith(prefix)),
  );
  for (const input of node.inputs) {
    if (input.name.startsWith(prefix)) oldDescendantNames.add(input.name);
  }
  const newSockets = getDynamicComboConnectionInputs(inputName, inputDef, nextValue);
  const newSocketByName = new Map(newSockets.map((input) => [input.name, input]));
  const removedLinkIds: number[] = [];

  const provisionalInputs = node.inputs.flatMap((input) => {
    if (!oldDescendantNames.has(input.name)) return [input];
    const replacement = newSocketByName.get(input.name);
    if (replacement) {
      const withReplacementSchema = (link: number | null) => {
        const next = { ...input, type: replacement.type, link };
        if (replacement.widget) next.widget = { ...replacement.widget };
        else delete next.widget;
        return next;
      };
      const oldTypes = String(input.type).toUpperCase().split(',').map((type) => type.trim());
      const newTypes = replacement.type.toUpperCase().split(',').map((type) => type.trim());
      const compatible = oldTypes.includes('*') || newTypes.includes('*') ||
        oldTypes.some((type) => newTypes.includes(type));
      if (compatible) return [withReplacementSchema(input.link)];
      // A same-named socket is not necessarily the same contract across
      // options. Keeping an IMAGE link after the branch changes that socket to
      // MODEL leaves an invalid graph that only fails at queue time.
      if (input.link != null) removedLinkIds.push(input.link);
      return [withReplacementSchema(null)];
    }
    if (input.link != null) removedLinkIds.push(input.link);
    return [];
  });
  for (const socket of newSockets) {
    if (!provisionalInputs.some((input) => input.name === socket.name)) {
      provisionalInputs.push({ ...socket, link: null });
    }
  }

  // Any per-node widget-index metadata was recorded against the old slot
  // layout and is stale by construction once the branch swaps slots. Strip it
  // before the active-definition walk below, which would otherwise honor it.
  let properties = node.properties;
  if (properties && '__lm_widget_ids' in properties) {
    const rest = { ...properties };
    delete rest.__lm_widget_ids;
    properties = rest;
  }

  const provisionalNode: WorkflowNode = {
    ...node,
    widgets_values: rebuiltValues,
    inputs: provisionalInputs,
    properties,
  };
  return {
    node: { ...provisionalNode, inputs: sortInputsBySchema(typeDef, provisionalNode, node) },
    removedLinkIds,
  };
}

/** Active schema order first; inputs outside the schema keep their previous relative order. */
function sortInputsBySchema(typeDef: NodeTypeDefinition, next: WorkflowNode, previous: WorkflowNode) {
  const activeOrder = getActiveNodeInputDefinitions(typeDef, next)
    .map((definition) => definition.qualifiedName);
  const orderByName = new Map(activeOrder.map((name, index) => [name, index]));
  const originalOrder = new Map(previous.inputs.map((input, index) => [input.name, index]));
  return [...next.inputs].sort((left, right) => {
    const leftOrder = orderByName.get(left.name);
    const rightOrder = orderByName.get(right.name);
    if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
    if (leftOrder !== undefined) return -1;
    if (rightOrder !== undefined) return 1;
    return (originalOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
      (originalOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER);
  });
}

function rebuildDynamicGroupNode(node: WorkflowNode, typeDef: NodeTypeDefinition, name: string, options: Record<string, unknown> | undefined, index: number, value: unknown): DynamicComboNodeRebuild | null {
  if (!value || typeof value !== 'object' || !('rows' in value) || !Array.isArray(value.rows)) return null;
  const { rows, order } = value as DynamicGroupEdit;
  if (rows.length !== groupRowCount(rows.length, options)) return null;
  const oldRows = readGroupRows(node, name, index, options);
  const fields = groupFields(options);
  const nextValues = Array.isArray(node.widgets_values) ? [...node.widgets_values] : { ...node.widgets_values };
  if (Array.isArray(nextValues)) {
    nextValues.splice(index, 1 + oldRows.length * Object.keys(fields).length, rows.length, ...rows.flatMap(row => Object.keys(fields).map(field => row[field])));
  } else {
    for (const key of Object.keys(nextValues)) if (key.startsWith(`${name}.`)) delete nextValues[key];
    nextValues[name] = rows.length;
    rows.forEach((row, rowIndex) => Object.entries(row).forEach(([field, fieldValue]) => { nextValues[`${name}.${rowIndex}.${field}`] = fieldValue; }));
  }
  const removedLinkIds: number[] = [];
  const prefix = `${name}.`;
  const kept = node.inputs.filter(input => !input.name.startsWith(prefix) && input.name !== name);
  rows.forEach((_, row) => {
    for (const [field, definition] of Object.entries(fields)) {
      const oldName = `${name}.${order[row]}.${field}`;
      const old = node.inputs.find(input => input.name === oldName);
      if (definition[1]?.socketless === true) continue;
      kept.push({ ...old, name: `${name}.${row}.${field}`, type: String(definition[0]), link: old?.link ?? null, widget: { name: `${name}.${row}.${field}` } });
    }
  });
  for (const input of node.inputs) if (input.link != null && !kept.some(next => next.link === input.link)) removedLinkIds.push(input.link);
  const properties = { ...node.properties };
  delete properties.__lm_widget_ids;
  const next = { ...node, properties, inputs: kept, widgets_values: nextValues };
  return { node: { ...next, inputs: sortInputsBySchema(typeDef, next, node) }, removedLinkIds };
}

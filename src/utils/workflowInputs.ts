import type { Workflow, WorkflowNode, NodeTypes, NodeTypeDefinition } from '@/api/types';
import { collectAllWorkflowNodes } from '@/utils/workflowNodes';
import { ueSlotKey, type UeLinkMap } from '@/utils/useEverywhere';
import { extractLoraList, findLoraListIndex, isPowerLoraLoaderNodeType } from '@/utils/loraManager';
import {
  extractTriggerWordList,
  extractTriggerWordListLoose,
  extractTriggerWordMessage,
  findTriggerWordListIndex,
  findTriggerWordMessageIndex,
  isTriggerWordToggleNodeType
} from '@/utils/triggerWordToggle';

const DATE_PARTS = {
  d: (date: Date) => date.getDate(),
  M: (date: Date) => date.getMonth() + 1,
  h: (date: Date) => date.getHours(),
  m: (date: Date) => date.getMinutes(),
  s: (date: Date) => date.getSeconds(),
};

const DATE_FORMAT_PATTERN =
  Object.keys(DATE_PARTS)
    .map((key) => `${key}${key}?`)
    .join("|") + "|yyy?y?";

const ILLEGAL_FILENAME_CHARS =
  // eslint-disable-next-line no-control-regex
  /[/?<>\\:*|"\x00-\x1F\x7F]/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatDateToken(text: string, date: Date): string {
  return text.replace(new RegExp(DATE_FORMAT_PATTERN, "g"), (token: string): string => {
    if (token === "yy") return `${date.getFullYear()}`.substring(2);
    if (token === "yyyy") return date.getFullYear().toString();
    if (token[0] in DATE_PARTS) {
      const part = DATE_PARTS[token[0] as keyof typeof DATE_PARTS](date);
      return `${part}`.padStart(token.length, "0");
    }
    return token;
  });
}

function resolveReplacementWidgetValue(
  workflow: Workflow,
  node: WorkflowNode,
  widgetName: string,
): unknown {
  const widgetIndexMap = getWorkflowWidgetIndexMap(workflow, node.id);
  const mappedIndex = widgetIndexMap?.[widgetName];
  if (mappedIndex !== undefined) {
    return getWidgetValue(node, widgetName, mappedIndex);
  }

  return getWidgetValue(node, widgetName, undefined);
}

function applyTextReplacements(workflow: Workflow, value: string): string {
  const allNodes = collectAllWorkflowNodes(workflow);

  return value.replace(/%([^%]+)%/g, (match, text: string) => {
    const split = text.split(".");
    if (split.length !== 2) {
      if (split[0]?.startsWith("date:")) {
        return formatDateToken(split[0].substring(5), new Date());
      }

      if (text !== "width" && text !== "height") {
        console.warn("[workflowInputs] Invalid replacement pattern", text);
      }
      return match;
    }

    let nodes = allNodes.filter(
      (nodeItem) => nodeItem.properties?.["Node name for S&R"] === split[0]
    );
    if (!nodes.length) {
      nodes = allNodes.filter(
        (nodeItem) => (nodeItem as { title?: unknown }).title === split[0]
      );
    }
    if (!nodes.length) {
      console.warn("[workflowInputs] Unable to find node", split[0]);
      return match;
    }
    if (nodes.length > 1) {
      console.warn("[workflowInputs] Multiple nodes matched", split[0], "using first match");
    }

    const node = nodes[0];
    const widgetValue = resolveReplacementWidgetValue(workflow, node, split[1]);
    if (widgetValue === undefined) {
      console.warn(
        "[workflowInputs] Unable to find widget",
        split[1],
        "on node",
        split[0],
        node
      );
      return match;
    }

    return `${widgetValue ?? ""}`.replace(ILLEGAL_FILENAME_CHARS, "_");
  });
}

function finalizeInputValue(
  workflow: Workflow,
  inputName: string,
  value: unknown,
): unknown {
  if (inputName === "filename_prefix" && typeof value === "string") {
    return applyTextReplacements(workflow, value);
  }
  return value;
}

function getPrimitiveInlineValue(node: WorkflowNode): unknown {
  const type = String(node.type || '');
  if (!type.startsWith('Primitive') && node.type !== 'PrimitiveNode') {
    return undefined;
  }

  if (Array.isArray(node.widgets_values)) {
    return node.widgets_values[0];
  }

  if (isRecord(node.widgets_values)) {
    const value = node.widgets_values.value;
    return value !== undefined ? value : node.widgets_values[0];
  }

  return undefined;
}

export function getWidgetValue(
  node: WorkflowNode,
  name: string,
  index: number | undefined
): unknown {
  const values = node.widgets_values;
  if (Array.isArray(values)) {
    if (index === undefined || index < 0 || index >= values.length) return undefined;
    return values[index];
  }
  if (isRecord(values)) {
    if (values[name] !== undefined) return values[name];
    if (node.type === 'VHS_VideoCombine' && name === 'save_image' && values.save_output !== undefined) {
      return values.save_output;
    }
  }
  return undefined;
}

export function getWorkflowWidgetIndexMap(
  workflow: Workflow,
  nodeId: number
): Record<string, number> | null {
  const entry = workflow.widget_idx_map?.[String(nodeId)];
  if (entry) {
    return entry;
  }
  const extraMap = workflow.extra?.widget_idx_map as Record<string, Record<string, number>> | undefined;
  return extraMap?.[String(nodeId)] ?? null;
}

/**
 * Decide whether to skip past ComfyUI's auto-added control_after_generate slot
 * that conventionally follows an INT seed widget.
 *
 * Most ComfyUI nodes have this widget; some custom nodes (Efficient KSampler
 * family) strip it in their own JS. The resulting saved workflows can be in
 * any of three shapes at the control slot:
 *   - present, string value (stock ComfyUI: 'fixed' / 'randomize' / etc.)
 *   - present, null value (Efficient Nodes leaves the slot but blanks it)
 *   - absent entirely (slot index >= widgets_values.length)
 *
 * Returns true (bump past the slot) when the value at controlSlotIndex is a
 * string, null, or out of bounds. Returns false when the slot holds a real
 * widget value (number / boolean / non-null object) — that means
 * control_after_generate wasn't there to begin with and the slot belongs to
 * the next declared widget.
 */
export function skipImplicitSeedControlSlot(
  node: WorkflowNode,
  controlSlotIndex: number,
): boolean {
  if (!Array.isArray(node.widgets_values)) return false;
  if (controlSlotIndex >= node.widgets_values.length) return false;
  const value = node.widgets_values[controlSlotIndex];
  if (value === null) return true;
  if (typeof value === 'string') return true;
  return false;
}

export function getNodePropertyWidgetIndexMap(
  node: WorkflowNode
): Record<string, number> | null {
  const widgetIds = node.properties?.__lm_widget_ids;
  if (!Array.isArray(widgetIds)) return null;

  const result: Record<string, number> = {};
  widgetIds.forEach((value, index) => {
    if (typeof value !== 'string' || !value) return;
    if (value.startsWith('__lm_')) return;
    result[value] = index;
  });

  return Object.keys(result).length > 0 ? result : null;
}

export function getNodeWidgetIndexMap(
  workflow: Workflow,
  node: WorkflowNode
): Record<string, number> | null {
  return getWorkflowWidgetIndexMap(workflow, node.id) ?? getNodePropertyWidgetIndexMap(node);
}

export function isWidgetInputType(typeOrOptions: string | unknown[]): boolean {
  if (Array.isArray(typeOrOptions)) {
    const signature = typeOrOptions.map((entry) => String(entry)).join(',').toUpperCase();
    if (signature.includes('AUTOCOMPLETE_TEXT_PROMPT') || signature.includes('AUTOCOMPLETE_TEXT_LORAS')) {
      return true;
    }
    return true;
  }
  const normalized = String(typeOrOptions).toUpperCase();
  return normalized === 'INT' ||
    normalized === 'FLOAT' ||
    normalized === 'BOOLEAN' ||
    normalized === 'STRING' ||
    normalized.includes('AUTOCOMPLETE_TEXT_LORAS') ||
    normalized.includes('AUTOCOMPLETE_TEXT_PROMPT');
}

// V3 combo type strings used by ComfyUI's newer API format.
// - COMBO: options in inputDef[1].options (string array)
// - COMFY_DYNAMICCOMBO_V3: options in inputDef[1].options (array of {key, inputs} objects)
// - EASY_COMBO: options in inputDef[1].options (array of {label, value} objects)
// COMFY_AUTOGROW_V3 and COMFY_MATCHTYPE_V3 are socket-only, NOT widget combos.
const V3_COMBO_TYPES = new Set(['COMBO', 'COMFY_DYNAMICCOMBO_V3', 'EASY_COMBO']);

export function isV3ComboType(typeOrOptions: string | unknown[]): boolean {
  if (Array.isArray(typeOrOptions)) return false;
  return V3_COMBO_TYPES.has(String(typeOrOptions).toUpperCase());
}

export function isComboType(typeOrOptions: string | unknown[]): boolean {
  return Array.isArray(typeOrOptions) || isV3ComboType(typeOrOptions);
}

/** ComfyUI uses both spellings across legacy and V3 custom widgets. */
export function isMultiSelectCombo(
  inputOptions?: Record<string, unknown>,
): boolean {
  return Boolean(inputOptions?.multiselect) || Boolean(inputOptions?.multi_select);
}

export function getComboOptions(
  typeOrOptions: string | unknown[],
  inputOptions?: Record<string, unknown>
): unknown[] {
  if (Array.isArray(typeOrOptions)) {
    return typeOrOptions;
  }
  const typeName = String(typeOrOptions).toUpperCase();
  const rawOptions = inputOptions?.options;
  if (!Array.isArray(rawOptions)) return [];
  if (typeName === 'EASY_COMBO') {
    return rawOptions.map((opt: unknown) =>
      typeof opt === 'object' && opt !== null && 'value' in opt
        ? (opt as Record<string, unknown>).value
        : opt
    );
  }
  if (typeName === 'COMFY_DYNAMICCOMBO_V3') {
    return rawOptions.map((opt: unknown) =>
      typeof opt === 'object' && opt !== null && 'key' in opt
        ? (opt as Record<string, unknown>).key
        : opt
    );
  }
  // COMBO or unknown string-typed combo: options are plain strings
  return rawOptions;
}

export interface DynamicComboSubInput {
  name: string;           // unprefixed name (for widget lookups)
  qualifiedName: string;  // prefixed name (for API prompt submission)
  inputDef: [string | unknown[], Record<string, unknown>?];
}

export function getDynamicComboSubInputs(
  typeOrOptions: string | unknown[],
  inputOptions: Record<string, unknown> | undefined,
  selectedValue: unknown,
  parentName?: string,
): DynamicComboSubInput[] {
  if (!isV3ComboType(typeOrOptions) || String(typeOrOptions).toUpperCase() !== 'COMFY_DYNAMICCOMBO_V3') {
    return [];
  }
  const rawOptions = inputOptions?.options;
  if (!Array.isArray(rawOptions)) return [];
  const selectedKey = String(selectedValue);
  const option = rawOptions.find(
    (opt: unknown) =>
      typeof opt === 'object' && opt !== null && 'key' in opt &&
      String((opt as Record<string, unknown>).key) === selectedKey
  ) as Record<string, unknown> | undefined;
  if (!option) return [];
  const subInputs = option.inputs as Record<string, Record<string, [string | unknown[], Record<string, unknown>?]>> | undefined;
  if (!subInputs) return [];
  const prefix = parentName ? `${parentName}.` : '';
  const result: DynamicComboSubInput[] = [];
  for (const section of ['required', 'optional']) {
    const sectionInputs = subInputs[section];
    if (!sectionInputs) continue;
    for (const [name, inputDef] of Object.entries(sectionInputs)) {
      result.push({ name, qualifiedName: `${prefix}${name}`, inputDef });
    }
  }
  return result;
}

/**
 * Schema-level widget classification. Custom widget types such as COLOR are
 * identified by a concrete declared default even when their type name is not a
 * built-in widget type. A null default alone is not sufficient evidence: real
 * connection-only inputs commonly publish `default: null`.
 */
export function isWidgetBackedInput(
  typeOrOptions: string | unknown[],
  inputOptions?: Record<string, unknown>
): boolean {
  if (inputOptions?.forceInput === true || inputOptions?.defaultInput === true) return false;
  if (inputOptions?.socketless === true) return true;
  if (typeof inputOptions?.widgetType === 'string' && inputOptions.widgetType) return true;
  if (isComboType(typeOrOptions) || isWidgetInputType(typeOrOptions)) return true;
  return Object.prototype.hasOwnProperty.call(inputOptions ?? {}, 'default') &&
    inputOptions?.default !== null;
}

/**
 * True when an input accepts a link. Current V3 widgets can have a coexisting
 * input socket unless they declare `socketless`; legacy array combos remain
 * widget-only. `forceInput` suppresses only the widget, never the socket.
 */
export function isConnectionSocketInput(
  typeOrOptions: string | unknown[],
  inputOptions?: Record<string, unknown>,
): boolean {
  if (inputOptions?.forceInput === true || inputOptions?.defaultInput === true) return true;
  // Legacy array combos are widget-only. Serializing their entire option list
  // as a comma-joined socket type bloats workflows and cannot participate in
  // meaningful connection compatibility checks.
  if (Array.isArray(typeOrOptions)) return false;
  const widgetBacked = isWidgetBackedInput(typeOrOptions, inputOptions);
  if (widgetBacked) return inputOptions?.socketless !== true;
  return true;
}

/** The value a freshly created widget should start at. */
export function getDefaultWidgetValue(
  typeOrOptions: string | unknown[],
  inputOptions?: Record<string, unknown>
): unknown {
  const declared = inputOptions?.default;
  if (isComboType(typeOrOptions)) {
    const comboOptions = getComboOptions(typeOrOptions, inputOptions);
    if (isMultiSelectCombo(inputOptions)) {
      if (declared !== undefined) {
        return normalizeComboValue(declared, comboOptions, true);
      }
      return [];
    }
    if (declared !== undefined) {
      // Custom nodes occasionally publish a default that is display-equivalent
      // to an option but differs by an invisible Unicode variation selector.
      // Start the widget with the actual option value so the UI, slot walker,
      // and prompt serializer agree from the moment the node is created.
      return normalizeComboValue(declared, comboOptions);
    }
    return comboOptions[0] ?? '';
  }
  switch (String(typeOrOptions).toUpperCase()) {
    case 'INT': return declared ?? 0;
    case 'FLOAT': return declared ?? 0.0;
    case 'STRING': return declared ?? '';
    case 'BOOLEAN': return declared ?? false;
    default: return declared;
  }
}

/**
 * The widgets_values a freshly created node of this type should start with, in
 * slot order. Mirrors the slot layout that widgetDefinitions/seedUtils expect —
 * notably a COMFY_DYNAMICCOMBO_V3 is followed immediately by the sub-inputs of
 * its default option, so a new node is not born misaligned.
 */
export function buildDefaultWidgetValues(
  typeDef: {
    input?: {
      required?: Record<string, [string | unknown[], Record<string, unknown>?]>;
      optional?: Record<string, [string | unknown[], Record<string, unknown>?]>;
    };
    input_order?: { required?: string[]; optional?: string[] };
  },
  options?: { emitSeedControl?: boolean }
): unknown[] {
  // Desktop adds the control_after_generate widget when the schema flag is set
  // OR — when the flag is absent — for any INT named seed/noise_seed, so only
  // an explicit `control_after_generate: false` omits the slot. Node packs that
  // strip the widget on the JS side instead are suppressed via the caller's
  // emitSeedControl option.
  const emitSeedControl = options?.emitSeedControl ?? true;
  const required = typeDef.input?.required ?? {};
  const optional = typeDef.input?.optional ?? {};
  const order = [
    ...(typeDef.input_order?.required ?? Object.keys(required)),
    ...(typeDef.input_order?.optional ?? Object.keys(optional)),
  ];
  const values: unknown[] = [];

  const emit = (inputDef: [string | unknown[], Record<string, unknown>?], name: string) => {
    const [typeOrOptions, inputOptions] = inputDef;
    if (!isWidgetBackedInput(typeOrOptions, inputOptions)) return;
    const value = getDefaultWidgetValue(typeOrOptions, inputOptions);
    values.push(value);
    const seedControl = inputOptions?.control_after_generate;
    if (
      emitSeedControl &&
      String(typeOrOptions).toUpperCase() === 'INT' &&
      (name === 'seed' || name === 'noise_seed') &&
      seedControl !== false
    ) {
      values.push(
        typeof seedControl === 'string' && seedControl.length > 0
          ? seedControl
          : 'randomize',
      );
    }
    if (String(typeOrOptions).toUpperCase() === 'COMFY_DYNAMICCOMBO_V3') {
      for (const sub of getDynamicComboSubInputs(typeOrOptions, inputOptions, value, name)) {
        emit(sub.inputDef, sub.name);
      }
    }
  };

  for (const name of order) {
    const inputDef = required[name] ?? optional[name];
    if (inputDef) emit(inputDef, name);
  }
  return values;
}

export interface ConnectionInputDefinition {
  name: string;
  type: string;
  widget?: { name: string };
}

function collectDefaultConnectionInputs(
  qualifiedName: string,
  inputDef: [string | unknown[], Record<string, unknown>?],
  result: ConnectionInputDefinition[],
  selectedOverride?: unknown,
): void {
  const [typeOrOptions, inputOptions] = inputDef;
  const widgetBacked = isWidgetBackedInput(typeOrOptions, inputOptions);
  if (isConnectionSocketInput(typeOrOptions, inputOptions)) {
    result.push({
      name: qualifiedName,
      type: String(typeOrOptions),
      ...(widgetBacked ? { widget: { name: qualifiedName } } : {}),
    });
  }
  if (String(typeOrOptions).toUpperCase() !== 'COMFY_DYNAMICCOMBO_V3') return;
  const selected = selectedOverride ?? getDefaultWidgetValue(typeOrOptions, inputOptions);
  for (const sub of getDynamicComboSubInputs(
    typeOrOptions,
    inputOptions,
    selected,
    qualifiedName,
  )) {
    collectDefaultConnectionInputs(
      sub.qualifiedName,
      sub.inputDef,
      result,
    );
  }
}

/** Connection sockets a freshly-created node needs, including active dynamic children. */
export function buildDefaultConnectionInputs(
  typeDef: NodeTypeDefinition,
): ConnectionInputDefinition[] {
  const required = typeDef.input?.required ?? {};
  const optional = typeDef.input?.optional ?? {};
  const order = [
    ...(typeDef.input_order?.required ?? Object.keys(required)),
    ...(typeDef.input_order?.optional ?? Object.keys(optional)),
  ];
  const result: ConnectionInputDefinition[] = [];
  for (const name of order) {
    const inputDef = required[name] ?? optional[name];
    if (inputDef) collectDefaultConnectionInputs(name, inputDef, result);
  }
  return result;
}

/** Sockets contributed by one DynamicCombo selection, fully qualified. */
export function getDynamicComboConnectionInputs(
  inputName: string,
  inputDef: [string | unknown[], Record<string, unknown>?],
  selectedValue: unknown,
): ConnectionInputDefinition[] {
  const [typeOrOptions, inputOptions] = inputDef;
  const result: ConnectionInputDefinition[] = [];
  for (const sub of getDynamicComboSubInputs(
    typeOrOptions,
    inputOptions,
    selectedValue,
    inputName,
  )) {
    collectDefaultConnectionInputs(
      sub.qualifiedName,
      sub.inputDef,
      result,
    );
  }
  return result;
}

/**
 * The canonical test for "does this input occupy a widgets_values slot on THIS
 * node". Every walk over a node's widget slots must use it, or the walks drift
 * and a write lands on a different widget than the one on screen.
 */
export function occupiesWidgetSlot(
  node: WorkflowNode,
  name: string,
  typeOrOptions: string | unknown[],
  inputOptions?: Record<string, unknown>
): boolean {
  const inputEntry = node.inputs.find((i) => i.name === name);
  if (inputOptions?.forceInput === true || inputOptions?.defaultInput === true) return false;
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
  const order = [
    ...(typeDef.input_order?.required ?? Object.keys(required)),
    ...(typeDef.input_order?.optional ?? Object.keys(optional)),
  ];
  const propertyMap = getNodePropertyWidgetIndexMap(node);
  const definitions: ActiveNodeInputDefinition[] = [];
  let cursor = 0;

  const process = (
    name: string,
    qualifiedName: string,
    inputDef: [string | unknown[], Record<string, unknown>?],
  ) => {
    const [typeOrOptions, inputOptions] = inputDef;
    const inputIndex = node.inputs.findIndex((entry) => entry.name === qualifiedName);
    const inputEntry = inputIndex >= 0 ? node.inputs[inputIndex] : undefined;
    const hasWidgetSlot = occupiesWidgetSlot(node, qualifiedName, typeOrOptions, inputOptions);
    const mappedIndex = widgetIndexMap?.[qualifiedName]
      ?? propertyMap?.[qualifiedName]
      ?? (qualifiedName === name ? widgetIndexMap?.[name] ?? propertyMap?.[name] : undefined);
    const widgetIndex = hasWidgetSlot ? mappedIndex ?? cursor : null;
    const value = widgetIndex === null
      ? undefined
      : getWidgetValue(node, qualifiedName, widgetIndex);

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
    if (
      String(typeOrOptions).toUpperCase() === 'INT' &&
      (name === 'seed' || name === 'noise_seed') &&
      skipImplicitSeedControlSlot(node, ownWidgetIndex + 1)
    ) {
      cursor = Math.max(cursor, ownWidgetIndex + 2);
    }
    if (String(typeOrOptions).toUpperCase() !== 'COMFY_DYNAMICCOMBO_V3') return;

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
    if (String(subType).toUpperCase() === 'COMFY_DYNAMICCOMBO_V3') {
      // Nested DynamicCombo (e.g. SaveVideo.codec/h264/encoding): its own
      // sub-inputs sit inline, so recurse using the value actually stored.
      const selected = getWidgetValue(node, sub.qualifiedName, ownIndex);
      index = advancePastSubInputs(
        node,
        getDynamicComboSubInputs(subType, subOpts, selected, sub.qualifiedName),
        index
      );
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
  if (String(typeOrOptions).toUpperCase() !== 'COMFY_DYNAMICCOMBO_V3') return null;
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
  const activeOrder = getActiveNodeInputDefinitions(typeDef, provisionalNode)
    .map((definition) => definition.qualifiedName);
  const orderByName = new Map(activeOrder.map((name, index) => [name, index]));
  const originalOrder = new Map(node.inputs.map((input, index) => [input.name, index]));
  const inputs = [...provisionalInputs].sort((left, right) => {
    const leftOrder = orderByName.get(left.name);
    const rightOrder = orderByName.get(right.name);
    if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder;
    if (leftOrder !== undefined) return -1;
    if (rightOrder !== undefined) return 1;
    return (originalOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
      (originalOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER);
  });

  return {
    node: { ...provisionalNode, inputs },
    removedLinkIds,
  };
}

export function normalizeWidgetValue(
  value: unknown,
  typeOrOptions: string | unknown[],
  options?: { comboIndexToValue?: boolean }
): unknown {
  if (Array.isArray(typeOrOptions)) {
    if (options?.comboIndexToValue && typeof value === 'number' && Number.isFinite(value)) {
      const idx = Math.trunc(value);
      return typeOrOptions[idx] ?? value;
    }
    return value;
  }

  if (typeOrOptions === 'INT') {
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Math.trunc(Number(value));
    }
  }

  if (typeOrOptions === 'FLOAT') {
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }

  if (typeOrOptions === 'BOOLEAN' && typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }

  return value;
}

export function normalizeComboValue(
  value: unknown,
  options: unknown[],
  multiSelect = false,
): unknown {
  if (multiSelect) {
    const values = Array.isArray(value)
      ? value
      : value === undefined || value === null
        ? []
        : [value];
    return values.map((entry) => normalizeComboValue(entry, options, false));
  }
  if (options.length === 0) return value;
  const resolved = resolveComboOption(value, options);
  if (resolved !== undefined) {
    return resolved;
  }
  // No exact/basename/extensionless match. How we recover depends on whether the
  // combo is a file picker or a closed enum:
  //
  // - File pickers (loras, checkpoints, images, …) have an inherently incomplete
  //   option list — uploads and newly-added files never appear in object_info —
  //   so an unmatched value may still be valid. Keep it as-is and let the server
  //   decide, rather than swapping in a different (wrong) file.
  //
  // - Closed enums (action widgets like "Select to add Wildcard", sampler /
  //   scheduler names, …) enumerate EVERY valid value, so an unmatched value is
  //   stale — e.g. a dynamic combo whose placeholder option was captured into
  //   widgets_values at save time. ComfyUI does not error on an out-of-range
  //   combo value; it silently EXCLUDES that node (and its whole downstream
  //   branch) from the run, completing with "success" and no output. To keep the
  //   prompt executable we fall back to the first option (ComfyUI's default).
  //
  // Only substitute when NEITHER the option list nor the stale value looks
  // file-like. A picker whose options happen to lack a recognizable extension
  // (e.g. a custom node listing bare names) would otherwise be misread as an
  // enum and a genuine file selection clobbered; keeping a file-like value as-is
  // lets the server resolve or clearly reject it instead.
  if (!optionsAreFileLike(options) && !isFileLikeToken(value)) {
    return options[0];
  }
  return value;
}

// A combo is treated as a file picker when any of its options carries a path
// separator or a known model/media/config file extension. Such lists are
// inherently incomplete (uploads aren't enumerated), so unmatched values are
// kept as-is. Everything else is a closed enum that lists all valid values.
const FILE_LIKE_OPTION =
  /[\\/]|\.(safetensors|sft|ckpt|pt|pth|bin|gguf|onnx|vae|yaml|yml|json|txt|csv|png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|wav|mp3|flac|ogg|npy|npz|pkl|engine|trt)$/i;

export function isFileLikeToken(token: unknown): boolean {
  return FILE_LIKE_OPTION.test(String(token));
}

export function optionsAreFileLike(options: unknown[]): boolean {
  return options.some(isFileLikeToken);
}

const SAFETENSORS_SUFFIX = '.safetensors';

function stripSafetensorsSuffix(value: string): string {
  const lower = value.toLowerCase();
  if (lower.endsWith(SAFETENSORS_SUFFIX)) {
    return value.slice(0, value.length - SAFETENSORS_SUFFIX.length);
  }
  return value;
}

function getComboBase(value: string): string {
  return value.split(/[\\/]/).pop() ?? value;
}

export function resolveComboOption(
  value: unknown,
  options: unknown[]
): unknown | undefined {
  if (!Array.isArray(options) || options.length === 0) return undefined;

  // Numeric combo values are ambiguous: legacy workflows may store an option
  // index, while V3 COMBO schemas may use numbers as the option values. Prefer
  // a real value match and only interpret the number as an index when no option
  // has that value (HitPawGeneralImageEnhance.upscale_factor is [1, 2, 4]).
  const valueMatch = options.find((opt) => Object.is(opt, value) || String(opt) === String(value));
  if (valueMatch !== undefined) {
    return valueMatch;
  }

  const normalized = normalizeWidgetValue(value, options, { comboIndexToValue: true });
  const normalizedString = String(normalized);
  const normalizedBase = getComboBase(normalizedString);

  const directMatch = options.find((opt) => String(opt) === normalizedString);
  if (directMatch !== undefined) {
    return directMatch;
  }

  // U+FE0E/U+FE0F alter emoji presentation without changing the label's
  // meaning. Some custom-node schemas include one in `default` but omit it
  // from the corresponding option. Resolve to the server-advertised option.
  const displayString = normalizedString.replace(/[\uFE0E\uFE0F]/g, '');
  const displayMatch = options.find(
    (opt) => String(opt).replace(/[\uFE0E\uFE0F]/g, '') === displayString,
  );
  if (displayMatch !== undefined) {
    return displayMatch;
  }

  const baseMatch = options.find((opt) => String(opt) === normalizedBase);
  if (baseMatch !== undefined) {
    return baseMatch;
  }

  const normalizedNoExt = stripSafetensorsSuffix(normalizedBase);
  const normalizedNoExtLower = normalizedNoExt.toLowerCase();
  const extensionlessMatch = options.find((opt) => {
    const optString = String(opt);
    const optBase = getComboBase(optString);
    const optNoExt = stripSafetensorsSuffix(optBase);
    return optNoExt.toLowerCase() === normalizedNoExtLower;
  });

  return extensionlessMatch;
}

export function isValueCompatible(value: unknown, typeOrOptions: string | unknown[]): boolean {
  if (Array.isArray(typeOrOptions)) {
    const asString = String(value);
    return typeOrOptions.some((opt) => String(opt) === asString);
  }

  if (typeOrOptions === 'INT' || typeOrOptions === 'FLOAT') {
    if (typeof value === 'number' && Number.isFinite(value)) return true;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return true;
    return false;
  }

  if (typeOrOptions === 'BOOLEAN') {
    return typeof value === 'boolean' ||
      (typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase()));
  }

  if (typeOrOptions === 'STRING') {
    return typeof value === 'string';
  }

  return true;
}

export function resolveSource(
  workflow: Workflow,
  linkId: number,
  visitedLinkIds: Set<number> = new Set(),
  promptKeyMap?: Map<number, string>
): { nodeId: number; slotIndex: number } | null {
  if (visitedLinkIds.has(linkId)) return null;
  visitedLinkIds.add(linkId);

  const link = workflow.links.find((l) => l[0] === linkId);
  if (!link) return null;

  const sourceNodeId = link[1];
  const sourceSlotIndex = link[2];
  const sourceNode = workflow.nodes.find((n) => n.id === sourceNodeId);

  if (!sourceNode) return null;

  if (sourceNode.type === 'GetNode') {
    const getterName = getKJSetGetNodeName(sourceNode);
    if (!getterName) return null;

    const setterNode = findKJSetterNode(workflow, sourceNode, getterName, promptKeyMap);
    const setterInputLink = setterNode?.inputs?.[0]?.link;
    if (setterInputLink == null) return null;

    return resolveSource(workflow, setterInputLink, visitedLinkIds, promptKeyMap);
  }

  if (sourceNode.type === 'SetNode') {
    const setterInputLink = sourceNode.inputs?.[0]?.link;
    if (setterInputLink == null) return null;

    return resolveSource(workflow, setterInputLink, visitedLinkIds, promptKeyMap);
  }

  if (sourceNode.mode === 4 || sourceNode.type === 'Reroute') {
    const outputDef = sourceNode.outputs[sourceSlotIndex];
    if (!outputDef) return null;

    const matchingInput = sourceNode.inputs.find((input) => {
      if (input.link === null) return false;
      const inType = String(input.type).toUpperCase();
      const outType = String(outputDef.type).toUpperCase();
      return inType === outType || inType === '*' || outType === '*';
    });

    if (matchingInput?.link != null) {
      return resolveSource(workflow, matchingInput.link, visitedLinkIds, promptKeyMap);
    }
    return null;
  }

  return { nodeId: sourceNodeId, slotIndex: sourceSlotIndex };
}

function getKJSetGetNodeName(node: WorkflowNode): string | null {
  const values = node.widgets_values;
  if (Array.isArray(values)) {
    const value = values[0];
    return typeof value === 'string' && value ? value : null;
  }
  if (isRecord(values)) {
    const value = values[0] ?? values.value ?? values.name;
    return typeof value === 'string' && value ? value : null;
  }
  return null;
}

function getPromptScope(promptKey: string | undefined): string | null {
  if (!promptKey) return null;
  const scopeEnd = promptKey.lastIndexOf(':');
  return scopeEnd === -1 ? '' : promptKey.slice(0, scopeEnd);
}

function findKJSetterNode(
  workflow: Workflow,
  getterNode: WorkflowNode,
  getterName: string,
  promptKeyMap?: Map<number, string>
): WorkflowNode | undefined {
  const candidates = workflow.nodes.filter(
    (node) => node.type === 'SetNode' && getKJSetGetNodeName(node) === getterName
  );

  const getterScope = getPromptScope(promptKeyMap?.get(getterNode.id));
  if (getterScope === null) return candidates[0];

  return candidates.find(
    (node) => getPromptScope(promptKeyMap?.get(node.id)) === getterScope
  );
}

export function buildWorkflowPromptInputs(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  node: WorkflowNode,
  classType: string,
  allowedNodeIds: Set<number>,
  widgetIndexMap: Record<string, number> | null,
  seedOverrides?: Record<number, number>,
  promptKeyMap?: Map<number, string>,
  ueLinks?: UeLinkMap
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};

  for (const [slotIndex, input] of node.inputs.entries()) {
    // An input with no link may still be fed by a Use Everywhere broadcast. UE
    // is resolved rather than drawn, so the source has to be looked up instead
    // of followed — see `useEverywhere.ts`.
    if (input.link == null) {
      const broadcast = ueLinks?.get(ueSlotKey(node.id, slotIndex));
      if (!broadcast) continue;
      if (!allowedNodeIds.has(broadcast.originId)) continue;
      const nodeKey = promptKeyMap?.get(broadcast.originId) ?? String(broadcast.originId);
      inputs[input.name] = [nodeKey, broadcast.originSlot];
      continue;
    }
    const resolved = resolveSource(workflow, input.link, new Set(), promptKeyMap);
    if (!resolved) continue;
    if (allowedNodeIds.has(resolved.nodeId)) {
      const nodeKey = promptKeyMap?.get(resolved.nodeId) ?? String(resolved.nodeId);
      inputs[input.name] = [nodeKey, resolved.slotIndex];
      continue;
    }
    const sourceNode = workflow.nodes.find((n) => n.id === resolved.nodeId);
    if (!sourceNode) continue;
    const value = getPrimitiveInlineValue(sourceNode);
    if (value !== undefined) {
      inputs[input.name] = value;
    } else {
      console.warn(
        `[workflowInputs] Missing source node for input '${input.name}' on node ${node.id} (${node.type}).`,
        {
          sourceNodeId: resolved.nodeId,
          sourceNodeType: sourceNode.type,
          sourceAllowed: false
        }
      );
    }
  }

  const typeDef = nodeTypes[classType];
  if (!typeDef?.input) {
    return inputs;
  }

  const widgetValuesArray = Array.isArray(node.widgets_values) ? node.widgets_values : null;

  const activeInputDefinitions = getActiveNodeInputDefinitions(typeDef, node, widgetIndexMap);
  for (const definition of activeInputDefinitions) {
    const { name, qualifiedName, inputDef, widgetIndex, connected, value } = definition;
    try {
      const [typeOrOptions, inputOptions] = inputDef;
      if (widgetIndex === null || connected || qualifiedName in inputs) continue;

      // Apply the seed override for either conventional seed name. Dynamic seed
      // children submit under their qualified key just like every other child.
      if (
        (name === 'seed' || name === 'noise_seed') &&
        seedOverrides?.[node.id] !== undefined
      ) {
        inputs[qualifiedName] = seedOverrides[node.id];
        continue;
      }

      let promptValue = value;
      if (
        promptValue === undefined &&
        Object.prototype.hasOwnProperty.call(inputOptions ?? {}, 'default')
      ) {
        promptValue = inputOptions?.default;
      }
      if (promptValue === undefined) continue;

      if (isComboType(typeOrOptions)) {
        promptValue = normalizeComboValue(
          promptValue,
          getComboOptions(typeOrOptions, inputOptions),
          isMultiSelectCombo(inputOptions),
        );
      } else {
        promptValue = normalizeWidgetValue(promptValue, typeOrOptions);
      }
      inputs[qualifiedName] = finalizeInputValue(workflow, qualifiedName, promptValue);
    } catch (e) {
      console.error(`Error processing input '${qualifiedName}' for node ${node.id} (${node.type}):`, e);
    }
  }

  // Include any widgets defined in widgetIndexMap that weren't captured by the type definition
  // This is important for nodes with dynamic widgets (like rgthree's) or when the object_info
  // is slightly out of sync with the workflow.
  if (widgetIndexMap) {
    for (const [name, index] of Object.entries(widgetIndexMap)) {
      if (!(name in inputs) && widgetValuesArray && index < widgetValuesArray.length) {
        const value = widgetValuesArray[index];
        if (value !== undefined && value !== null) {
          inputs[name] = finalizeInputValue(workflow, name, value);
        }
      }
      if (!(name in inputs) && !widgetValuesArray) {
        const value = getWidgetValue(node, name, index);
        if (value !== undefined && value !== null) {
          inputs[name] = finalizeInputValue(workflow, name, value);
        }
      }
    }
  }

  // Special handling for Power Lora Loader (rgthree) which has dynamic widgets not in object_info.
  // We ensure all widgets that look like Lora objects are included in the prompt inputs.
  if (isPowerLoraLoaderNodeType(classType) || isPowerLoraLoaderNodeType(node.type)) {
    if (widgetValuesArray) {
      widgetValuesArray.forEach((val, idx) => {
        if (typeof val === 'object' && val !== null && 'lora' in val) {
          // Check if this index was already added under any name
          const alreadyAdded = Object.values(widgetIndexMap || {}).some(index => index === idx) ||
            (widgetIndexMap === null && activeInputDefinitions.some(
              (definition) => definition.widgetIndex === idx,
            ));
          
          if (!alreadyAdded) {
            const name = `lora_${idx}`;
            if (!(name in inputs)) {
              // For rgthree nodes, if strengthTwo is missing but expected, we might want to provide it,
              // but the node's serializeValue handles it by deleting it if not in separate mode.
              // Our widget value already contains what it needs.
              inputs[name] = val;
            }
          }
        }
      });
    }
  }

  const hasSeedInput = Object.keys(inputs).some(
    (name) => name === 'seed' || name === 'noise_seed' ||
      name.endsWith('.seed') || name.endsWith('.noise_seed'),
  );
  if (seedOverrides?.[node.id] !== undefined && !hasSeedInput) {
    inputs.seed = seedOverrides[node.id];
  }

  appendLoraManagerInputs(node, inputs, widgetValuesArray, widgetIndexMap);
  appendTriggerWordToggleInputs(node, inputs, widgetValuesArray, widgetIndexMap);

  return inputs;
}

function appendLoraManagerInputs(
  node: WorkflowNode,
  inputs: Record<string, unknown>,
  widgetValuesArray: unknown[] | null,
  widgetIndexMap: Record<string, number> | null
) {
  if ('loras' in inputs) return;

  const mappedIndex = widgetIndexMap?.loras;
  const listIndex = mappedIndex !== undefined ? mappedIndex : findLoraListIndex(node);
  if (listIndex === null) return;

  const rawValue = widgetValuesArray?.[listIndex];
  const loraList = extractLoraList(rawValue);
  if (loraList) {
    inputs.loras = loraList;
  }
}

function appendTriggerWordToggleInputs(
  node: WorkflowNode,
  inputs: Record<string, unknown>,
  widgetValuesArray: unknown[] | null,
  widgetIndexMap: Record<string, number> | null
) {
  if (!isTriggerWordToggleNodeType(node.type)) return;

  const mappedListIndex = widgetIndexMap?.toggle_trigger_words;
  const listIndex = mappedListIndex !== undefined
    ? mappedListIndex
    : findTriggerWordListIndex(node);
  if (listIndex === null) return;

  if (!('toggle_trigger_words' in inputs)) {
    const rawValue = widgetValuesArray?.[listIndex];
    const triggerList = extractTriggerWordList(rawValue) ?? extractTriggerWordListLoose(rawValue);
    if (triggerList) {
      inputs.toggle_trigger_words = triggerList;
    }
  }

  const mappedMessageIndex = widgetIndexMap?.originalMessage ?? widgetIndexMap?.orinalMessage;
  const messageIndex = mappedMessageIndex !== undefined
    ? mappedMessageIndex
    : findTriggerWordMessageIndex(node, listIndex);
  if (messageIndex === null) return;

  const messageValue = widgetValuesArray?.[messageIndex];
  const message = extractTriggerWordMessage(messageValue);
  if (message === null) return;

  const messageKey = widgetIndexMap && 'originalMessage' in widgetIndexMap
    ? 'originalMessage'
    : (widgetIndexMap && 'orinalMessage' in widgetIndexMap
      ? 'orinalMessage'
      : 'orinalMessage');

  if (!(messageKey in inputs)) {
    inputs[messageKey] = message;
  }
}

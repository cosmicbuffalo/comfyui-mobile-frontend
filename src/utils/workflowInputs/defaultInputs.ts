import type { NodeTypeDefinition } from '@/api/types';
import { DYNAMIC_COMBO_V3, getComboOptions, getDynamicComboSubInputs, isComboType, isMultiSelectCombo, normalizeComboValue, orderedInputNames } from './comboValues';
import { isWidgetInputType } from './widgetSlots';

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
  const values: unknown[] = [];
  const order = orderedInputNames(typeDef);

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
    if (String(typeOrOptions).toUpperCase() === DYNAMIC_COMBO_V3) {
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
  if (String(typeOrOptions).toUpperCase() !== DYNAMIC_COMBO_V3) return;
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
  const order = orderedInputNames(typeDef);
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

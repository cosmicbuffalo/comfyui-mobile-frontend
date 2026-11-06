import { isWildcardSelectWidget, WILDCARD_SELECT_SENTINEL } from '@/utils/wildcardWidgets';

// ComfyUI's newer DynamicCombo widget type. Every slot/branch check in this
// package compares against this constant instead of re-spelling the literal.
export const DYNAMIC_COMBO_V3 = 'COMFY_DYNAMICCOMBO_V3';

const V3_COMBO_TYPES = new Set(['COMBO', DYNAMIC_COMBO_V3, 'EASY_COMBO']);

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

/**
 * The node's declared inputs in slot order (required then optional, using the
 * node's `input_order` when the pack declares one). Shared by every walk over
 * a type definition's inputs so the orderings cannot drift.
 */
export function orderedInputNames(
  typeDef: {
    input?: {
      required?: Record<string, unknown>;
      optional?: Record<string, unknown>;
    };
    input_order?: { required?: string[]; optional?: string[] };
  },
): string[] {
  const required = typeDef.input?.required ?? {};
  const optional = typeDef.input?.optional ?? {};
  return [
    ...(typeDef.input_order?.required ?? Object.keys(required)),
    ...(typeDef.input_order?.optional ?? Object.keys(optional)),
  ];
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
  if (typeName === DYNAMIC_COMBO_V3) {
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
  if (!isV3ComboType(typeOrOptions) || String(typeOrOptions).toUpperCase() !== DYNAMIC_COMBO_V3) {
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

export function normalizeWidgetValue(
  value: unknown,
  typeOrOptions: string | unknown[],
): unknown {
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

/**
 * The value a combo serializes into the prompt, as stock does: the matching
 * option, else the saved value unchanged, so a value the server doesn't offer
 * is rejected the same way on both frontends. Impact's wildcard picker always
 * sends its placeholder, whatever it last held, since the server lists no other
 * option for it.
 */
export function sentComboValue(value: unknown, options: unknown[], multiSelect = false): unknown {
  if (multiSelect) {
    const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    return values.map((entry) => sentComboValue(entry, options));
  }
  if (isWildcardSelectWidget(options)) return WILDCARD_SELECT_SENTINEL;
  if (options.length === 0) return value;
  return resolveComboOption(value, options) ?? value;
}

export function normalizeComboValue(
  value: unknown,
  options: unknown[],
  multiSelect = false,
  declaredDefault?: unknown,
): unknown {
  if (multiSelect) {
    const values = Array.isArray(value)
      ? value
      : value === undefined || value === null
        ? []
        : [value];
    return values.map((entry) => normalizeComboValue(entry, options, false, declaredDefault));
  }
  if (options.length === 0) return value;
  const resolved = resolveComboOption(value, options);
  if (resolved !== undefined) {
    return resolved;
  }
  // No exact/basename/extensionless match. This picks the value a NEW widget
  // starts with (a declared default that is not an option falls back to the
  // first option); the prompt uses sentComboValue, which keeps a saved value
  // the server doesn't offer so it is rejected as stock's is.
  //
  // Only substitute when NEITHER the option list nor the stale value looks
  // file-like. A picker whose options happen to lack a recognizable extension
  // (e.g. a custom node listing bare names) would otherwise be misread as an
  // enum and a genuine file selection clobbered; keeping a file-like value as-is
  // lets the server resolve or clearly reject it instead.
  if (!optionsAreFileLike(options) && !isFileLikeToken(value)) {
    return options.includes(declaredDefault) ? declaredDefault : options[0];
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

  const valueMatch = options.find((opt) => Object.is(opt, value));
  if (valueMatch !== undefined) {
    return valueMatch;
  }
  // Stock sends a combo's saved value as is, and the server checks it with
  // Python's `in`, which never equates a number with a string: 1 is not in
  // ['1', '2'], and '1' is not in [1, 2]. So only a string is matched loosely,
  // and only against string options. A number is never read as an option index
  // either, so a value a pack update shifted into the combo is rejected on both.
  if (typeof value !== 'string') return undefined;
  const textOptions = options.filter((opt): opt is string => typeof opt === 'string');

  const normalizedBase = getComboBase(value);

  // U+FE0E/U+FE0F alter emoji presentation without changing the label's
  // meaning. Some custom-node schemas include one in `default` but omit it
  // from the corresponding option. Resolve to the server-advertised option.
  const displayString = value.replace(/[\uFE0E\uFE0F]/g, '');
  const displayMatch = textOptions.find(
    (opt) => opt.replace(/[\uFE0E\uFE0F]/g, '') === displayString,
  );
  if (displayMatch !== undefined) {
    return displayMatch;
  }

  const baseMatch = textOptions.find((opt) => opt === normalizedBase);
  if (baseMatch !== undefined) {
    return baseMatch;
  }

  const normalizedNoExt = stripSafetensorsSuffix(normalizedBase);
  const normalizedNoExtLower = normalizedNoExt.toLowerCase();
  return textOptions.find((opt) => {
    const optNoExt = stripSafetensorsSuffix(getComboBase(opt));
    return optNoExt.toLowerCase() === normalizedNoExtLower;
  });
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

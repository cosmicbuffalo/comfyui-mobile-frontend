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

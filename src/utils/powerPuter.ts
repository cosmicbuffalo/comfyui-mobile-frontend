import type { WorkflowNode, WorkflowOutput } from '@/api/types';

/**
 * rgthree's "Power Puter" evaluates a Python-like expression on the backend and
 * emits one or more typed outputs.
 *
 * It needs porting here for the same reason the Power Lora Loader does: both of
 * its widgets are client-side only. The node declares
 * `optional: FlexibleOptionalInputType(any_type)` with no seed data, so
 * `object_info` reports an entirely empty input schema — nothing tells a second
 * frontend that `code` and `outputs` exist. Our prompt builder walks the schema,
 * finds no widgets, and ships a prompt whose Power Puter node carries only its
 * wired `a`/`b`/... inputs. The backend then does `kwargs['code']` and raises,
 * taking the run down (rgthree-comfy#758).
 *
 * So the widget names, their order, and the shape of the `outputs` value are all
 * assumptions about upstream's `src_web/comfyui/power_puter.ts`. They are
 * recorded in `scripts/node-parity/manifests.mjs` under the `rgthree-comfy`
 * pack so upstream drift is reported rather than silently mis-serialized.
 */

const POWER_PUTER_NODE_TYPE = 'Power Puter (rgthree)';

/** Widget name upstream gives the outputs chip widget (`addCustomWidget`). */
export const POWER_PUTER_OUTPUTS_WIDGET = 'outputs';
/** Widget name upstream gives the multiline expression widget (`ComfyWidgets.STRING`). */
export const POWER_PUTER_CODE_WIDGET = 'code';

/**
 * Output types upstream offers in its "Add an output" context menu, in the same
 * order. `*` is the wildcard, which passes the value through untyped.
 */
export const POWER_PUTER_OUTPUT_TYPES = ['STRING', 'INT', 'FLOAT', 'BOOLEAN', '*'] as const;

/** Upstream caps the chip widget at ten outputs (`outputs.length < 10`). */
export const POWER_PUTER_MAX_OUTPUTS = 10;

export function isPowerPuterNodeType(nodeType: string | undefined | null): boolean {
  if (!nodeType) return false;
  return nodeType.trim() === POWER_PUTER_NODE_TYPE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalize one output type entry.
 *
 * Upstream carries a compatibility fixup we have to reproduce: an early Power
 * Puter release wrote `"BOOL"` where it meant `"BOOLEAN"`, and its widget setter
 * rewrites that on load. Workflows saved in that window are still out there, and
 * `BOOL` is not a real ComfyUI type — passing it through would declare an output
 * nothing can connect to.
 */
function normalizeOutputType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed === 'BOOL' ? 'BOOLEAN' : trimmed;
}

/**
 * Read the outputs list out of a raw widget value.
 *
 * Three shapes exist in the wild, all of which upstream's `set value()` accepts:
 *   - `{ outputs: ["STRING", "INT"] }` — current.
 *   - `"STRING"` — the original widget was a plain string combo.
 *   - a bare array — defensive; not written by upstream but cheap to accept.
 */
export function parsePowerPuterOutputs(raw: unknown): string[] | null {
  if (typeof raw === 'string') {
    const single = normalizeOutputType(raw);
    return single ? [single] : null;
  }
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.outputs)
      ? raw.outputs
      : null;
  if (!list) return null;
  const normalized = list
    .map(normalizeOutputType)
    .filter((entry): entry is string => entry !== null);
  return normalized.length > 0 ? normalized : null;
}

/** The serialized form upstream's `serializeValue` returns, and the backend's `get_dict_value(kwargs, 'outputs.outputs')` reads. */
export function toPowerPuterOutputsValue(outputs: string[]): { outputs: string[] } {
  return { outputs: [...outputs] };
}

export interface PowerPuterWidgets {
  /** Index into `widgets_values` of the outputs chip widget, or null when absent. */
  outputsIndex: number | null;
  /** Index into `widgets_values` of the expression widget, or null when absent. */
  codeIndex: number | null;
  outputs: string[];
  code: string;
}

/**
 * Locate the Power Puter widgets inside a node's `widgets_values`.
 *
 * Upstream adds the outputs widget first and the code widget second, so the
 * saved array is `[{outputs:[...]}, "<code>"]`. We resolve by shape rather than
 * by fixed index because the legacy string-valued outputs widget makes position
 * alone ambiguous — with `["STRING", "a + b"]` both slots are strings — and
 * because a node saved before the outputs widget existed has only the code.
 */
export function readPowerPuterWidgets(node: WorkflowNode): PowerPuterWidgets {
  const values = node.widgets_values;

  if (isRecord(values)) {
    // Some tools re-serialize widgets_values as a name-keyed record.
    const outputs = parsePowerPuterOutputs(values[POWER_PUTER_OUTPUTS_WIDGET]) ?? ['STRING'];
    const rawCode = values[POWER_PUTER_CODE_WIDGET];
    return {
      outputsIndex: null,
      codeIndex: null,
      outputs,
      code: typeof rawCode === 'string' ? rawCode : '',
    };
  }

  if (!Array.isArray(values)) {
    return { outputsIndex: null, codeIndex: null, outputs: ['STRING'], code: '' };
  }

  let outputsIndex: number | null = null;
  let outputs: string[] | null = null;

  // Prefer an object/array-shaped entry: that is unambiguously the outputs
  // widget, whereas a string entry could be either widget.
  for (let i = 0; i < values.length; i++) {
    const parsed = parsePowerPuterOutputs(values[i]);
    if (parsed && typeof values[i] !== 'string') {
      outputsIndex = i;
      outputs = parsed;
      break;
    }
  }

  // Legacy string-valued outputs widget: it sits at slot 0, ahead of the code.
  if (outputs === null && values.length > 1) {
    const legacy = parsePowerPuterOutputs(values[0]);
    if (legacy && POWER_PUTER_OUTPUT_TYPES.includes(legacy[0] as (typeof POWER_PUTER_OUTPUT_TYPES)[number])) {
      outputsIndex = 0;
      outputs = legacy;
    }
  }

  // The code is the first string that is not the outputs slot. Falling back to
  // "last string" would pick up a stray trailing value; upstream only ever adds
  // these two widgets, so first-match is the closer read.
  let codeIndex: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i === outputsIndex) continue;
    if (typeof values[i] === 'string') {
      codeIndex = i;
      break;
    }
  }

  return {
    outputsIndex,
    codeIndex,
    outputs: outputs ?? ['STRING'],
    code: codeIndex === null ? '' : String(values[codeIndex] ?? ''),
  };
}

/**
 * Rebuild `node.outputs` so the declared slots match the outputs widget.
 *
 * This mirrors upstream's `setOutputs()`: slot `i` takes type `outputs[i]`, a
 * label that was only ever the mirrored type is re-mirrored rather than left
 * stale, and surplus slots are dropped. Link bookkeeping is the caller's job —
 * see `setPowerPuterOutputs` in the store, which also drops the links that a
 * removed slot was carrying.
 */
export function buildPowerPuterOutputSlots(
  existing: WorkflowOutput[],
  outputs: string[],
): WorkflowOutput[] {
  return outputs.map((type, index) => {
    const previous = existing[index];
    if (!previous) {
      return { name: type, type, links: null, slot_index: index };
    }
    // Upstream treats a label equal to the old type (or to "*") as auto-derived
    // and refreshes it; anything else is a user rename and is preserved.
    const isDerivedLabel =
      !previous.label || previous.label === '*' || previous.label === previous.type;
    const isDerivedName =
      !previous.name || previous.name === '*' || previous.name === previous.type;
    return {
      ...previous,
      type,
      name: isDerivedName ? type : previous.name,
      label: isDerivedLabel ? type : previous.label,
      slot_index: index,
    };
  });
}

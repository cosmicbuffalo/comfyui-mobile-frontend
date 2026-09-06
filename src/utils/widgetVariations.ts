import type { Workflow } from '@/api/types';
import { DYNAMIC_COMBO_V3, getComboOptions, isComboType, isMultiSelectCombo } from '@/utils/workflowInputs';

/**
 * Which widget a variation run varies, located the same way bulk-process
 * locates its LoadImage node: by id plus the scope that owns it (null = root,
 * otherwise the subgraph definition the node lives in). A node id alone is not
 * unique — a root node and an inner node routinely share one.
 */
export interface WidgetVariationTarget {
  nodeId: number;
  subgraphId: string | null;
  widgetIndex: number;
}

/** A target plus the chosen values, one enqueued run each. */
export interface WidgetVariationSpec extends WidgetVariationTarget {
  /** Display name of the varied widget, used to label each queued run. */
  widgetName: string;
  values: unknown[];
}

/**
 * The values a widget can be varied over, or [] if it can't be.
 *
 * Only plain combos qualify. A DynamicCombo is excluded because changing its
 * value RESTRUCTURES the node — `rebuildDynamicComboNode` adds and removes
 * input slots and rewires links — so writing a bare `widgets_values[i]` for it
 * would produce a prompt whose inputs no longer match its widgets. A
 * multi-select combo is excluded because its value is a list, not one option.
 */
export function variationOptionsFor(
  type: string,
  options: Record<string, unknown> | unknown[] | undefined,
): unknown[] {
  if (String(type).toUpperCase() === DYNAMIC_COMBO_V3) return [];
  const inputOptions = options && !Array.isArray(options) ? options : undefined;
  if (isMultiSelectCombo(inputOptions)) return [];
  const typeOrOptions = Array.isArray(options) ? options : type;
  if (!isComboType(typeOrOptions)) return [];
  // Duplicates would silently queue the same run twice; ComfyUI itself does not
  // guarantee a unique list (two model folders can hold the same filename).
  const seen = new Set<string>();
  return getComboOptions(typeOrOptions, inputOptions).filter((value) => {
    const key = formatVariationValue(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** How one option reads in the picker and in a queued run's label. */
export function formatVariationValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Clone `workflow` with the target widget set to `value` and everything else —
 * seeds included — left exactly as it is. Returns null when the node or its
 * widget list can't be resolved, so the caller can skip that run rather than
 * queue a workflow that silently kept the old value.
 */
export function applyWidgetVariation(
  workflow: Workflow,
  target: WidgetVariationTarget,
  value: unknown,
): Workflow | null {
  const clone = structuredClone(workflow);
  const node =
    target.subgraphId == null
      ? clone.nodes.find((n) => n.id === target.nodeId)
      : clone.definitions?.subgraphs
          ?.find((sg) => sg.id === target.subgraphId)
          ?.nodes.find((n) => n.id === target.nodeId);
  if (!node) return null;
  if (!Array.isArray(node.widgets_values)) return null;
  if (target.widgetIndex < 0 || target.widgetIndex >= node.widgets_values.length) return null;

  const values = [...node.widgets_values];
  values[target.widgetIndex] = value;
  node.widgets_values = values;
  return clone;
}

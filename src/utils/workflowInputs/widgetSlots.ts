import type { Workflow, WorkflowNode } from '@/api/types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getPrimitiveInlineValue(node: WorkflowNode): unknown {
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
    // Any array-typed input is a legacy combo/widget option list.
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

const COMPOSITE_WIDGET_TYPES = new Set([
  'LM_LORA_HEADER',
  'LM_LORA',
  'LM_LORA_ADD',
  'TW_WORD',
  'POWER_LORA_HEADER',
  'POWER_LORA',
  'POWER_LORA_ADD',
]);

/** Whether this descriptor renders one of the standard controls with `pt-2`.
 *
 * Describes the labelled form, which is the only one the node-card parameter
 * list renders (`hideLabel` is set solely by ConnectionButton). Every control
 * this returns true for must carry `pt-2` on its outermost labelled element,
 * or the `-mt-2` compensation on the parameters section overshoots.
 */
export function widgetControlHasTopPadding(
  type: string,
  options?: unknown,
): boolean {
  if (COMPOSITE_WIDGET_TYPES.has(type)) return false;
  const normalizedType = type.toUpperCase();
  const optionsRecord = options && typeof options === 'object' && !Array.isArray(options)
    ? options as Record<string, unknown>
    : undefined;
  return normalizedType === 'STRING'
    || normalizedType === 'INT'
    || normalizedType === 'FLOAT'
    || normalizedType === 'BOOLEAN'
    || type === 'COMBO'
    || Array.isArray(optionsRecord?.options);
}

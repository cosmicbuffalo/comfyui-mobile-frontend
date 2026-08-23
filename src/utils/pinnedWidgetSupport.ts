/** Whether WidgetControl can render this widget in the shared pinned editor. */
export function supportsPinnedWidgetEditor(type: string, options?: unknown): boolean {
  const normalizedType = type.toUpperCase();
  if (['STRING', 'INT', 'FLOAT', 'BOOLEAN', 'COMBO'].includes(normalizedType)) {
    return true;
  }
  if (Array.isArray(options)) return true;
  return Boolean(
    options
    && typeof options === 'object'
    && Array.isArray((options as { options?: unknown }).options),
  );
}

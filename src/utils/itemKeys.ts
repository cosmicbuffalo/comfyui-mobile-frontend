export function requireHierarchicalKey(
  itemKey: string | null | undefined,
  context: string,
): string {
  if (!itemKey) {
    throw new Error(
      `Missing hierarchical key for ${context}. Workflow must be annotated before render.`,
    );
  }
  return itemKey;
}

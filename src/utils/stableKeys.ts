export function requireStableKey(
  stableKey: string | null | undefined,
  context: string,
): string {
  if (!stableKey) {
    throw new Error(`Missing stable key for ${context}. Workflow must be canonicalized before render.`);
  }
  return stableKey;
}

// Client for the wildcard list published by ComfyUI-Impact-Pack.
//
// Nodes that let you insert a wildcard (Impact Pack's ImpactWildcardProcessor /
// ImpactWildcardEncode, Inspire Pack's WildcardEncode, Easy-Use's "easy
// wildcards", and the various *DetailerPipe nodes) declare that dropdown with a
// single placeholder option and fill the real list from the browser at run
// time. Desktop does it in Impact Pack's own JS extension, which we don't run,
// so the dropdown arrives empty. We read the same route it does.
//
// Impact Pack registers at the ComfyUI server root — the origin this app is
// served from. If it isn't installed the route 404s and the feature stays dark.

const BASE = '/impact/wildcards';

/**
 * Every wildcard name the server knows about, e.g. `__samples/flower__`.
 * Resolves to an empty list on any error (route absent → pack not installed).
 */
export async function getImpactWildcards(): Promise<string[]> {
  try {
    const response = await fetch(`${BASE}/list`);
    if (!response.ok) return [];
    const data = await response.json() as { data?: unknown };
    if (!Array.isArray(data.data)) return [];
    return data.data.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return [];
  }
}

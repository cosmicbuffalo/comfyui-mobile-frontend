/**
 * Detecting that the server's build has moved on from the one this tab runs.
 *
 * The app deliberately has no injected version stamp: stamping a build id at
 * build time would make every build differ and break CI's dist-reproducibility
 * check. The entry chunk's content-hashed filename already identifies a build,
 * and both sides of the comparison are free: the running build's entry chunk is
 * named by the module <script> tag in the document it booted from, and the
 * server's current one is named by the index.html it serves now.
 */
const ENTRY_CHUNK_PATTERN = /assets\/index-[\w-]+\.js/;

/**
 * The entry chunk this tab booted from, or null outside a production build
 * (dev server, tests) — null disables update checks entirely.
 */
export function runningEntryChunk(doc: Pick<Document, 'querySelectorAll'> = document): string | null {
  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const match = (script.getAttribute('src') ?? '').match(ENTRY_CHUNK_PATTERN);
    if (match) return match[0];
  }
  return null;
}

/**
 * The entry chunk the server's index.html names right now, or null when it
 * cannot be determined (offline, server down, an auth gate serving the sign-in
 * page instead). Null means "don't know", never "update available" — every
 * failure here must fail open or a flaky connection would nag about updates.
 */
export async function serverEntryChunk(): Promise<string | null> {
  try {
    const response = await fetch(import.meta.env.BASE_URL, { cache: 'no-store' });
    if (!response.ok) return null;
    const match = (await response.text()).match(ENTRY_CHUNK_PATTERN);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

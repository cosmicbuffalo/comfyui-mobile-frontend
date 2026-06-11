/**
 * Slash-delimited path-hierarchy helpers shared by the workflow favorites/hidden
 * stores and the workflow picker. Paths are relative (e.g. "foo.json" or
 * "sub/foo.json"); a folder is the prefix before a "/".
 */

/** True when `candidate` is `base` itself, or a path nested beneath it. */
export function isPathAtOrUnder(candidate: string, base: string): boolean {
  return candidate === base || candidate.startsWith(base + '/');
}

/**
 * Remap `path` when `from` (and everything under it) is renamed/moved to `to`.
 * Leaves unrelated paths untouched.
 */
export function remapRenamedPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (path.startsWith(from + '/')) return to + path.slice(from.length);
  return path;
}

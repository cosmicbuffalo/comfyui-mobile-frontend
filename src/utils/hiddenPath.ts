/** True when any slash- or backslash-delimited path segment is dot-hidden. */
export function hasDotHiddenPathSegment(path: string): boolean {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .some((segment) => segment.startsWith('.') && segment !== '.' && segment !== '..');
}

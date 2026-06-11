// Per-file cache-busting tokens for output images.
//
// ComfyUI reuses output filenames after a file is deleted (its save counter can
// wrap), so a new generation can produce a *different* image under a filename
// the browser already has cached — and the stale, just-deleted image shows up
// in its place until a hard refresh. When we delete an image we bump a token for
// its identity; getImageUrl appends that token so the next request for the same
// filename misses the HTTP cache and fetches the fresh bytes. Only deleted-then-
// reused filenames pay this cost; everything else caches normally.

const tokensByIdentity = new Map<string, number>();

function identityKey(filename: string, subfolder: string, type: string): string {
  return `${type}/${subfolder}/${filename}`;
}

/** Invalidate any cached copy of this image; the next load re-fetches it. */
export function bustImageCache(filename: string, subfolder: string, type: string): void {
  const key = identityKey(filename, subfolder, type);
  tokensByIdentity.set(key, (tokensByIdentity.get(key) ?? 0) + 1);
}

/** Current cache-bust token for an image, or undefined if it was never busted. */
export function getImageCacheToken(
  filename: string,
  subfolder: string,
  type: string,
): number | undefined {
  return tokensByIdentity.get(identityKey(filename, subfolder, type));
}

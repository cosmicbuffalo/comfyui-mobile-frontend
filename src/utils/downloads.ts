import { saveToPhotosInNativeApp } from '@/utils/nativeSave';

export async function downloadImage(
  src: string,
  filename: string = 'image.png',
  onDownloaded?: (src: string) => void,
) {
  // Inside the native iOS app: route through the savePhoto JS channel so the
  // file lands in Photos. The anchor click below would otherwise be treated as
  // a top-level navigation by WKWebView (the download attribute isn't honored
  // there), trapping the user on the bare image URL.
  const native = saveToPhotosInNativeApp(src, filename);
  if (native) {
    if (await native) onDownloaded?.(src);
    return;
  }
  try {
    const link = document.createElement('a');
    link.href = src;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    onDownloaded?.(src);
  } catch (err) {
    console.error('Failed to download image:', err);
  }
}

// Derive a download filename from a ComfyUI asset URL: the `filename` query
// param (how /view and the thumbnail/preview endpoints name files), else the
// last path segment. Falls back to 'image.png' only if neither is present.
export function filenameFromSrc(src: string): string {
  try {
    const url = new URL(src, window.location.origin);
    const fromQuery = url.searchParams.get('filename');
    if (fromQuery) return fromQuery.split('/').pop() || fromQuery;
    // data:/blob: URLs have no meaningful path segment — use the default name.
    if (url.protocol === 'data:' || url.protocol === 'blob:') return 'image.png';
    const last = url.pathname.split('/').pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // not a parseable URL — fall through to the default
  }
  return 'image.png';
}

export async function downloadBatch(
  sources: string[],
  onDownloaded?: (src: string) => void
) {
  for (const src of sources) {
    await downloadImage(src, filenameFromSrc(src), onDownloaded);
  }
}

interface ShareTarget {
  src: string;
  filename: string;
}

/**
 * Save a file to the user's device. Issues a synchronous anchor click
 * against the asset's own URL so the user-gesture activation survives the
 * call — critical on iOS Safari, where any `await` before the click
 * destroys the activation and the older fetch-then-share path silently
 * no-ops with no visible feedback (the bug we hit before this rewrite).
 *
 * Same-origin `/view` URLs honor the `download` attribute even when the
 * server's Content-Disposition is `inline`, so the file goes to Downloads
 * with the requested filename. On browsers that don't honor it, the asset
 * opens in a new tab — a usable manual-save fallback.
 *
 * The Web Share API is intentionally not used: passing a `File` requires a
 * pre-fetch, which always blows the activation window on iOS.
 *
 * In the native iOS app this anchor path is never reached — the save goes
 * through the `savePhoto` JS channel first and only falls through here on the
 * open web.
 */
/**
 * Per-call disposition of shareOrDownloadFile. The two routes report different
 * things on purpose, so the UI can only claim what the surface actually knows.
 *
 * `downloads` reports `started`, deliberately not `ok`: handing a URL to the
 * browser via an anchor click is fire-and-forget — `click()` does not throw
 * when the browser refuses or silently drops the download (iOS Safari does
 * exactly that on large files), so this layer genuinely cannot know whether a
 * file reached the disk. `started: false` covers the one case we can observe:
 * the click never happened.
 *
 * `photos` reports a real `ok`: the native app writes to PHPhotoLibrary itself
 * and calls back with the per-save result, so success there is observed rather
 * than assumed.
 */
export type DownloadOutcome =
  | { route: 'photos'; ok: boolean }
  | { route: 'downloads'; started: boolean };

export async function shareOrDownloadFile(
  src: string,
  filename: string,
): Promise<DownloadOutcome> {
  // Inside the native iOS app: route through the savePhoto JS channel — the
  // anchor click below is treated as a top-level navigation by WKWebView and
  // would trap the user on the bare image URL.
  const native = saveToPhotosInNativeApp(src, filename);
  if (native) return { route: 'photos', ok: await native };
  try {
    const link = document.createElement('a');
    link.href = src;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return { route: 'downloads', started: true };
  } catch (err) {
    console.error('Failed to save file:', err);
    return { route: 'downloads', started: false };
  }
}

/**
 * Save multiple files. Same sync-anchor approach as shareOrDownloadFile
 * — each item gets its own click within the user-gesture window. Browsers
 * may rate-limit very large batches, but for typical N-of-a-few outputs
 * this is reliable on both desktop and iOS Safari, where the older
 * fetch-then-share path no-ops silently.
 */
export async function shareOrDownloadBatch(
  targets: ShareTarget[],
  onCompleted?: (src: string) => void,
): Promise<void> {
  if (targets.length === 0) return;
  try {
    for (const target of targets) {
      // Inside the native iOS app: route through the savePhoto JS channel — the
      // anchor click below would otherwise navigate the WebView away from the
      // mobile frontend on the first iteration.
      const native = saveToPhotosInNativeApp(target.src, target.filename);
      if (native) {
        if (await native) onCompleted?.(target.src);
        continue;
      }
      const link = document.createElement('a');
      link.href = target.src;
      link.download = target.filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      onCompleted?.(target.src);
    }
  } catch (err) {
    console.error('Failed to save files:', err);
  }
}

export type { ShareTarget };

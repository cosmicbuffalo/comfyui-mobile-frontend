export async function downloadImage(
  src: string,
  filename: string = 'image.png',
  onDownloaded?: (src: string) => void
) {
  try {
    const response = await fetch(src);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    onDownloaded?.(src);
  } catch (err) {
    console.error('Failed to download image:', err);
  }
}

// Derive a download filename from a ComfyUI asset URL: the `filename` query
// param (how /view and the thumbnail/preview endpoints name files), else the
// last path segment. Falls back to 'image.png' only if neither is present.
function filenameFromSrc(src: string): string {
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

async function fetchAsFile(target: ShareTarget): Promise<File> {
  const response = await fetch(target.src);
  if (!response.ok) {
    // Don't wrap an error body (404/500 HTML/JSON) into a "file" and hand it to
    // the share/download flow as if it succeeded.
    throw new Error(`Failed to fetch ${target.filename} (${response.status})`);
  }
  const blob = await response.blob();
  return new File([blob], target.filename, { type: blob.type || 'application/octet-stream' });
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Save a file to the user's device. On platforms that support the Web Share
 * API with files (iOS Safari, modern Chrome on Android, etc.), this opens
 * the native share sheet — letting the user save to Photos / Camera Roll,
 * Files, or send to another app. Falls back to a standard browser download
 * (anchor with the `download` attribute) when share-with-files isn't
 * available.
 *
 * If the user dismisses the share sheet (AbortError), we silently no-op —
 * we do NOT fall back to a download in that case, since they explicitly
 * cancelled.
 */
export async function shareOrDownloadFile(
  src: string,
  filename: string,
): Promise<void> {
  try {
    const file = await fetchAsFile({ src, filename });

    if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function') {
      const payload = { files: [file] };
      if (navigator.canShare(payload)) {
        try {
          await navigator.share(payload);
          return;
        } catch (err) {
          if (isAbortError(err)) return;
          // Fall through to anchor download
        }
      }
    }

    const objectUrl = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.error('Failed to save file:', err);
  }
}

/**
 * Save multiple files. Tries to invoke the native share sheet once with all
 * files when supported (iOS Safari handles "Save N Images" to Photos this
 * way). Falls back to sequential per-file downloads.
 */
function triggerBrowserDownload(file: File, filename: string): void {
  const objectUrl = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function shareOrDownloadBatch(
  targets: ShareTarget[],
  onCompleted?: (src: string) => void,
): Promise<void> {
  if (targets.length === 0) return;

  const canShareFiles =
    typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  try {
    if (canShareFiles) {
      // The native share sheet needs every file in memory at once, so prefetch
      // the whole batch only on this path.
      const files = await Promise.all(targets.map(fetchAsFile));
      if (navigator.canShare({ files })) {
        try {
          await navigator.share({ files });
          for (const target of targets) onCompleted?.(target.src);
          return;
        } catch (err) {
          if (isAbortError(err)) return;
          // Fall through to per-file downloads, reusing the fetched files.
        }
      }
      for (let i = 0; i < targets.length; i++) {
        triggerBrowserDownload(files[i], targets[i].filename);
        onCompleted?.(targets[i].src);
      }
      return;
    }

    // No share-with-files support (most desktop browsers): fetch and download
    // one file at a time instead of prefetching the entire selection at once.
    for (const target of targets) {
      const file = await fetchAsFile(target);
      triggerBrowserDownload(file, target.filename);
      onCompleted?.(target.src);
    }
  } catch (err) {
    console.error('Failed to save files:', err);
  }
}

export type { ShareTarget };

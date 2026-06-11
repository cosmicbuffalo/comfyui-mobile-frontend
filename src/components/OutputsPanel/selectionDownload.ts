import type { FileItem } from '@/api/client';

export interface DownloadTarget {
  src: string;
  filename: string;
}

// Media extensions a selected item must have to be reconstructed into a download
// target from its id when it's outside the current folder view.
const DOWNLOADABLE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'webm', 'mkv',
]);

// The known asset roots (AssetSource). A selected id's source prefix is validated
// against these before it's injected into a /view?type=... request so a malformed
// or persisted id can't trigger an unexpected request.
const VALID_SOURCES = new Set(['output', 'input', 'temp']);

/**
 * Reconstruct a `/view` download target from a selected file id. File ids have
 * the form `${source}/${relativePath}` (see api/client/assets). Returns null for
 * folders / non-media (which have no downloadable media extension).
 */
export function downloadTargetFromFileId(id: string): DownloadTarget | null {
  const slash = id.indexOf('/');
  if (slash < 0) return null;
  const source = id.slice(0, slash);
  if (!VALID_SOURCES.has(source)) return null;
  const path = id.slice(slash + 1);
  if (!path) return null;
  const lastSlash = path.lastIndexOf('/');
  const filename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const subfolder = lastSlash >= 0 ? path.slice(0, lastSlash) : '';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!DOWNLOADABLE_EXTENSIONS.has(ext)) return null;
  return {
    src: `/view?filename=${encodeURIComponent(filename)}&type=${source}&subfolder=${encodeURIComponent(subfolder)}`,
    filename,
  };
}

/**
 * Resolve download targets for a multi-folder selection: prefer the in-view file
 * object (its real fullUrl), and reconstruct from the id for selected items that
 * aren't in the current folder view so they aren't silently skipped.
 */
export function resolveSelectionDownloadTargets(
  selectedIds: string[],
  displayedById: Map<string, FileItem>,
): DownloadTarget[] {
  const targets: DownloadTarget[] = [];
  for (const id of selectedIds) {
    const file = displayedById.get(id);
    if (file) {
      if (file.fullUrl && file.type !== 'folder') {
        targets.push({ src: file.fullUrl, filename: file.name });
      }
      continue;
    }
    const reconstructed = downloadTargetFromFileId(id);
    if (reconstructed) targets.push(reconstructed);
  }
  return targets;
}

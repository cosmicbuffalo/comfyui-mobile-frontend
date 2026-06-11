import type { UserDataFile } from '@/api/client';
import { isPathAtOrUnder } from '@/utils/pathPrefix';

/** Strip the leading "workflows/" prefix from a file path to get the API-relative name */
export function getRelativePath(file: UserDataFile): string {
  return file.path.replace(/^workflows\//, '');
}

/** Get direct children (files and folders) of a given folder path */
export function getDirectChildren(allItems: UserDataFile[], folderPath: string): UserDataFile[] {
  return allItems.filter((item) => {
    const parentPath = item.path.substring(0, item.path.lastIndexOf('/'));
    return parentPath === folderPath;
  });
}

export function getWorkflowParentPath(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/');
  return slash >= 0 ? relativePath.slice(0, slash) : '';
}

export function getWorkflowMoveDestinationPath(
  target: UserDataFile,
  destinationDirectory: string,
): string {
  const relativePath = getRelativePath(target);
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1);
  return [destinationDirectory, name].filter(Boolean).join('/');
}

export function canBrowseWorkflowMoveDestination(
  target: UserDataFile,
  destinationDirectory: string,
): boolean {
  if (target.type !== 'directory') return true;
  const targetPath = getRelativePath(target);
  return destinationDirectory !== targetPath
    && !destinationDirectory.startsWith(`${targetPath}/`);
}

export function canMoveWorkflowEntryToDirectory(
  target: UserDataFile,
  destinationDirectory: string,
  allItems: UserDataFile[],
): boolean {
  const targetPath = getRelativePath(target);
  if (!canBrowseWorkflowMoveDestination(target, destinationDirectory)) return false;
  if (getWorkflowParentPath(targetPath) === destinationDirectory) return false;
  const destinationPath = getWorkflowMoveDestinationPath(target, destinationDirectory);
  return !allItems.some(
    (item) => getRelativePath(item) === destinationPath && getRelativePath(item) !== targetPath,
  );
}

/** A path is hidden if any of its segments begins with a dot (dotfile/dotdir). */
export function isHiddenWorkflowPath(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => segment.startsWith('.'));
}

/** True if the path is manually marked hidden, or sits inside a folder that is
 *  (so hiding a folder hides everything under it). */
export function isManuallyHiddenWorkflowPath(
  relativePath: string,
  hiddenPaths: Iterable<string>,
): boolean {
  for (const hidden of hiddenPaths) {
    if (hidden && isPathAtOrUnder(relativePath, hidden)) return true;
  }
  return false;
}

/** Drop hidden entries — dotfiles plus anything manually marked hidden (or under
 *  a hidden folder) — unless showHidden is on. */
export function filterHiddenWorkflows(
  items: UserDataFile[],
  showHidden: boolean,
  hiddenPaths: Iterable<string> = [],
): UserDataFile[] {
  if (showHidden) return items;
  const hiddenList = Array.from(hiddenPaths);
  return items.filter((item) => {
    const rel = getRelativePath(item);
    return !isHiddenWorkflowPath(rel) && !isManuallyHiddenWorkflowPath(rel, hiddenList);
  });
}

/** Keep only favorited entries — and folders that contain a favorited
 *  descendant — so the favorites view still lets you drill into them. */
export function filterFavoriteWorkflows(
  items: UserDataFile[],
  favorites: string[],
): UserDataFile[] {
  const favoriteSet = new Set(favorites);
  return items.filter((item) => {
    const relativePath = getRelativePath(item);
    if (favoriteSet.has(relativePath)) return true;
    if (item.type === 'directory') {
      const prefix = relativePath + '/';
      return favorites.some((favorite) => favorite.startsWith(prefix));
    }
    return false;
  });
}

/** Map of folder path → the most recent modified time (epoch seconds) of the
 *  folder itself or any of its descendants, computed from the flat recursive
 *  item list. Lets folders show/sort by date the same way files do. */
export function buildFolderModifiedMap(allItems: UserDataFile[]): Map<string, number> {
  const map = new Map<string, number>();
  const bump = (path: string, modified: number) => {
    const current = map.get(path);
    if (current == null || modified > current) map.set(path, modified);
  };
  for (const item of allItems) {
    if (item.modified == null) continue;
    // Seed a folder with its own modified time.
    if (item.type === 'directory') bump(item.path, item.modified);
    // Propagate this item's modified time up to every ancestor folder.
    let path = item.path;
    let slash = path.lastIndexOf('/');
    while (slash > 0) {
      path = path.slice(0, slash);
      bump(path, item.modified);
      slash = path.lastIndexOf('/');
    }
  }
  return map;
}

/** Extract just the filename (no folders, no extension) for display purposes */
export function getDisplayName(filename: string): string {
  const basename = filename.includes('/')
    ? filename.substring(filename.lastIndexOf('/') + 1)
    : filename;
  return basename.replace(/\.json$/, '');
}

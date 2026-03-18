import type { UserDataFile } from '@/api/client';

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

/** Extract just the filename (no folders, no extension) for display purposes */
export function getDisplayName(filename: string): string {
  const basename = filename.includes('/')
    ? filename.substring(filename.lastIndexOf('/') + 1)
    : filename;
  return basename.replace(/\.json$/, '');
}

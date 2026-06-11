import type { AssetSource, FileItem } from '@/api/client';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Human-friendly date-section label: "Today" / "Yesterday" / locale date. */
export function formatDateLabel(timestamp?: number): string {
  if (!timestamp) return 'Unknown date';
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date = new Date(timestamp);
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((todayStart.getTime() - dateStart.getTime()) / DAY_MS);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export interface FileSection {
  key: string;
  label: string;
  files: FileItem[];
}

/**
 * Group an already-sorted file list into display sections. The grouping axis
 * depends on the active sort: by initial letter (name), by rounded size, by
 * date, or a single "All files" section when none applies.
 */
export function buildFileSections(
  nonFolders: FileItem[],
  opts: { isNameSort: boolean; isSizeSort: boolean; shouldGroupByDate: boolean },
): FileSection[] {
  const { isNameSort, isSizeSort, shouldGroupByDate } = opts;

  const pushGrouped = (keyOf: (file: FileItem) => { key: string; label: string }): FileSection[] => {
    const sections: FileSection[] = [];
    for (const file of nonFolders) {
      const { key, label } = keyOf(file);
      const last = sections[sections.length - 1];
      if (last && last.key === key) {
        last.files.push(file);
      } else {
        sections.push({ key, label, files: [file] });
      }
    }
    return sections;
  };

  if (isNameSort) {
    return pushGrouped((file) => {
      const key = file.name?.trim()?.charAt(0).toUpperCase() || '#';
      return { key, label: `Starting with ${key}` };
    });
  }

  if (isSizeSort) {
    return pushGrouped((file) => {
      const sizeMb = (file.size ?? 0) / (1024 * 1024);
      const roundedMb = sizeMb < 1 ? 0 : Math.round(sizeMb);
      const label = roundedMb === 0 ? '<1MB' : `${roundedMb}MB`;
      return { key: label, label };
    });
  }

  if (!shouldGroupByDate) {
    return [{ key: 'all', label: 'All files', files: nonFolders }];
  }

  return pushGrouped((file) => ({
    key: file.date ? new Date(file.date).toISOString().slice(0, 10) : 'unknown',
    label: formatDateLabel(file.date),
  }));
}

export interface Crumb {
  name: string;
  path: string | null;
}

export interface DisplayCrumb extends Crumb {
  isEllipsis?: boolean;
  isClickable: boolean;
}

/** Build the breadcrumb trail (root + each folder segment) for a browse location. */
export function buildBreadcrumbs(source: AssetSource, folder: string | null): Crumb[] {
  const rootName = source === 'output' ? 'Outputs' : source === 'input' ? 'Inputs' : 'Temp';
  const crumbs: Crumb[] = [{ name: rootName, path: null }];
  if (folder) {
    const parts = folder.split('/');
    parts.forEach((part, index) => {
      crumbs.push({ name: part, path: parts.slice(0, index + 1).join('/') });
    });
  }
  return crumbs;
}

/**
 * A crumb is hidden if its path (or any ancestor) is dot-prefixed or has been
 * seen as a manually-hidden folder while browsing.
 */
export function isCrumbHidden(path: string | null, hiddenFolderPaths: string[]): boolean {
  if (!path) return false;
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.'))) return true;
  for (let i = 1; i <= parts.length; i++) {
    if (hiddenFolderPaths.includes(parts.slice(0, i).join('/'))) return true;
  }
  return false;
}

/**
 * Collapse a crumb list to at most Root / … / Parent / Current, marking which
 * entries are clickable (everything but the current/last).
 */
export function collapseBreadcrumbs(crumbs: Crumb[]): DisplayCrumb[] {
  const total = crumbs.length;
  const displayCrumbs: DisplayCrumb[] = [];
  if (total <= 3) {
    crumbs.forEach((crumb, idx) => {
      displayCrumbs.push({ ...crumb, isClickable: idx < total - 1 });
    });
  } else {
    displayCrumbs.push({ ...crumbs[0], isClickable: true });
    displayCrumbs.push({ name: '...', path: crumbs[total - 3].path, isEllipsis: true, isClickable: true });
    displayCrumbs.push({ ...crumbs[total - 2], isClickable: true });
    displayCrumbs.push({ ...crumbs[total - 1], isClickable: false });
  }
  return displayCrumbs;
}

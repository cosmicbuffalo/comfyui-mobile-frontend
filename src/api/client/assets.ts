import type { Workflow } from '../types';

export async function uploadImageFile(
  file: File,
  options?: { type?: string; subfolder?: string; overwrite?: boolean }
): Promise<{ name: string; subfolder: string; type: string }> {
  const form = new FormData();
  form.append('image', file);
  if (options?.type) {
    form.append('type', options.type);
  }
  if (options?.subfolder) {
    form.append('subfolder', options.subfolder);
  }
  if (options?.overwrite !== undefined) {
    form.append('overwrite', options.overwrite ? 'true' : 'false');
  }

  const response = await fetch(`/upload/image`, {
    method: 'POST',
    body: form
  });

  if (!response.ok) {
    throw new Error('Failed to upload image');
  }

  return response.json();
}

export async function copyFileToInput(
  path: string,
  source: Extract<AssetSource, 'output' | 'temp'>,
  options?: { overwrite?: boolean },
): Promise<{ name: string; subfolder: string; type: string }> {
  const response = await fetch(`/mobile/api/files/copy-to-input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path,
      source,
      overwrite: options?.overwrite ?? true,
    }),
  });

  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`;
    try {
      const data = await response.clone().json();
      if (typeof data?.error === 'string' && data.error.trim()) {
        detail = data.error;
      }
    } catch {
      try {
        const text = await response.text();
        if (text.trim()) detail = text.trim();
      } catch {
        // Keep the status text fallback.
      }
    }
    throw new Error(`Failed to copy file to inputs (${response.status}): ${detail}`);
  }

  return response.json();
}

export async function createInputAliases(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const response = await fetch('/mobile/api/input-aliases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create input aliases');
  }
  const data = await response.json() as { aliases?: Record<string, string> };
  return data.aliases ?? {};
}

export async function createFilePrefixAliases(prefixes: string[]): Promise<Record<string, string>> {
  if (prefixes.length === 0) return {};
  const response = await fetch('/mobile/api/file-prefix-aliases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create filename prefix aliases');
  }
  const data = await response.json() as { aliases?: Record<string, string> };
  return data.aliases ?? {};
}

export async function resolveFilePrefixAliases(aliases: string[]): Promise<Record<string, string>> {
  if (aliases.length === 0) return {};
  const response = await fetch('/mobile/api/file-prefix-aliases/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aliases }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to resolve filename prefix aliases');
  }
  const data = await response.json() as { resolved?: Record<string, string> };
  return data.resolved ?? {};
}


export interface FileItem {
  id: string;
  name: string;
  type: 'image' | 'video' | 'folder';
  previewUrl?: string;
  fullUrl?: string;
  date?: number;
  size?: number;
  // Only populated for synthetic folder entries surfaced by the prompt-search
  // projection — counts descendant files in this folder that match the
  // active search. Lets the UI label "→ N matches" on filtered folders.
  matchCount?: number;
  // Only populated for folder entries during normal navigation — recursive
  // count of all descendant files (computed server-side). Drives the folder
  // subtitle and the top-bar item total for the focused location.
  count?: number;
  // True when this item is effectively hidden (its own state OR inherited from a
  // hidden ancestor folder). Drives the dimmed/vignette + italic display.
  hidden?: boolean;
  // True only when this exact item is in the hidden set (not merely inherited),
  // so it can be unhidden directly. Drives the Hide/Unhide menu label.
  hiddenSelf?: boolean;
}

export type AssetSource = 'output' | 'input' | 'temp';
export type SortMode = 'modified' | 'modified-reverse' | 'name' | 'name-reverse' | 'size' | 'size-reverse';

// Mobile Files API - browse output/input directories
interface MobileFileItem {
  name: string;
  path: string;
  type: 'image' | 'video' | 'dir';
  size?: number;
  date: number;
  folder?: string;
  count?: number; // for directories
  hidden?: boolean; // effectively hidden (self or inherited); only present when showHidden
  hiddenSelf?: boolean; // this exact item is in the hidden set
}

interface MobileFilesResponse {
  files: MobileFileItem[];
  total: number;
  offset: number;
  limit: number;
}

async function fetchMobileFiles(
  path: string = '',
  recursive: boolean = false,
  source: AssetSource = 'output',
  showHidden?: boolean,
  options: { search?: string; prompt?: string; dirsOnly?: boolean } = {},
): Promise<MobileFilesResponse> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  if (recursive) params.set('recursive', 'true');
  if (source) params.set('source', source);
  if (showHidden) params.set('showHidden', 'true');
  if (options.search) params.set('search', options.search);
  if (options.prompt) params.set('prompt', options.prompt);
  if (options.dirsOnly) params.set('dirsOnly', 'true');

  const response = await fetch(`/mobile/api/files?${params}`);
  if (!response.ok) throw new Error('Failed to fetch files');
  return response.json();
}

/**
 * List every folder nested under `folder` (recursively) for the given source.
 * Used by the move picker's folder search. Hidden folders are included only
 * when `showHidden` is set, and carry the same `hidden`/`hiddenSelf` flags.
 */
export async function getRecursiveFolders(
  source: AssetSource,
  folder: string | null = null,
  showHidden?: boolean,
): Promise<FileItem[]> {
  const result = await fetchMobileFiles(folder || '', false, source, showHidden, { dirsOnly: true });
  return result.files
    .filter((f) => f.type === 'dir')
    .map((f) => ({
      id: `${source}/${f.path}`,
      name: f.name,
      type: 'folder' as const,
      date: f.date,
      hidden: f.hidden,
      hiddenSelf: f.hiddenSelf,
    }));
}

/**
 * Search outputs by combined filename-or-prompt-metadata match. Recurses from
 * the given folder (or the source root when `folder` is omitted). The server
 * caches PNG prompt metadata by mtime so repeat searches are cheap.
 */
export async function searchUserImagesByPrompt(
  source: AssetSource,
  query: string,
  folder: string | null = null,
  showHidden?: boolean,
): Promise<FileItem[]> {
  const searchRoot = folder || '';
  const [nameMatches, promptMatches] = await Promise.all([
    fetchMobileFiles(searchRoot, true, source, showHidden, { search: query }),
    fetchMobileFiles(searchRoot, true, source, showHidden, { prompt: query }),
  ]);

  const byPath = new Map<string, MobileFileItem>();
  for (const file of [...nameMatches.files, ...promptMatches.files]) {
    if (file.type === 'dir') continue;
    byPath.set(file.path, file);
  }

  return Array.from(byPath.values()).map((f) => {
    const folderPath = f.folder || (f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : '');
    return {
      id: `${source}/${f.path}`,
      name: f.name,
      type: f.type as 'image' | 'video',
      previewUrl: `/mobile/api/thumbnail?filename=${encodeURIComponent(f.name)}&subfolder=${encodeURIComponent(folderPath)}&source=${source}`,
      fullUrl: `/view?filename=${encodeURIComponent(f.name)}&type=${source}&subfolder=${encodeURIComponent(folderPath)}`,
      date: f.date,
      size: f.size,
      hidden: f.hidden,
      hiddenSelf: f.hiddenSelf,
    };
  });
}

/**
 * Mark (or unmark) an individual output/input item as hidden. The hidden state
 * is persisted server-side per source, keyed by the item's relative path.
 */
export async function setFileHidden(
  path: string,
  hidden: boolean,
  source: AssetSource = 'output',
): Promise<void> {
  const response = await fetch(`/mobile/api/files/hidden`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, hidden, source }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update hidden state');
  }
}

export async function getUserImageFolders(showHidden?: boolean): Promise<{ input: string[]; output: string[] }> {
  // Fetch root directory to get top-level folders
  const outputResult = await fetchMobileFiles('', false, 'output', showHidden);
  const inputResult = await fetchMobileFiles('', false, 'input', showHidden);
  const outputFolders = outputResult.files
    .filter(f => f.type === 'dir')
    .map(f => f.name);
  const inputFolders = inputResult.files
    .filter(f => f.type === 'dir')
    .map(f => f.name);

  return { input: inputFolders, output: outputFolders };
}

export async function getUserImages(
  mode: AssetSource,
  // Note: count, offset, sort params kept for API compatibility but not used by mobile backend
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _count = 1000,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _offset = 0,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _sort: SortMode = 'modified',
  includeSubfolders = false,
  subfolder: string | null = null,
  showHidden?: boolean
): Promise<FileItem[]> {
  const result = await fetchMobileFiles(subfolder || '', includeSubfolders, mode, showHidden);

  // Convert mobile API response to FileItem array
  return result.files.map(f => {
    if (f.type === 'dir') {
      return {
        id: `${mode}/${f.path}`,
        name: f.name,
        type: 'folder' as const,
        date: f.date,
        size: f.size,
        count: f.count,
        hidden: f.hidden,
      hiddenSelf: f.hiddenSelf,
      };
    }

    // For images/videos, construct preview and full URLs
    const folder = f.folder || (f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : '');
    return {
      id: `${mode}/${f.path}`,
      name: f.name,
      type: f.type as 'image' | 'video',
      previewUrl: `/mobile/api/thumbnail?filename=${encodeURIComponent(f.name)}&subfolder=${encodeURIComponent(folder)}&source=${mode}`,
      fullUrl: `/view?filename=${encodeURIComponent(f.name)}&type=${mode}&subfolder=${encodeURIComponent(folder)}`,
      date: f.date,
      size: f.size,
      hidden: f.hidden,
      hiddenSelf: f.hiddenSelf,
    };
  });
}

export async function deleteFile(path: string, source: AssetSource = 'output'): Promise<void> {
  const response = await fetch(`/mobile/api/files`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, source })
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete file');
  }
}

export async function getFileWorkflow(
  path: string,
  source: AssetSource = 'output',
  options?: { signal?: AbortSignal },
): Promise<Workflow> {
  const params = new URLSearchParams({ path, source });
  const response = await fetch(`/mobile/api/file-metadata?${params.toString()}`, {
    signal: options?.signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to load file metadata');
  }
  const data = await response.json();
  if (!data.workflow) {
    throw new Error('No workflow metadata found');
  }
  return data.workflow as Workflow;
}

export async function getFileWorkflowAvailability(
  path: string,
  source: AssetSource = 'output',
  options?: { signal?: AbortSignal },
): Promise<boolean> {
  const params = new URLSearchParams({ path, source });
  const response = await fetch(`/mobile/api/workflow-availability?${params.toString()}`, {
    signal: options?.signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to load workflow availability');
  }
  const data = await response.json();
  return Boolean(data.available);
}

export async function getImageMetadata(
  path: string,
  source: AssetSource = 'output'
): Promise<{ prompt?: unknown; workflow?: unknown }> {
  const params = new URLSearchParams({ path, source });
  const response = await fetch(`/mobile/api/image-metadata?${params.toString()}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to load image metadata');
  }
  return response.json();
}

export async function moveFiles(
  paths: string[],
  destination: string | null,
  source: AssetSource = 'output'
): Promise<void> {
  const response = await fetch(`/mobile/api/files/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sources: paths, destination: destination ?? '', source })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to move files');
  }
}

export async function createFolder(path: string, source: AssetSource = 'output'): Promise<void> {
  const response = await fetch(`/mobile/api/files/mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, source })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to create folder');
  }
}

export async function renameFile(
  path: string,
  newName: string,
  source: AssetSource = 'output'
): Promise<void> {
  const response = await fetch(`/mobile/api/files/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, newName, source })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to rename file');
  }
}


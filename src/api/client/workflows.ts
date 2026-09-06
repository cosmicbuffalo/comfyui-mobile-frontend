import type { Workflow } from '../types';

const RECENT_WORKFLOWS_PATH = 'mobile/recent_workflows.json';
const WORKFLOW_HIDDEN_PATH = 'mobile/workflow_hidden.json';
const WORKFLOW_FAVORITES_PATH = 'mobile/workflow_favorites.json';
const WORKFLOW_LINEAGES_PATH = 'mobile/workflow_lineages.json';

export interface UserDataFile {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: number;
}

export async function listUserWorkflows(): Promise<UserDataFile[]> {
  const response = await fetch(`/api/v2/userdata?path=workflows`);
  if (!response.ok) {
    // Folder may not exist yet
    if (response.status === 404) return [];
    throw new Error('Failed to list user workflows');
  }
  const data = await response.json();
  // Keep directories and JSON files
  return data.filter((item: UserDataFile) =>
    item.type === 'directory' || (item.type === 'file' && item.name.endsWith('.json'))
  );
}

// Helper to encode full path for userdata API (slashes must be encoded as %2F)
function encodeUserDataPath(path: string): string {
  return encodeURIComponent(path);
}

export async function loadUserWorkflow(filename: string): Promise<Workflow> {
  const response = await fetch(`/api/userdata/${encodeUserDataPath('workflows/' + filename)}`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Failed to load workflow');
  return response.json();
}

export async function saveUserWorkflow(filename: string, workflow: Workflow): Promise<void> {
  const response = await fetch(`/api/userdata/${encodeUserDataPath('workflows/' + filename)}?overwrite=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(workflow)
  });
  if (!response.ok) throw new Error('Failed to save workflow');
}

export async function deleteUserWorkflow(filename: string): Promise<void> {
  const response = await fetch(`/api/userdata/${encodeUserDataPath('workflows/' + filename)}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to delete workflow');
}

// Rename/move a workflow file OR folder. Paths are relative to the workflows
// dir (e.g. "foo.json" or "sub/foo.json"). Uses ComfyUI's native userdata move,
// which handles both files and directories.
export async function renameUserWorkflowEntry(fromPath: string, toPath: string): Promise<void> {
  const src = encodeUserDataPath('workflows/' + fromPath);
  const dest = encodeUserDataPath('workflows/' + toPath);
  const response = await fetch(`/api/userdata/${src}/move/${dest}?overwrite=false`, {
    method: 'POST',
  });
  if (response.status === 409) throw new Error('A file or folder with that name already exists');
  if (!response.ok) throw new Error('Failed to rename');
}

// Create an empty folder under the workflows dir (path relative to workflows).
// Backed by the mobile server (ComfyUI's userdata API has no mkdir).
export async function createUserWorkflowFolder(path: string): Promise<void> {
  const response = await fetch('/mobile/api/workflows/folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create folder');
  }
}

// Recursively delete a folder under the workflows dir (path relative to
// workflows). Backed by the mobile server (native userdata DELETE is files-only).
export async function deleteUserWorkflowFolder(path: string): Promise<void> {
  const response = await fetch(`/mobile/api/workflows/folder?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete folder');
  }
}

// Template workflows API
export interface WorkflowTemplates {
  [moduleName: string]: string[];
}

export async function getWorkflowTemplates(): Promise<WorkflowTemplates> {
  const response = await fetch(`/api/workflow_templates`);
  if (!response.ok) throw new Error('Failed to fetch templates');
  return response.json();
}

/**
 * ComfyUI serves two disjoint sets of templates, and the desktop frontend reads
 * both:
 *
 *  - Custom-node example workflows, listed by `/api/workflow_templates` and
 *    served per module (what `WorkflowTemplates` above describes).
 *  - The core catalog shipped in the `comfyui-workflow-templates` package,
 *    indexed at `/templates/index.json` and served flat at `/templates/<name>.json`.
 *    Its entries carry titles, descriptions, categories and thumbnails.
 *
 * Core entries use the reserved module name "default", matching the desktop
 * frontend's own convention, so one (moduleName, templateName) pair addresses a
 * template from either set.
 */
export const CORE_TEMPLATE_MODULE = 'default';

/** Thumbnail suffix used for custom-node example workflows, per desktop. */
const EXTENSION_TEMPLATE_MEDIA_SUBTYPE = 'jpg';

export interface CoreTemplateInfo {
  name: string;
  title?: string;
  description?: string;
  /** 'image' | 'audio' — audio entries have no still to show. */
  mediaType?: string;
  /** Thumbnail extension: 'webp' for images, 'mp3' for audio. */
  mediaSubtype?: string;
  tags?: string[];
  models?: string[];
  requiresCustomNodes?: string[];
  tutorialUrl?: string;
  date?: string;
}

export interface CoreTemplateCategory {
  moduleName: string;
  /** Localized in the `index.<locale>.json` variants. */
  title: string;
  category?: string;
  type?: string;
  icon?: string;
  isEssential?: boolean;
  templates: CoreTemplateInfo[];
}

// Our locale codes vs. the index filenames the templates package ships.
const CORE_TEMPLATE_INDEX_LOCALES: Record<string, string> = {
  'zh-CN': 'zh',
  'zh-TW': 'zh-TW',
  ja: 'ja',
  ko: 'ko',
};

const CORE_TEMPLATE_INDEX_PATH = '/templates/index.json';

function coreTemplateIndexPath(locale?: string): string {
  const suffix = locale ? CORE_TEMPLATE_INDEX_LOCALES[locale] : undefined;
  return suffix ? `/templates/index.${suffix}.json` : CORE_TEMPLATE_INDEX_PATH;
}

function isCoreTemplateCategory(value: unknown): value is CoreTemplateCategory {
  if (!value || typeof value !== 'object') return false;
  const group = value as Partial<CoreTemplateCategory>;
  return typeof group.title === 'string' && Array.isArray(group.templates);
}

async function fetchCoreTemplateIndex(path: string): Promise<CoreTemplateCategory[] | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    // A server without the templates package can answer this path with the
    // app's own index.html rather than a 404, so trust the content type.
    if (!response.headers.get('content-type')?.includes('application/json')) return null;
    const data: unknown = await response.json();
    if (!Array.isArray(data)) return null;
    return data.filter(isCoreTemplateCategory);
  } catch {
    return null;
  }
}

/**
 * The core template catalog, grouped into categories. Resolves to an empty list
 * rather than throwing when the server has no templates package: the
 * custom-node list is fetched independently and should still render.
 */
export async function getCoreWorkflowTemplates(locale?: string): Promise<CoreTemplateCategory[]> {
  const path = coreTemplateIndexPath(locale);
  const localized = await fetchCoreTemplateIndex(path);
  if (localized) return localized;
  // A locale the templates package doesn't ship falls back to English rather
  // than dropping the whole catalog.
  if (path === CORE_TEMPLATE_INDEX_PATH) return [];
  return (await fetchCoreTemplateIndex(CORE_TEMPLATE_INDEX_PATH)) ?? [];
}

/**
 * Thumbnail URL for a template, or null when it has no still image. Core
 * entries number their assets (`<name>-1.webp`); custom-node example workflows
 * sit beside their workflow as `<name>.jpg` (often absent — render through an
 * error fallback).
 */
export function getTemplateThumbnailUrl(
  moduleName: string,
  template: Pick<CoreTemplateInfo, 'name' | 'mediaType' | 'mediaSubtype'>,
  assetIndex = 1,
): string | null {
  if (moduleName !== CORE_TEMPLATE_MODULE) {
    return `/api/workflow_templates/${encodeURIComponent(moduleName)}/${encodeURIComponent(template.name)}.${EXTENSION_TEMPLATE_MEDIA_SUBTYPE}`;
  }
  const subtype = template.mediaSubtype;
  // Audio templates ship an mp3 in the thumbnail slot — nothing to render.
  if (!subtype || template.mediaType === 'audio' || subtype === 'mp3') return null;
  return `/templates/${encodeURIComponent(template.name)}-${assetIndex}.${subtype}`;
}

export async function loadTemplateWorkflow(moduleName: string, templateName: string): Promise<Workflow> {
  // Server lists template names without .json; static files are *.json.
  const fileName = templateName.endsWith('.json') ? templateName : `${templateName}.json`;
  const response = await fetch(
    moduleName === CORE_TEMPLATE_MODULE
      ? `/templates/${encodeURIComponent(fileName)}`
      : `/api/workflow_templates/${encodeURIComponent(moduleName)}/${encodeURIComponent(fileName)}`
  );
  if (!response.ok) throw new Error('Failed to load template');
  return response.json();
}


// The hidden and bookmarked (favorites) lists share one server contract:
// a JSON array of workflow paths at a fixed userdata location, 404 meaning
// "not saved yet". The shared core below carries that contract; the exported
// pairs are thin wrappers over it.
async function loadWorkflowPathList(
  path: string,
  label: string,
): Promise<string[] | null | undefined> {
  try {
    const response = await fetch(
      `/api/userdata/${encodeUserDataPath(path)}`,
      { cache: 'no-store' },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to load ' + label + ' workflows');
    const data = await response.json();
    return Array.isArray(data)
      ? data.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : [];
  } catch {
    return undefined;
  }
}

async function saveWorkflowPathList(
  path: string,
  label: string,
  paths: string[],
): Promise<void> {
  const response = await fetch(
    `/api/userdata/${encodeUserDataPath(path)}?overwrite=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paths),
    },
  );
  if (!response.ok) throw new Error('Failed to save ' + label + ' workflows');
}

export async function loadWorkflowHiddenFromServer(): Promise<string[] | null | undefined> {
  return loadWorkflowPathList(WORKFLOW_HIDDEN_PATH, 'hidden');
}

export async function saveWorkflowHiddenToServer(hidden: string[]): Promise<void> {
  return saveWorkflowPathList(WORKFLOW_HIDDEN_PATH, 'hidden', hidden);
}

// Same shape as the hidden API above — server-synced bookmarked workflows
// stored at mobile/workflow_favorites.json so they roam across devices.
export async function loadWorkflowFavoritesFromServer(): Promise<string[] | null | undefined> {
  return loadWorkflowPathList(WORKFLOW_FAVORITES_PATH, 'favorite');
}

export async function saveWorkflowFavoritesToServer(favorites: string[]): Promise<void> {
  return saveWorkflowPathList(WORKFLOW_FAVORITES_PATH, 'favorite', favorites);
}

// The lineage registry roams the same way the hidden/favorites lists do, but
// it is a document rather than a path list, so it gets its own pair. Both
// return the raw parsed value — `normalizeRegistry` owns validation, since
// this file may have been written by another device or a newer app version.
// `null` means "not saved yet" (404); `undefined` means the request failed and
// the caller should keep whatever it already has.
export async function loadLineageRegistryFromServer(): Promise<unknown | null | undefined> {
  try {
    const response = await fetch(
      `/api/userdata/${encodeUserDataPath(WORKFLOW_LINEAGES_PATH)}`,
      { cache: 'no-store' },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to load workflow lineages');
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function saveLineageRegistryToServer(registry: unknown): Promise<void> {
  const response = await fetch(
    `/api/userdata/${encodeUserDataPath(WORKFLOW_LINEAGES_PATH)}?overwrite=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registry),
    },
  );
  if (!response.ok) throw new Error('Failed to save workflow lineages');
}

export async function loadRecentWorkflowsFromServer(): Promise<unknown[]> {
  try {
    const response = await fetch(
      `/api/userdata/${encodeUserDataPath(RECENT_WORKFLOWS_PATH)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function saveRecentWorkflowsToServer(entries: unknown[]): Promise<void> {
  try {
    await fetch(
      `/api/userdata/${encodeUserDataPath(RECENT_WORKFLOWS_PATH)}?overwrite=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entries),
      },
    );
  } catch {
    // Silent fail — this is a convenience sync, not critical
  }
}


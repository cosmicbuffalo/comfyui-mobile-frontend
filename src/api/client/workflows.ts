import type { Workflow } from '../types';

const RECENT_WORKFLOWS_PATH = 'mobile/recent_workflows.json';
const WORKFLOW_HIDDEN_PATH = 'mobile/workflow_hidden.json';

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

export async function loadTemplateWorkflow(moduleName: string, templateName: string): Promise<Workflow> {
  const response = await fetch(
    `/api/workflow_templates/${encodeURIComponent(moduleName)}/${encodeURIComponent(templateName)}`
  );
  if (!response.ok) throw new Error('Failed to load template');
  return response.json();
}


export async function loadWorkflowHiddenFromServer(): Promise<string[] | null | undefined> {
  try {
    const response = await fetch(
      `/api/userdata/${encodeUserDataPath(WORKFLOW_HIDDEN_PATH)}`,
      { cache: 'no-store' },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Failed to load hidden workflows');
    const data = await response.json();
    return Array.isArray(data)
      ? data.filter((path): path is string => typeof path === 'string' && path.length > 0)
      : [];
  } catch {
    return undefined;
  }
}

export async function saveWorkflowHiddenToServer(hidden: string[]): Promise<void> {
  const response = await fetch(
    `/api/userdata/${encodeUserDataPath(WORKFLOW_HIDDEN_PATH)}?overwrite=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hidden),
    },
  );
  if (!response.ok) throw new Error('Failed to save hidden workflows');
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


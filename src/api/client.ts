import type { NodeTypes, QueueInfo, History, Workflow } from './types';
import {
  buildQueuePromptInputs,
  getWorkflowWidgetIndexMap
} from '@/utils/workflowInputs';

export const API_BASE = '';

function getOrCreateClientId(): string {
  const storageKey = 'comfyui-mobile-client-id';
  let id = localStorage.getItem(storageKey);
  if (!id) {
    id = 'mobile-' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem(storageKey, id);
  }
  return id;
}

export const clientId = getOrCreateClientId();

export async function getNodeTypes(): Promise<NodeTypes> {
  const response = await fetch(`${API_BASE}/api/object_info`);
  if (!response.ok) throw new Error('Failed to fetch node types');
  return response.json();
}

export async function getQueue(): Promise<QueueInfo> {
  const response = await fetch(`${API_BASE}/api/queue`);
  if (!response.ok) throw new Error('Failed to fetch queue');
  return response.json();
}

export async function getHistory(maxItems?: number): Promise<History> {
  const url = maxItems
    ? `${API_BASE}/api/history?max_items=${maxItems}`
    : `${API_BASE}/api/history`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch history');
  return response.json();
}

export interface LoraManagerRegistryNode {
  node_id: number;
  graph_id: string;
  graph_name: string | null;
  bgcolor: string | null;
  title: string;
  type: string;
  comfy_class: string;
  capabilities: {
    supports_lora: boolean;
    widget_names: string[];
  };
}

export async function registerLoraManagerNodes(nodes: LoraManagerRegistryNode[]): Promise<void> {
  if (nodes.length === 0) return;
  const response = await fetch(`${API_BASE}/api/lm/register-nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes })
  });
  if (!response.ok) throw new Error('Failed to register Lora Manager nodes');
}

export interface TriggerWordTargetReference {
  node_id: number;
  graph_id: string;
}

export async function requestTriggerWords(
  loraNames: string[],
  nodeIds: TriggerWordTargetReference[]
): Promise<void> {
  if (!nodeIds || nodeIds.length === 0) return;
  const response = await fetch(`${API_BASE}/api/lm/loras/get_trigger_words`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lora_names: loraNames ?? [],
      node_ids: nodeIds
    })
  });
  if (!response.ok) throw new Error('Failed to fetch trigger words');
}

// User workflows API
export interface UserDataFile {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: number;
}

export async function listUserWorkflows(): Promise<UserDataFile[]> {
  const response = await fetch(`${API_BASE}/api/v2/userdata?path=workflows`);
  if (!response.ok) {
    // Folder may not exist yet
    if (response.status === 404) return [];
    throw new Error('Failed to list user workflows');
  }
  const data = await response.json();
  // Filter to only JSON files
  return data.filter((item: UserDataFile) =>
    item.type === 'file' && item.name.endsWith('.json')
  );
}

// Helper to encode full path for userdata API (slashes must be encoded as %2F)
function encodeUserDataPath(path: string): string {
  return encodeURIComponent(path);
}

export async function loadUserWorkflow(filename: string): Promise<Workflow> {
  const response = await fetch(`${API_BASE}/api/userdata/${encodeUserDataPath('workflows/' + filename)}`);
  if (!response.ok) throw new Error('Failed to load workflow');
  return response.json();
}

export async function saveUserWorkflow(filename: string, workflow: Workflow): Promise<void> {
  const response = await fetch(`${API_BASE}/api/userdata/${encodeUserDataPath('workflows/' + filename)}?overwrite=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(workflow)
  });
  if (!response.ok) throw new Error('Failed to save workflow');
}

export async function deleteUserWorkflow(filename: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/userdata/${encodeUserDataPath('workflows/' + filename)}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to delete workflow');
}

// Template workflows API
export interface WorkflowTemplates {
  [moduleName: string]: string[];
}

export async function getWorkflowTemplates(): Promise<WorkflowTemplates> {
  const response = await fetch(`${API_BASE}/api/workflow_templates`);
  if (!response.ok) throw new Error('Failed to fetch templates');
  return response.json();
}

export async function loadTemplateWorkflow(moduleName: string, templateName: string): Promise<Workflow> {
  const response = await fetch(
    `${API_BASE}/api/workflow_templates/${encodeURIComponent(moduleName)}/${encodeURIComponent(templateName)}`
  );
  if (!response.ok) throw new Error('Failed to load template');
  return response.json();
}

// Prompt execution
function resolveClassType(nodeType: string, nodeTypes: NodeTypes): string | null {
  if (nodeTypes[nodeType]) {
    return nodeType;
  }

  const match = Object.entries(nodeTypes).find(
    ([, def]) => def.display_name === nodeType || def.name === nodeType
  );
  if (match) {
    return match[0];
  }

  return null;
}


export async function queuePrompt(
  workflow: Workflow,
  clientId: string,
  nodeTypes: NodeTypes,
  seedOverrides?: Record<number, number>
): Promise<{ prompt_id: string; number: number }> {
  const prompt: Record<string, unknown> = {};
  const allowedNodeIds = new Set<number>();
  const classTypeById = new Map<number, string>();

  for (const node of workflow.nodes) {
    const classType = resolveClassType(node.type, nodeTypes);
    if (classType) {
      allowedNodeIds.add(node.id);
      classTypeById.set(node.id, classType);
    }
  }

  for (const node of workflow.nodes) {
    const classType = classTypeById.get(node.id);
    if (!classType) {
      continue;
    }

    const inputs = buildQueuePromptInputs(
      workflow,
      nodeTypes,
      node,
      classType,
      allowedNodeIds,
      getWorkflowWidgetIndexMap(workflow, node.id),
      seedOverrides
    );
    prompt[String(node.id)] = {
      class_type: classType,
      inputs
    };
  }

  const response = await fetch(`${API_BASE}/api/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      client_id: clientId
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to queue prompt');
  }

  return response.json();
}

export async function interruptExecution(): Promise<void> {
  await fetch(`${API_BASE}/api/interrupt`, { method: 'POST' });
}

export async function clearQueue(): Promise<void> {
  await fetch(`${API_BASE}/api/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clear: true })
  });
}

export async function deleteQueueItem(promptId: string): Promise<void> {
  await fetch(`${API_BASE}/api/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: [promptId] })
  });
}

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

  const response = await fetch(`${API_BASE}/upload/image`, {
    method: 'POST',
    body: form
  });

  if (!response.ok) {
    throw new Error('Failed to upload image');
  }

  return response.json();
}

export async function deleteHistoryItem(promptId: string): Promise<void> {
  await fetch(`${API_BASE}/api/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: [promptId] })
  });
}

export async function deleteHistoryItems(promptIds: string[]): Promise<void> {
  if (promptIds.length === 0) return;
  await fetch(`${API_BASE}/api/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: promptIds })
  });
}

export async function clearHistory(): Promise<void> {
  await fetch(`${API_BASE}/api/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clear: true })
  });
}

export function getImageUrl(filename: string, subfolder: string, type: string): string {
  return `${API_BASE}/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
}

export function connectWebSocket(
  clientId: string,
  onMessage: (msg: unknown) => void,
  onOpen?: () => void,
  onClose?: () => void,
  onError?: (error: Event) => void
): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws?clientId=${clientId}`;

  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    onOpen?.();
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (e) {
      console.error('[WS] Failed to parse message:', e);
    }
  };

  ws.onclose = () => {
    onClose?.();
  };

  ws.onerror = (error) => {
    console.error('[WS] Error:', error);
    onError?.(error);
  };

  return ws;
}

export interface FileItem {
  id: string;
  name: string;
  type: 'image' | 'video' | 'folder';
  previewUrl?: string;
  fullUrl?: string;
  date?: number;
  size?: number;
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
  showHidden?: boolean
): Promise<MobileFilesResponse> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  if (recursive) params.set('recursive', 'true');
  if (source) params.set('source', source);
  if (showHidden) params.set('showHidden', 'true');

  const response = await fetch(`${API_BASE}/mobile/api/files?${params}`);
  if (!response.ok) throw new Error('Failed to fetch files');
  return response.json();
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
      };
    }

    // For images/videos, construct preview and full URLs
    const folder = f.folder || (f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : '');
    return {
      id: `${mode}/${f.path}`,
      name: f.name,
      type: f.type as 'image' | 'video',
      previewUrl: `${API_BASE}/mobile/api/thumbnail?filename=${encodeURIComponent(f.name)}&subfolder=${encodeURIComponent(folder)}&source=${mode}`,
      fullUrl: `${API_BASE}/view?filename=${encodeURIComponent(f.name)}&type=${mode}&subfolder=${encodeURIComponent(folder)}`,
      date: f.date,
      size: f.size,
    };
  });
}

export async function deleteFile(path: string, source: AssetSource = 'output'): Promise<void> {
  const response = await fetch(`${API_BASE}/mobile/api/files`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, source })
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete file');
  }
}

export async function getFileWorkflow(path: string, source: AssetSource = 'output'): Promise<Workflow> {
  const params = new URLSearchParams({ path, source });
  const response = await fetch(`${API_BASE}/mobile/api/file-metadata?${params.toString()}`);
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

export async function getImageMetadata(
  path: string,
  source: AssetSource = 'output'
): Promise<{ prompt?: unknown; workflow?: unknown }> {
  const params = new URLSearchParams({ path, source });
  const response = await fetch(`${API_BASE}/mobile/api/image-metadata?${params.toString()}`);
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
  const response = await fetch(`${API_BASE}/mobile/api/files/move`, {
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
  const response = await fetch(`${API_BASE}/mobile/api/files/mkdir`, {
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
  const response = await fetch(`${API_BASE}/mobile/api/files/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, newName, source })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to rename file');
  }
}

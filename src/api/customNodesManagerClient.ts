export type CustomNodesDataMode = 'cache' | 'local' | 'remote' | 'default';

export interface CustomNodePackageMetadata {
  title?: string;
  name?: string;
  files?: string[];
  description?: string;
  install_type?: string;
  version?: string;
  active_version?: string;
  cnr_latest?: string;
  id?: string;
  repository?: string;
  reference?: string;
  author?: string;
  stars?: number;
  last_update?: string | number;
  state?: string;
  channel?: string;
  mode?: string;
  ui_id?: string;
  pip?: string[];
  nodename_pattern?: string;
  is_favorite?: boolean;
  selected_version?: string;
  skip_post_install?: boolean;
  'update-state'?: string;
  'import-fail'?: boolean;
  'invalid-installation'?: boolean;
  [key: string]: unknown;
}

export interface CustomNodeListResponse {
  channel: string;
  node_packs: Record<string, CustomNodePackageMetadata>;
}

export type CustomNodeMappingsResponse = Record<
  string,
  [string[], { title_aux?: string; nodename_pattern?: string; [key: string]: unknown }]
>;

export type CustomNodeAlternativesResponse = Record<
  string,
  { id?: string; tags?: string | string[]; description?: string; [key: string]: unknown }
>;

export interface ManagerQueueStatus {
  total_count: number;
  done_count: number;
  in_progress_count: number;
  is_processing: boolean;
}

export interface ManagerQueueStatusEvent {
  status: 'in_progress' | 'done' | string;
  target?: string;
  ui_target?: string;
  total_count?: number;
  done_count?: number;
  in_progress_count?: number;
  is_processing?: boolean;
  nodepack_result?: Record<string, string>;
}

export type CustomNodeActionMode =
  | 'install'
  | 'update'
  | 'disable'
  | 'uninstall'
  | 'switch';

async function parseError(response: Response, fallback: string): Promise<Error> {
  const text = await response.text().catch(() => '');
  if (!text) return new Error(fallback);
  try {
    const json = JSON.parse(text) as { error?: string };
    return new Error(json.error || text || fallback);
  } catch {
    return new Error(text || fallback);
  }
}

export async function fetchCustomNodeList(
  mode: CustomNodesDataMode = 'cache',
  options: { skipUpdate?: boolean } = {}
): Promise<CustomNodeListResponse> {
  const params = new URLSearchParams({ mode });
  if (options.skipUpdate !== undefined) {
    params.set('skip_update', String(options.skipUpdate));
  }
  const response = await fetch(`/customnode/getlist?${params.toString()}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw await parseError(response, 'Failed to fetch custom nodes');
  }
  return response.json();
}

export async function fetchCustomNodeMappings(
  mode: CustomNodesDataMode = 'cache'
): Promise<CustomNodeMappingsResponse> {
  const response = await fetch(`/customnode/getmappings?mode=${encodeURIComponent(mode)}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw await parseError(response, 'Failed to fetch custom node mappings');
  }
  return response.json();
}

export async function fetchCustomNodeAlternatives(
  mode: CustomNodesDataMode = 'cache'
): Promise<CustomNodeAlternativesResponse> {
  const response = await fetch(`/customnode/alternatives?mode=${encodeURIComponent(mode)}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw await parseError(response, 'Failed to fetch alternatives');
  }
  return response.json();
}

export async function fetchCustomNodeVersions(nodeId: string): Promise<string[]> {
  const response = await fetch(`/customnode/versions/${encodeURIComponent(nodeId)}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw await parseError(response, 'Failed to fetch versions');
  }
  const data = await response.json() as Array<{ version?: string }>;
  return data.map((item) => item.version).filter((value): value is string => Boolean(value));
}

export async function installCustomNodeViaGitUrl(url: string): Promise<void> {
  const response = await fetch('/customnode/install/git_url', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: url,
  });
  if (!response.ok) {
    throw await parseError(response, 'Failed to install custom node from Git URL');
  }
}

export async function fetchManagerQueueStatus(): Promise<ManagerQueueStatus> {
  const response = await fetch('/manager/queue/status', { cache: 'no-store' });
  if (!response.ok) {
    throw await parseError(response, 'Failed to fetch manager queue status');
  }
  return response.json();
}

// ComfyUI-Manager versions disagree on the HTTP method for the queue-control
// endpoints (reset/start): some register them as POST, others as GET. Sending the
// wrong one yields 405 Method Not Allowed. Try POST first, then fall back to GET
// on a 405 so install/update works across Manager versions. A 405 is rejected by
// the router before the handler runs, so the retry has no side effects.
async function managerQueueControl(path: string, fallbackMessage: string): Promise<void> {
  let response = await fetch(path, { method: 'POST', cache: 'no-store' });
  if (response.status === 405) {
    response = await fetch(path, { method: 'GET', cache: 'no-store' });
  }
  if (!response.ok && response.status !== 201) {
    throw await parseError(response, fallbackMessage);
  }
}

export async function resetManagerQueue(): Promise<void> {
  await managerQueueControl('/manager/queue/reset', 'Failed to reset manager queue');
}

export async function startManagerQueue(): Promise<void> {
  await managerQueueControl('/manager/queue/start', 'Failed to start manager queue');
}

export async function queueCustomNodeAction(
  mode: CustomNodeActionMode,
  node: CustomNodePackageMetadata
): Promise<void> {
  const apiMode = mode === 'switch' ? 'install' : mode;
  const response = await fetch(`/manager/queue/${apiMode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(node),
  });
  if (!response.ok) {
    throw await parseError(response, `Failed to queue ${mode}`);
  }
}


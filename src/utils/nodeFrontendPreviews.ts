import type {
  HistoryOutputImage,
  NodeTypes,
  Workflow,
  WorkflowNode,
} from '@/api/types';
import {
  getImageUrl,
  getMediaThumbnailUrl,
  getPlayableVideoUrl,
} from '@/api/client';
import { getWidgetIndexForInput } from '@/utils/seedUtils';
import { getMediaType } from '@/utils/media';
import { collectScopedWorkflowNodes } from '@/utils/workflowNodes';

const VHS_VIDEO_UPLOAD_NODES = new Set([
  'VHS_LoadVideo',
  'VHS_LoadVideoFFmpeg',
]);
const VHS_VIDEO_PATH_NODES = new Set([
  'VHS_LoadVideoPath',
  'VHS_LoadVideoFFmpegPath',
]);
const VHS_FOLDER_UPLOAD_NODES = new Set(['VHS_LoadImages']);
const VHS_FOLDER_PATH_NODES = new Set(['VHS_LoadImagesPath']);
const VHS_IMAGE_PATH_NODES = new Set(['VHS_LoadImagePath']);
const VHS_PREVIEW_NODES = new Set([
  ...VHS_VIDEO_UPLOAD_NODES,
  ...VHS_VIDEO_PATH_NODES,
  ...VHS_FOLDER_UPLOAD_NODES,
  ...VHS_FOLDER_PATH_NODES,
  ...VHS_IMAGE_PATH_NODES,
  'VHS_VideoCombine',
]);

const OASIS_WIDGET_BY_NODE: Record<string, string> = {
  VideoOasisPreview: 'video_oasis_ui',
  LTX23Oasis: 'ltx23_oasis_ui',
};

const VHS_PARAMETER_NAMES = [
  'force_rate',
  'custom_width',
  'custom_height',
  'frame_load_cap',
  'skip_first_frames',
  'select_every_nth',
  'start_time',
  'image_load_cap',
  'skip_first_images',
] as const;

const vhsPreviewCacheTokens = new WeakMap<WorkflowNode, string>();
let vhsPreviewCacheSequence = 0;

export interface FrontendNodeMediaItem {
  src: string;
  poster?: string;
  mediaType: 'image' | 'video';
  autoPlay: boolean;
  loop: boolean;
  playbackRate?: number;
}

export interface FrontendNodeMediaPreview extends FrontendNodeMediaItem {
  source: 'builtin-input' | 'vhs-widget' | 'oasis-widget';
  playlist?: FrontendNodeMediaItem[];
  activeIndex?: number;
  playMode?: 'off' | 'loop' | 'cycle';
}

export interface NodeFrontendPreviewPolicy {
  hidden: boolean;
  autoPlay: boolean;
  loop: boolean;
  playbackRate?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  const direct = asRecord(value);
  if (direct) return direct;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

export function getNodeWidgetValue(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
  name: string,
): unknown {
  const values = node.widgets_values;
  if (asRecord(values)) return (values as Record<string, unknown>)[name];
  if (!Array.isArray(values) || !nodeTypes) return undefined;
  const index = getWidgetIndexForInput(workflow, nodeTypes, node, name);
  return index == null ? undefined : values[index];
}

function filenameExtension(filename: string): string {
  const clean = filename.split(/[?#]/, 1)[0];
  const index = clean.lastIndexOf('.');
  return index < 0 ? '' : clean.slice(index + 1).toLowerCase();
}

function buildVhsPreviewUrl(params: Record<string, unknown>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
    query.set(key, String(value));
  }
  // The same endpoint and transformation contract used by VHS's desktop DOM
  // widget. In particular, `type=path` and `format=folder` cannot be represented
  // by ComfyUI's stock /view endpoint.
  return `/vhs/viewvideo?${query.toString()}`;
}

function vhsPreviewCacheToken(node: WorkflowNode): string {
  const saved = vhsPreviewCacheTokens.get(node);
  if (saved) return saved;
  vhsPreviewCacheSequence += 1;
  const token = `${Date.now()}-${vhsPreviewCacheSequence}`;
  vhsPreviewCacheTokens.set(node, token);
  return token;
}

function descriptorPreview(
  descriptor: HistoryOutputImage,
  source: FrontendNodeMediaPreview['source'],
  options: Partial<Pick<FrontendNodeMediaPreview, 'autoPlay' | 'loop' | 'playbackRate'>> = {},
): FrontendNodeMediaPreview {
  const asset = getImageUrl(
    descriptor.filename,
    descriptor.subfolder,
    descriptor.type,
    descriptor.cacheToken,
  );
  return {
    src: getPlayableVideoUrl(asset),
    poster: getMediaThumbnailUrl(
      descriptor.filename,
      descriptor.subfolder,
      descriptor.type,
      descriptor.cacheToken,
    ),
    mediaType: getMediaType(descriptor.filename),
    autoPlay: options.autoPlay ?? false,
    loop: options.loop ?? false,
    playbackRate: options.playbackRate,
    source,
  };
}

function resolveVhsPreview(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
): FrontendNodeMediaPreview | null {
  if (!VHS_PREVIEW_NODES.has(node.type)) return null;

  const savedWidget = asRecord(getNodeWidgetValue(workflow, nodeTypes, node, 'videopreview'));
  if (savedWidget?.hidden === true) return null;
  const savedParams = asRecord(savedWidget?.params) ?? {};
  const params: Record<string, unknown> = { ...savedParams };

  let primaryName: 'video' | 'directory' | 'image' | null = null;
  let type = typeof savedParams.type === 'string' ? savedParams.type : 'output';
  let format = typeof savedParams.format === 'string' ? savedParams.format : '';

  if (VHS_VIDEO_UPLOAD_NODES.has(node.type)) {
    primaryName = 'video';
    type = 'input';
  } else if (VHS_VIDEO_PATH_NODES.has(node.type)) {
    primaryName = 'video';
    type = 'path';
  } else if (VHS_FOLDER_UPLOAD_NODES.has(node.type)) {
    primaryName = 'directory';
    type = 'input';
    format = 'folder';
  } else if (VHS_FOLDER_PATH_NODES.has(node.type)) {
    primaryName = 'directory';
    type = 'path';
    format = 'folder';
  } else if (VHS_IMAGE_PATH_NODES.has(node.type)) {
    primaryName = 'image';
    type = 'path';
  }

  // The editable source widget is authoritative. Saved videopreview params are
  // a useful restore fallback, but VHS's desktop callback is not running in the
  // mobile frontend and can therefore be stale after a mobile edit.
  const primaryValue = primaryName
    ? getNodeWidgetValue(workflow, nodeTypes, node, primaryName)
    : undefined;
  const filename = typeof primaryValue === 'string' && primaryValue.trim()
    ? primaryValue.trim()
    : typeof savedParams.filename === 'string'
      ? savedParams.filename.trim()
      : '';
  if (!filename) return null;

  const extension = filenameExtension(filename);
  // Loader source widgets are authoritative, including their extension. A
  // persisted DOM-widget descriptor may describe the previously selected file.
  if (primaryName === 'directory') {
    format = 'folder';
  } else if (primaryName === 'image') {
    // VHS_LoadImagePath deliberately runs every source through FFmpeg.
    format = `video/${extension}`;
  } else if (primaryName === 'video') {
    const animatedImage = ['gif', 'webp', 'avif'].includes(extension);
    format = `${animatedImage ? 'image' : 'video'}/${extension}`;
  }

  params.filename = filename;
  params.type = type;
  params.format = format;
  for (const name of VHS_PARAMETER_NAMES) {
    const current = getNodeWidgetValue(workflow, nodeTypes, node, name);
    if (current !== undefined) params[name] = current;
  }

  // VHS's desktop advanced preview always asks its transcoder for a
  // node-sized stream instead of decoding the original at full resolution.
  // This matters even more on mobile for 4K/8K sources.
  const nodeSize = node.size as unknown;
  const rawNodeWidth = Array.isArray(nodeSize)
    ? Number(nodeSize[0])
    : Number(asRecord(nodeSize)?.['0']);
  const targetWidth = Math.max(64, Math.round((Number.isFinite(rawNodeWidth) ? rawNodeWidth : 320) - 20) * 2);
  const customWidth = finitePositive(params.custom_width);
  const customHeight = finitePositive(params.custom_height);
  params.force_size = customWidth && customHeight
    ? `${targetWidth}x${Math.max(2, Math.round(targetWidth / (customWidth / customHeight)))}`
    : `${targetWidth}x?`;
  params.deadline = 'realtime';
  params.timestamp = vhsPreviewCacheToken(node);

  const paused = savedWidget?.paused === true;
  const isAnimatedImage = format.startsWith('image/');
  // VideoCombine's normal output path is a real Comfy asset. Keep it on the
  // mobile seekable/H.264 gateway for iOS; all input/path/folder previews need
  // VHS's own transformation/path resolver.
  if (node.type === 'VHS_VideoCombine' && type !== 'path') {
    if (isAnimatedImage) {
      return {
        src: getImageUrl(filename, String(savedParams.subfolder ?? ''), type),
        mediaType: 'image',
        autoPlay: false,
        loop: true,
        source: 'vhs-widget',
      };
    }
    return descriptorPreview({
      filename,
      subfolder: typeof savedParams.subfolder === 'string' ? savedParams.subfolder : '',
      type,
    }, 'vhs-widget', { autoPlay: !paused, loop: true });
  }

  // Stock /view can serve uploaded WebP/AVIF directly. VHS's default advanced
  // input preview deliberately transcodes GIF so rate/seek/frame-cap settings
  // remain visible. Path and folder variants always require VHS's resolver.
  if (isAnimatedImage && type === 'input' && extension !== 'gif') {
    return {
      src: getImageUrl(filename, '', type),
      mediaType: 'image',
      autoPlay: false,
      loop: true,
      source: 'vhs-widget',
    };
  }
  return {
    src: buildVhsPreviewUrl(params),
    mediaType: 'video',
    autoPlay: !paused,
    loop: true,
    source: 'vhs-widget',
  };
}

export function getRevealFrontendPreviewUpdate(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
): { widgetName: string; value: Record<string, unknown> } | null {
  if (!VHS_PREVIEW_NODES.has(node.type)) return null;
  const saved = asRecord(getNodeWidgetValue(workflow, nodeTypes, node, 'videopreview'));
  if (saved?.hidden !== true) return null;
  return { widgetName: 'videopreview', value: { ...saved, hidden: false } };
}

export function getOasisWidgetState(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
): { widgetName: string; raw: unknown; state: Record<string, unknown> } | null {
  const widgetName = OASIS_WIDGET_BY_NODE[node.type];
  if (!widgetName) return null;
  const raw = getNodeWidgetValue(workflow, nodeTypes, node, widgetName);
  return { widgetName, raw, state: parseJsonRecord(raw) ?? {} };
}

function resolveOasisPreview(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
): FrontendNodeMediaPreview | null {
  const parsed = getOasisWidgetState(workflow, nodeTypes, node);
  if (!parsed) return null;
  const preview = asRecord(parsed.state.preview);
  const history = Array.isArray(preview?.history) ? preview.history : [];
  if (history.length === 0) return null;
  const requested = typeof preview?.activeIdx === 'number'
    ? Math.trunc(preview.activeIdx)
    : history.length - 1;
  const index = Math.max(0, Math.min(history.length - 1, requested));
  const entries = history.flatMap((value) => {
    const entry = asRecord(value);
    return entry &&
      typeof entry.filename === 'string' &&
      typeof entry.subfolder === 'string' &&
      typeof entry.type === 'string'
      ? [entry as unknown as HistoryOutputImage]
      : [];
  });
  if (entries.length === 0) return null;
  const activeEntry = entries[Math.max(0, Math.min(entries.length - 1, index))];
  const uiState = asRecord(parsed.state.uiState);
  const playMode = ['off', 'loop', 'cycle'].includes(String(uiState?.playMode))
    ? uiState?.playMode as 'off' | 'loop' | 'cycle'
    : uiState?.loop === false
      ? 'off'
      : 'loop';
  const playbackRate = typeof uiState?.speed === 'number' ? uiState.speed : 1;
  const resolved = descriptorPreview(activeEntry, 'oasis-widget', {
    autoPlay: false, // Desktop restores persisted Oasis history passively.
    loop: playMode === 'loop',
    playbackRate,
  });
  return {
    ...resolved,
    playMode,
    playlist: entries.map((entry) => descriptorPreview(entry, 'oasis-widget', {
      autoPlay: false,
      loop: playMode === 'loop',
      playbackRate,
    })),
    activeIndex: Math.max(0, Math.min(entries.length - 1, index)),
  };
}

export function resolveNodeFrontendMediaPreview(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
): FrontendNodeMediaPreview | null {
  const vhs = resolveVhsPreview(workflow, nodeTypes, node);
  if (vhs) return vhs;
  const oasis = resolveOasisPreview(workflow, nodeTypes, node);
  if (oasis) return oasis;

  // Comfy core LoadVideo is an input-side frontend preview rather than an
  // executed UI output. Its upload combo lives under `file`.
  if (node.type === 'LoadVideo') {
    const file = getNodeWidgetValue(workflow, nodeTypes, node, 'file');
    if (typeof file !== 'string' || !file.trim()) return null;
    const { filename, subfolder } = splitInputPath(file.trim());
    return descriptorPreview({ filename, subfolder, type: 'input' }, 'builtin-input', {
      autoPlay: false,
      loop: true,
    });
  }
  return null;
}

function finitePositive(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function splitInputPath(path: string): { filename: string; subfolder: string } {
  const normalized = path.replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return { filename: normalized, subfolder: '' };
  const filename = parts.pop() ?? normalized;
  return { filename, subfolder: parts.join('/') };
}

/** Playback policy for an executed payload owned by a node whose desktop
 * extension also controls preview visibility/lifecycle. */
export function getNodeFrontendPreviewPolicy(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
): NodeFrontendPreviewPolicy | null {
  if (VHS_PREVIEW_NODES.has(node.type)) {
    const saved = asRecord(getNodeWidgetValue(workflow, nodeTypes, node, 'videopreview'));
    return {
      hidden: saved?.hidden === true,
      autoPlay: saved?.paused !== true && saved?.hidden !== true,
      loop: true,
    };
  }
  if (node.type === 'DenoVideoPreview') {
    return { hidden: false, autoPlay: true, loop: true };
  }
  const oasis = getOasisWidgetState(workflow, nodeTypes, node);
  if (oasis) {
    const uiState = asRecord(oasis.state.uiState);
    const playMode = ['off', 'loop', 'cycle'].includes(String(uiState?.playMode))
      ? uiState?.playMode as 'off' | 'loop' | 'cycle'
      : uiState?.loop === false
        ? 'off'
        : 'loop';
    return {
      hidden: false,
      autoPlay: true,
      loop: playMode === 'loop',
      playbackRate: finitePositive(uiState?.speed) ?? 1,
    };
  }
  return null;
}

function randomIoId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mobile-oasis-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Ensure the Oasis side-channel can route results even for nodes created or
 * imported in the mobile frontend, where the pack's desktop DOM widget never
 * got a chance to mint its stable io_id. */
export function ensureOasisPreviewIoIds(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  makeId: () => string = randomIoId,
  reservedIds: Iterable<string> = [],
): Workflow {
  const claimed = new Set(reservedIds);
  let collisionSuffix = 0;
  const mintUniqueId = (): string => {
    const base = makeId();
    let candidate = base;
    while (!candidate || claimed.has(candidate)) {
      collisionSuffix += 1;
      candidate = `${base || 'mobile-oasis'}-${collisionSuffix}`;
    }
    return candidate;
  };
  const patchNodes = (nodes: WorkflowNode[]): [WorkflowNode[], boolean] => {
    let changed = false;
    const next = nodes.map((node) => {
      const parsed = getOasisWidgetState(workflow, nodeTypes, node);
      if (!parsed) return node;
      const currentId = typeof parsed.state.io_id === 'string'
        ? parsed.state.io_id.trim()
        : '';
      if (currentId && !claimed.has(currentId)) {
        claimed.add(currentId);
        return node;
      }
      const ioId = mintUniqueId();
      claimed.add(ioId);
      const value = JSON.stringify({ ...parsed.state, io_id: ioId });
      const values = node.widgets_values;
      changed = true;
      if (asRecord(values)) {
        return { ...node, widgets_values: { ...values, [parsed.widgetName]: value } };
      }
      const index = nodeTypes
        ? getWidgetIndexForInput(workflow, nodeTypes, node, parsed.widgetName)
        : null;
      const array = Array.isArray(values) ? [...values] : [];
      const target = index ?? array.length;
      array[target] = value;
      return { ...node, widgets_values: array };
    });
    return [changed ? next : nodes, changed];
  };

  const [rootNodes, rootChanged] = patchNodes(workflow.nodes);
  let subgraphsChanged = false;
  const subgraphs = (workflow.definitions?.subgraphs ?? []).map((subgraph) => {
    const [nodes, changed] = patchNodes(subgraph.nodes ?? []);
    if (!changed) return subgraph;
    subgraphsChanged = true;
    return { ...subgraph, nodes };
  });
  if (!rootChanged && !subgraphsChanged) return workflow;
  return {
    ...workflow,
    nodes: rootNodes,
    ...(workflow.definitions
      ? { definitions: { ...workflow.definitions, subgraphs } }
      : {}),
  };
}

export function collectOasisPreviewIoIds(
  workflow: Workflow | null,
  nodeTypes: NodeTypes | null,
): string[] {
  if (!workflow) return [];
  return collectScopedWorkflowNodes(workflow).flatMap(({ node }) => {
    const id = getOasisWidgetState(workflow, nodeTypes, node)?.state.io_id;
    return typeof id === 'string' && id.trim() ? [id.trim()] : [];
  });
}

export interface AppendedOasisPreviewResult {
  workflow: Workflow;
  target: OasisPreviewTarget | null;
}

/** Append a side-channel result to the node's serialized scene bar. Keeping
 * the history in the workflow mirrors the desktop DOM widget and means Save,
 * tab parking, and a hard reload all restore the same active preview. */
export function appendOasisPreviewResults(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  ioId: string,
  results: HistoryOutputImage[],
): AppendedOasisPreviewResult {
  const target = findOasisPreviewTargets(workflow, nodeTypes, ioId)[0] ?? null;
  if (!target || results.length === 0) return { workflow, target };
  const parsed = getOasisWidgetState(workflow, nodeTypes, target.node);
  if (!parsed) return { workflow, target: null };
  const preview = asRecord(parsed.state.preview) ?? {};
  const oldHistory = Array.isArray(preview.history) ? preview.history : [];
  const history = [...oldHistory, ...results].slice(-48);
  const value = JSON.stringify({
    ...parsed.state,
    preview: {
      ...preview,
      history,
      activeIdx: history.length - 1,
    },
  });
  const patchNode = (node: WorkflowNode): WorkflowNode => {
    if (node !== target.node) return node;
    if (asRecord(node.widgets_values)) {
      return {
        ...node,
        widgets_values: {
          ...(node.widgets_values as Record<string, unknown>),
          [parsed.widgetName]: value,
        },
      };
    }
    const index = nodeTypes
      ? getWidgetIndexForInput(workflow, nodeTypes, node, parsed.widgetName)
      : null;
    if (index == null) return node;
    const widgets = Array.isArray(node.widgets_values) ? [...node.widgets_values] : [];
    widgets[index] = value;
    return { ...node, widgets_values: widgets };
  };
  if (workflow.nodes.includes(target.node)) {
    return {
      workflow: { ...workflow, nodes: workflow.nodes.map(patchNode) },
      target,
    };
  }
  return {
    workflow: {
      ...workflow,
      definitions: workflow.definitions
        ? {
          ...workflow.definitions,
          subgraphs: (workflow.definitions.subgraphs ?? []).map((subgraph) => ({
            ...subgraph,
            nodes: (subgraph.nodes ?? []).map(patchNode),
          })),
        }
        : workflow.definitions,
    },
    target,
  };
}

export interface OasisPreviewTarget {
  node: WorkflowNode;
  itemKey: string;
}

export function findOasisPreviewTargets(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  ioId: string,
): OasisPreviewTarget[] {
  if (!ioId) return [];
  const targets: OasisPreviewTarget[] = [];
  for (const { node } of collectScopedWorkflowNodes(workflow)) {
    const parsed = getOasisWidgetState(workflow, nodeTypes, node);
    if (parsed?.state.io_id === ioId && node.itemKey) {
      targets.push({ node, itemKey: node.itemKey });
      // A duplicated legacy id is ambiguous. Match desktop's one-handler map:
      // only the first owner receives a result until queue-time repair remints
      // the collision.
      break;
    }
  }
  return targets;
}

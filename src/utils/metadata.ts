
import { isSeedInputName } from '@/utils/seedUtils';

// How many distinct seeds the overlay is willing to name; past this the list
// ends in a "+N" overflow marker. A workflow can carry a seed on a dozen
// nodes; the badge exists to answer "what made this image", not to inventory
// the graph — but it must not pretend four seeds were all there were.
const MAX_SEEDS = 4;

interface Metadata {
  model?: string;
  sampler?: string;
  steps?: number | string;
  cfg?: number | string;
  scheduler?: string;
  /**
   * The distinct seeds the run executed with, in node order, capped at
   * MAX_SEEDS. When the run carried more, the final element is a `"+N"`
   * overflow marker naming how many were left out — the badge renders the list
   * verbatim, so the marker travels in the data rather than asking every
   * renderer to re-derive it.
   */
  seeds?: Array<number | string>;
}

interface PromptNode {
  class_type?: string;
  type?: string;
  inputs?: Record<string, unknown>;
  widgets_values?: unknown[];
}

type LinkValue = [string | number, number];

/**
 * Deterministic order for prompt node ids. Plain graphs use numeric ids;
 * expanded subgraphs produce colon-joined execution ids ("50:7", "50:7:3").
 * Numeric prefix first (parseInt reads it off either form), full string as the
 * tiebreak; ids with no numeric prefix at all sort last, among themselves by
 * string.
 */
function compareNodeIds(a: string, b: string): number {
  const prefixA = parseInt(a, 10);
  const prefixB = parseInt(b, 10);
  const numA = Number.isNaN(prefixA) ? Number.POSITIVE_INFINITY : prefixA;
  const numB = Number.isNaN(prefixB) ? Number.POSITIVE_INFINITY : prefixB;
  if (numA !== numB) return numA - numB;
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isLinkValue(value: unknown): value is LinkValue {
  return Array.isArray(value)
    && value.length >= 2
    && (typeof value[0] === 'string' || typeof value[0] === 'number')
    && typeof value[1] === 'number';
}

function getNodeClass(node: PromptNode): string | null {
  return node.class_type ?? node.type ?? null;
}

function getInputValue(node: PromptNode, keys: string[]): string | number | undefined {
  for (const key of keys) {
    const value = node.inputs?.[key];
    if (isLinkValue(value)) continue;
    if (value !== undefined) return value as string | number;
  }
  return undefined;
}

function getInputString(node: PromptNode, keys: string[]): string | undefined {
  const value = getInputValue(node, keys);
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' ? value : String(value);
}

function resolveLinkedNode(graph: Record<string, PromptNode>, value: unknown): PromptNode | null {
  if (!isLinkValue(value)) return null;
  const targetId = String(value[0]);
  return graph[targetId] ?? null;
}

function getSamplerName(node: PromptNode | null): string | undefined {
  if (!node) return undefined;
  const direct = getInputString(node, ['sampler_name', 'sampler', 'name']);
  if (direct) return direct;
  const className = getNodeClass(node);
  if (className === 'KSamplerSelect' && Array.isArray(node.widgets_values)) {
    const value = node.widgets_values[0];
    return value === undefined || value === null ? undefined : String(value);
  }
  return undefined;
}

function getSchedulerName(node: PromptNode | null): string | undefined {
  if (!node) return undefined;
  const direct = getInputString(node, ['scheduler', 'scheduler_name', 'name']);
  if (direct) return direct;
  const className = getNodeClass(node);
  if (className === 'BasicScheduler' && Array.isArray(node.widgets_values)) {
    const value = node.widgets_values[0];
    return value === undefined || value === null ? undefined : String(value);
  }
  return undefined;
}

function getSchedulerSteps(node: PromptNode | null): string | number | undefined {
  if (!node) return undefined;
  const direct = getInputValue(node, ['steps', 'step_count']);
  if (direct !== undefined) return direct;
  const className = getNodeClass(node);
  if (className === 'BasicScheduler' && Array.isArray(node.widgets_values)) {
    const value = node.widgets_values[1];
    return value === undefined || value === null ? undefined : (value as string | number);
  }
  return undefined;
}

function getCfgValue(node: PromptNode | null): string | number | undefined {
  if (!node) return undefined;
  const direct = getInputValue(node, ['cfg', 'guidance', 'guidance_scale']);
  if (direct !== undefined) return direct;
  if (Array.isArray(node.widgets_values)) {
    const value = node.widgets_values[0];
    return value === undefined || value === null ? undefined : (value as string | number);
  }
  return undefined;
}

export function extractMetadata(prompt: unknown): Metadata {
  const metadata: Metadata = {};
  
  if (!isRecord(prompt) && !Array.isArray(prompt)) return metadata;

  // Handle History format where prompt is an array: [number, string, promptGraph, ...]
  let graph: Record<string, PromptNode> | null = null;
  if (Array.isArray(prompt) && prompt.length >= 3 && isRecord(prompt[2])) {
    graph = prompt[2] as Record<string, PromptNode>;
  } else if (isRecord(prompt)) {
    graph = prompt as Record<string, PromptNode>;
  }
  if (!graph) return metadata;

  // ComfyUI prompt is a dictionary of nodes: { "node_id": { class_type: "...", inputs: {...} } }
  // Expanded-subgraph execution ids ("50:7") are not numbers, and a comparator
  // returning NaN for them makes the whole ordering implementation-defined —
  // sort by the numeric prefix, then the full id string, so every graph shape
  // orders the same way on every engine.
  const nodeEntries = Object.entries(graph);
  const nodes = nodeEntries
    .sort((a, b) => compareNodeIds(a[0], b[0]))
    .map(([, node]) => node as PromptNode);

  // Seeds are read off every node rather than a known sampler class: the value
  // that produced the image often lives on a dedicated seed node (rgthree) or
  // inside an expanded subgraph, and the prompt has it resolved either way.
  const seeds: number[] = [];
  for (const node of nodes) {
    for (const [field, value] of Object.entries(node.inputs ?? {})) {
      if (!isSeedInputName(field)) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (!seeds.includes(value)) seeds.push(value);
    }
  }
  if (seeds.length > MAX_SEEDS) {
    metadata.seeds = [...seeds.slice(0, MAX_SEEDS), `+${seeds.length - MAX_SEEDS}`];
  } else if (seeds.length > 0) {
    metadata.seeds = seeds;
  }

  for (const node of nodes) {
    const classType = getNodeClass(node);
    if (!classType) continue;

    // Checkpoint / Model
    if (classType === 'CheckpointLoaderSimple' || classType === 'CheckpointLoader') {
      const ckpt = node.inputs?.ckpt_name;
      if (typeof ckpt === 'string') {
        metadata.model = ckpt.replace(/\.(safetensors|ckpt|pt)$/i, '');
      } else if (ckpt != null) {
        metadata.model = String(ckpt).replace(/\.(safetensors|ckpt|pt)$/i, '');
      }
    }

    // Sampler
    if (classType === 'KSampler' || classType === 'KSamplerAdvanced') {
      if (metadata.steps === undefined && node.inputs?.steps !== undefined) metadata.steps = node.inputs.steps as number | string;
      if (metadata.cfg === undefined && node.inputs?.cfg !== undefined) metadata.cfg = node.inputs.cfg as number | string;
      if (metadata.sampler === undefined) {
        const samplerName = getInputString(node, ['sampler_name']);
        if (samplerName) metadata.sampler = samplerName;
      }
      if (metadata.scheduler === undefined) {
        const schedulerName = getInputString(node, ['scheduler']);
        if (schedulerName) metadata.scheduler = schedulerName;
      }
    }

    if (classType === 'SamplerCustom' || classType === 'SamplerCustomAdvanced') {
      if (metadata.steps === undefined && node.inputs?.steps !== undefined) metadata.steps = node.inputs.steps as number | string;
      if (metadata.cfg === undefined && node.inputs?.cfg !== undefined) metadata.cfg = node.inputs.cfg as number | string;

      if (metadata.sampler === undefined) {
        const directSampler = getInputString(node, ['sampler', 'sampler_name']);
        const linkedSamplerNode = resolveLinkedNode(graph, node.inputs?.sampler);
        const samplerName = directSampler ?? getSamplerName(linkedSamplerNode);
        if (samplerName) metadata.sampler = samplerName;
      }

      if (metadata.scheduler === undefined) {
        const directScheduler = getInputString(node, ['scheduler', 'scheduler_name']);
        const linkedSchedulerNode = resolveLinkedNode(graph, node.inputs?.sigmas ?? node.inputs?.scheduler);
        const schedulerName = directScheduler ?? getSchedulerName(linkedSchedulerNode);
        if (schedulerName) metadata.scheduler = schedulerName;
      }

      if (metadata.steps === undefined) {
        const linkedSchedulerNode = resolveLinkedNode(graph, node.inputs?.sigmas ?? node.inputs?.scheduler);
        const linkedSteps = getSchedulerSteps(linkedSchedulerNode);
        if (linkedSteps !== undefined) metadata.steps = linkedSteps as number | string;
      }
    }

    if (classType === 'FluxGuidance') {
      if (metadata.cfg === undefined) {
        const cfg = getCfgValue(node);
        if (cfg !== undefined) metadata.cfg = cfg;
      }
    }
  }

  return metadata;
}

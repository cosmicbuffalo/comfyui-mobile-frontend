import type {
  NodeTypes,
  Workflow,
  WorkflowNode,
  WorkflowSubgraphDefinition,
} from '@/api/types';
import { getInstanceNumber } from '@/utils/canonicalWorkflowOps';
import { interpolateInstanceLabel } from '@/utils/subgraphInstanceLabels';
import { getNodeWidgetIndexMap } from '@/utils/workflowInputs';
import { findSeedWidgetIndex, isSeedInputName } from '@/utils/seedUtils';

// A queue item's prompt-preview / diff is computed once at enqueue time
// (see useWorkflow.queueWorkflow) and stored keyed by prompt_id in the queue
// store. The display (QueueCard) renders straight from this structure, so it
// never needs to reference the persisted/original workflow at view time.

export type DiffSegmentType = 'equal' | 'added' | 'removed';

export interface DiffSegment {
  type: DiffSegmentType;
  text: string;
}

/** A prompt (text-bearing) node — always shown in full, with inline diff. */
export interface QueuePromptEntry {
  nodeId: string;
  label: string;
  order: number;
  segments: DiffSegment[];
  changed: boolean;
}

/** A single changed widget field on a non-prompt node (old -> new). */
export interface QueueFieldChange {
  field: string;
  before: string;
  after: string;
}

/** A non-prompt node with one or more changed widget fields. */
export interface QueueNodeChange {
  nodeId: string;
  label: string;
  order: number;
  changes: QueueFieldChange[];
}

/** A seed a run actually executed with, read off the built prompt. */
export interface QueueSeedEntry {
  /** Execution id of the node that ran with this seed ("50:7" inside a subgraph). */
  nodeId: string;
  label: string;
  /** Input name the seed was supplied under ("seed", "noise_seed", ...). */
  field: string;
  value: number;
}

export interface QueueWorkflowDiff {
  /** Every prompt node in the workflow (sorted by label), with inline diff. */
  prompts: QueuePromptEntry[];
  /** Non-prompt nodes that changed vs the base (ordered by node order). */
  nodeChanges: QueueNodeChange[];
  /** The seeds this run executed with. Recorded from the built prompt rather
   *  than diffed out of the workflow: a frontend-generated seed often never
   *  reaches widgets_values at all (subgraph-promoted and special-value seeds
   *  are applied as ephemeral overrides at queue time), and seeds on nodes
   *  inside a subgraph definition are invisible to the node-level diff, which
   *  only walks the top-level nodes. Absent on items enqueued before this
   *  shipped, or from another device. */
  seeds?: QueueSeedEntry[];
}

// Above this token-pair product the O(m*n) LCS is skipped for a coarse diff.
const WORD_DIFF_BUDGET = 250_000;

// Tokenize into whitespace runs, words, and punctuation runs (lossless join).
// Words keep internal apostrophes/hyphens/underscores ("don't", "well-known")
// but trailing punctuation ("cat,") is split off so only the punctuation diffs.
const TOKEN_RE = /\s+|[\p{L}\p{N}]+(?:['’\-_][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]+/gu;

function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

/**
 * Word-level diff that preserves whitespace so equal+added segments
 * reconstruct the full current text exactly.
 */
export function wordDiff(before: string, after: string): DiffSegment[] {
  if (before === after) {
    return after ? [{ type: 'equal', text: after }] : [];
  }

  const a = tokenize(before);
  const b = tokenize(after);
  const m = a.length;
  const n = b.length;

  const out: DiffSegment[] = [];
  const push = (type: DiffSegmentType, text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };

  // Coarse fallback for pathologically long texts: removed-block then added-block.
  if (m * n > WORD_DIFF_BUDGET) {
    push('removed', before);
    push('added', after);
    return out;
  }

  // LCS table (suffix form): dp[i][j] = LCS length of a[i:], b[j:].
  const dp: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('removed', a[i]);
      i++;
    } else {
      push('added', b[j]);
      j++;
    }
  }
  while (i < m) push('removed', a[i++]);
  while (j < n) push('added', b[j++]);
  return out;
}

type SubgraphDefinitions = Map<string, WorkflowSubgraphDefinition>;

function subgraphDefinitions(workflow: Workflow | null | undefined): SubgraphDefinitions {
  return new Map(
    (workflow?.definitions?.subgraphs ?? []).map((sg) => [String(sg.id), sg]),
  );
}

function nodeLabel(node: WorkflowNode, definitions?: SubgraphDefinitions): string {
  const title = typeof node.title === 'string' ? node.title.trim() : '';
  if (title) return title;
  // A subgraph placeholder's `type` is its definition's UUID, which names
  // nothing to a reader. Fall back to the instance name the workflow panel
  // shows on the card — {n} token resolved against this instance's number,
  // the same way NodeCard builds it.
  const name = definitions?.get(String(node.type))?.name?.trim();
  if (name) return interpolateInstanceLabel(name, getInstanceNumber(node)) || name;
  if (node.type) return node.type;
  return `Node ${node.id}`;
}

interface NamedWidget {
  name: string;
  value: unknown;
}

/** Map a node's widgets_values array to named widgets (best effort). */
function getNamedWidgets(workflow: Workflow, node: WorkflowNode): NamedWidget[] {
  const values = node.widgets_values;
  if (values && !Array.isArray(values) && typeof values === 'object') {
    return Object.entries(values as Record<string, unknown>).map(([name, value]) => ({ name, value }));
  }
  if (!Array.isArray(values)) return [];

  const indexMap = getNodeWidgetIndexMap(workflow, node);
  if (indexMap) {
    const named: NamedWidget[] = [];
    for (const [name, index] of Object.entries(indexMap)) {
      if (index >= 0 && index < values.length) named.push({ name, value: values[index] });
    }
    if (named.length > 0) return named;
  }
  return values.map((value, index) => ({ name: `widget ${index}`, value }));
}

const PROMPT_FIELD_RE = /^(text|prompt|wildcard_text|positive|negative|text_g|text_l)$/i;
const PROMPT_TYPE_RE = /clip.*text.*encode|text.*encode|prompt/i;

interface PromptText {
  text: string;
  field: string;
}

/** Resolve a node's prompt text (if it is a text-bearing prompt node). */
function getPromptText(named: NamedWidget[], node: WorkflowNode): PromptText | null {
  const byName = named.find(
    (w) => PROMPT_FIELD_RE.test(w.name) && typeof w.value === 'string',
  );
  if (byName) return { text: byName.value as string, field: byName.name };

  if (PROMPT_TYPE_RE.test(node.type)) {
    const firstString = named.find((w) => typeof w.value === 'string');
    if (firstString) return { text: firstString.value as string, field: firstString.name };
  }
  return null;
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Diff the whole `current` workflow against `base`. Prompt (text) nodes are
 * always returned in full with an inline word-diff; every other node that has
 * a changed widget value is returned as an old->new field change.
 *
 * When `base` is null (e.g. a queue item with no recorded base — loaded from an
 * output, or enqueued on another device), prompts come back with all-equal
 * segments (full text, no highlights) and there are no node changes.
 */
export function computeQueueWorkflowDiff(
  base: Workflow | null,
  current: Workflow,
): QueueWorkflowDiff {
  const baseNodes = new Map<number, WorkflowNode>();
  if (base?.nodes) {
    for (const node of base.nodes) baseNodes.set(node.id, node);
  }

  const prompts: QueuePromptEntry[] = [];
  const nodeChanges: QueueNodeChange[] = [];

  const definitions = subgraphDefinitions(current);
  const currentNodes = current.nodes ?? [];
  currentNodes.forEach((node, index) => {
    if (node.mode === 4) return; // bypassed nodes are not enqueued

    const order = typeof node.order === 'number' ? node.order : index;
    const named = getNamedWidgets(current, node);
    const baseNode = baseNodes.get(node.id);
    const baseNamed = baseNode && base ? getNamedWidgets(base, baseNode) : [];

    const promptInfo = getPromptText(named, node);
    if (promptInfo) {
      // With no recorded base, show the full prompt without highlights.
      const segments = base
        ? wordDiff(baseNode ? getPromptText(baseNamed, baseNode)?.text ?? '' : '', promptInfo.text)
        : promptInfo.text
          ? [{ type: 'equal' as const, text: promptInfo.text }]
          : [];
      prompts.push({
        nodeId: String(node.id),
        label: nodeLabel(node, definitions),
        order,
        segments,
        changed: segments.some((s) => s.type !== 'equal'),
      });
      return;
    }

    // Non-prompt node: report changed widget fields (skip nodes absent in base).
    if (!baseNode) return;
    const baseByName = new Map(baseNamed.map((w) => [w.name, w.value]));
    const changes: QueueFieldChange[] = [];
    for (const w of named) {
      if (!baseByName.has(w.name)) continue;
      const after = stringifyValue(w.value);
      const before = stringifyValue(baseByName.get(w.name));
      if (before !== after) changes.push({ field: w.name, before, after });
    }
    if (changes.length > 0) {
      nodeChanges.push({
        nodeId: String(node.id),
        label: nodeLabel(node, definitions),
        order,
        changes,
      });
    }
  });

  prompts.sort((a, b) => a.label.localeCompare(b.label) || a.order - b.order);
  nodeChanges.sort((a, b) => a.order - b.order);
  return { prompts, nodeChanges };
}

/** Widget indices on a node whose value is a (randomizable) seed. */
function seedWidgetIndices(
  workflow: Workflow,
  node: WorkflowNode,
  nodeTypes: NodeTypes | null,
): Set<number> {
  const indices = new Set<number>();
  const indexMap = getNodeWidgetIndexMap(workflow, node);
  if (indexMap) {
    for (const [name, index] of Object.entries(indexMap)) {
      if (name.toLowerCase().includes('seed')) indices.add(index);
    }
  }
  if (nodeTypes) {
    const seedIndex = findSeedWidgetIndex(workflow, nodeTypes, node);
    if (seedIndex != null && seedIndex >= 0) indices.add(seedIndex);
  }
  return indices;
}

/**
 * Signature of every node's widget values with seed widgets blanked out. Used
 * to decide whether an "intentional" (non-seed) change happened between two
 * enqueues. Deliberately ignores layout/links/titles — only the widget values
 * the diff preview actually reports.
 */
function nonSeedWidgetSignature(workflow: Workflow, nodeTypes: NodeTypes | null): string {
  const nodes = workflow.nodes ?? [];
  return JSON.stringify(
    nodes.map((node) => {
      let values = node.widgets_values;
      if (Array.isArray(values)) {
        const seeds = seedWidgetIndices(workflow, node, nodeTypes);
        if (seeds.size > 0) values = values.map((v, i) => (seeds.has(i) ? null : v));
      }
      return [node.id, node.type, values];
    }),
  );
}

/** True when two workflows differ in any widget value other than a seed. */
export function nonSeedWidgetsDiffer(
  a: Workflow,
  b: Workflow,
  nodeTypes: NodeTypes | null = null,
): boolean {
  return nonSeedWidgetSignature(a, nodeTypes) !== nonSeedWidgetSignature(b, nodeTypes);
}

/**
 * Pick the base to diff a freshly-enqueued workflow against, implementing the
 * "same intentional diff until you make a non-seed change" rule:
 *
 *  - If a non-seed widget changed since the last enqueue, advance the base to
 *    that last-enqueued snapshot (so the new item shows only the new delta).
 *  - Otherwise keep the existing base (falling back to the original/persisted
 *    workflow on the very first enqueue). Seed-only changes between enqueues do
 *    NOT advance the base, so repeated enqueues keep showing the same
 *    intentional diff (each against the original snapshot) while still showing
 *    their own per-run seed difference.
 *
 * Returns the base to diff against and the base to persist for next time.
 */
export function selectDiffBase(
  current: Workflow,
  lastEnqueued: Workflow | null,
  diffBase: Workflow | null,
  original: Workflow | null,
  nodeTypes: NodeTypes | null = null,
): { base: Workflow | null; nextDiffBase: Workflow | null } {
  if (lastEnqueued && nonSeedWidgetsDiffer(current, lastEnqueued, nodeTypes)) {
    return { base: lastEnqueued, nextDiffBase: lastEnqueued };
  }
  return { base: diffBase ?? original ?? null, nextDiffBase: diffBase };
}

/**
 * Resolve an execution id to a human label using the canonical workflow.
 * "814:1852" is node 1852 inside the subgraph placed at node 814, so it reads
 * "<placeholder title> / <inner title>" — two samplers inside the same subgraph
 * type would otherwise be indistinguishable.
 */
function resolveExecutionLabel(
  key: string,
  workflow: Workflow | null | undefined,
): string | null {
  if (!workflow) return null;
  const definitions = subgraphDefinitions(workflow);
  let nodes: WorkflowNode[] = workflow.nodes ?? [];
  const parts: string[] = [];
  for (const segment of key.split(':')) {
    const node = nodes.find((candidate) => String(candidate.id) === segment);
    if (!node) break;
    parts.push(nodeLabel(node, definitions));
    nodes = definitions.get(String(node.type))?.nodes ?? [];
  }
  return parts.length > 0 ? parts.join(' / ') : null;
}

/**
 * The seeds a run actually executes with, read off the API prompt — the one
 * place every seed is already resolved (control_after_generate rolls,
 * special-value resolution, subgraph-promoted overrides, and nodes that live
 * inside a subgraph definition).
 *
 * Works on a prompt we just built and on one read back from the queue/history,
 * so a run that predates the recording still gets its seeds. `workflow` is the
 * canonical (unexpanded) workflow, used only for labels.
 */
export function collectQueueSeeds(
  prompt: Record<string, unknown>,
  workflow?: Workflow | null,
): QueueSeedEntry[] {
  const seeds: QueueSeedEntry[] = [];
  for (const [key, entry] of Object.entries(prompt)) {
    if (!entry || typeof entry !== 'object') continue;
    const { inputs, class_type: classType } = entry as {
      inputs?: unknown;
      class_type?: unknown;
    };
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue;
    const label =
      resolveExecutionLabel(key, workflow)
      ?? (typeof classType === 'string' && classType ? classType : `Node ${key}`);
    for (const [field, value] of Object.entries(inputs as Record<string, unknown>)) {
      // A link is an array ([sourceId, slot]); only a literal number is a seed
      // this run owns.
      if (!isSeedInputName(field)) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      seeds.push({ nodeId: key, label, field, value });
    }
  }
  return seeds;
}

/**
 * Drop widget changes that the seeds list already reports. A randomized seed on
 * a top-level node lands in widgets_values, so without this it shows up twice:
 * once as an "old -> new" change the user never made, and once as the seed the
 * run used.
 */
export function withoutSeedFieldChanges(
  nodeChanges: QueueNodeChange[],
  seeds: QueueSeedEntry[],
): QueueNodeChange[] {
  if (seeds.length === 0) return nodeChanges;
  // Keyed by the ROOT node id: a seed executed inside a subgraph reports
  // under its execution id ("30:3"), but the widget its write-back changed
  // sits on the placeholder ("30") — the only node the workflow diff walks.
  const reported = new Set(
    seeds.map((s) => `${s.nodeId.split(':')[0]}\u0000${s.value}`),
  );
  const out: QueueNodeChange[] = [];
  for (const node of nodeChanges) {
    // Match on the field name too: a deliberate edit to a NAMED non-seed
    // widget that happens to collide with the node's seed value must survive.
    // A fallback "widget N" label means the input name is unknown, so the
    // value match keeps the last word there.
    const changes = node.changes.filter(
      (change) =>
        !(isSeedInputName(change.field) || /^widget \d+$/.test(change.field)) ||
        !reported.has(`${node.nodeId}\u0000${change.after}`),
    );
    if (changes.length > 0) out.push({ ...node, changes });
  }
  return out;
}

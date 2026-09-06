/**
 * Workflow lineage: a stable identity shared by every descendant of a workflow.
 *
 * A workflow rarely lives as one file. The usual loop is open → tweak → save
 * under a new name → generate → later re-open from one of those outputs →
 * tweak again. Every copy is the same workflow to the user, and a different,
 * unrelated workflow to the app: per-workflow state is keyed by
 * `buildWorkflowCacheKey`, a hash of the sorted node-type multiset, so adding
 * or removing a single node orphans everything attached to it.
 *
 * A lineage is a uuid minted the first time a workflow is seen without one and
 * carried in `workflow.extra`, which survives save-as, queueing, PNG/WEBP
 * embedding, and re-open-from-output. State that belongs to "this workflow"
 * rather than "this file" hangs off the lineage instead.
 *
 * Two structural comparisons live here and must not be confused:
 *
 * - **Lineage assignment** is fuzzy (`identityOverlap`) and answers "which
 *   family?". It runs only for a workflow arriving with no stamp.
 * - **Member identity** is exact (`buildStructuralFingerprint`) and answers
 *   "which variant?". "Never before seen structure" is meaningless without it,
 *   and repeat opens of the same workflow must dedupe onto one member.
 */
import type {
  Workflow,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphLink,
} from '@/api/types';
import {
  getLinkOriginId,
  getLinkOriginSlot,
  getLinkTargetId,
  getLinkTargetSlot,
} from '@/utils/canonicalWorkflowOps';

/** Key under `workflow.extra` carrying the stamp. */
export const LINEAGE_EXTRA_KEY = 'mobile_lineage';

/**
 * Minimum overlap for an unstamped workflow to join an existing lineage,
 * measured against the smaller of the two node sets so a workflow still
 * matches the larger one it grew into.
 */
export const LINEAGE_MATCH_RATIO = 0.5;

/**
 * Floor on the shared node count regardless of ratio. Node ids start at 1 and
 * the type vocabulary is small, so two independently authored workflows share
 * `1:CheckpointLoaderSimple` / `8:VAEDecode` and friends by coincidence — on a
 * short workflow that alone clears 50%.
 */
export const LINEAGE_MATCH_MIN_SHARED = 4;

export interface LineageStamp {
  /** Lineage (family) id. */
  lineage: string;
  /** Member (structural variant) id within that lineage. */
  member: string;
}

export interface LineageMember {
  id: string;
  /** Member id this one was minted from; null for a lineage's founding member. */
  parent: string | null;
  /** Exact structural fingerprint — the member's identity. */
  fingerprint: string;
  /** Sorted `id:type` pairs, kept so fuzzy matching can pick the closest member. */
  identity: string[];
  createdAt: number;
}

export interface LineageRecord {
  id: string;
  members: LineageMember[];
  /**
   * Flat for now: one bookmark set shared by the whole family. The per-member
   * branching semantics (inherit on mint, adds propagate to ancestors, deletes
   * stay local) are deliberately deferred — the member tree and its parent
   * pointers are recorded from the start because that history cannot be
   * backfilled, while the propagation rules can change at any time.
   */
  bookmarks: string[];
  createdAt: number;
  updatedAt: number;
}

export interface LineageRegistry {
  version: 1;
  lineages: LineageRecord[];
}

export function createEmptyRegistry(): LineageRegistry {
  return { version: 1, lineages: [] };
}

/* ── Structural fingerprint ─────────────────────────────────────────────── */

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) + value.charCodeAt(i);
    hash &= 0xffffffff;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function collectScopes(workflow: Workflow): Array<{
  scope: string;
  nodes: WorkflowNode[];
  links: Array<WorkflowLink | WorkflowSubgraphLink>;
}> {
  const scopes = [
    {
      scope: '',
      nodes: workflow.nodes ?? [],
      links: (workflow.links ?? []) as Array<WorkflowLink | WorkflowSubgraphLink>,
    },
  ];
  for (const subgraph of workflow.definitions?.subgraphs ?? []) {
    scopes.push({
      scope: subgraph.id,
      nodes: subgraph.nodes ?? [],
      links: (subgraph.links ?? []) as Array<WorkflowLink | WorkflowSubgraphLink>,
    });
  }
  return scopes;
}

/**
 * Exact structural identity: node ids + types and link endpoints, per scope.
 *
 * Deliberately excludes:
 * - **link ids** — `validateAndNormalizeWorkflow` repairs link ids and subgraph
 *   linkIds on load, so including them would mint a member for every file that
 *   needed repair.
 * - **positions** — mobile list order derives from `node.pos`, so reordering
 *   the list would otherwise fork the lineage on every drag.
 * - **widget values, sizes, collapsed flags** — not structure.
 * - **`mode`** — bypass/mute is a run-time toggle, not a new variant.
 *
 * Must be computed on the workflow as loaded (post-normalization, post
 * marketing-note strip), never on raw JSON off disk or out of a PNG: the
 * credit note is stripped on load and re-injected at execution, so a raw
 * output's workflow carries a node the canonical state does not — fingerprint
 * that and every opened output forks the lineage.
 */
export function buildStructuralFingerprint(workflow: Workflow): string {
  const parts: string[] = [];
  for (const { scope, nodes, links } of collectScopes(workflow)) {
    const nodeParts = nodes
      .map((node) => `${node.id}:${node.type}`)
      .sort();
    const linkParts = links
      .map(
        (link) =>
          `${getLinkOriginId(link)}.${getLinkOriginSlot(link)}>` +
          `${getLinkTargetId(link)}.${getLinkTargetSlot(link)}`,
      )
      .sort();
    parts.push(`${scope}|n:${nodeParts.join(',')}|l:${linkParts.join(',')}`);
  }
  // Subgraph definition order is not meaningful; sort so two orderings of the
  // same definitions do not read as different structures.
  parts.sort();
  return `lm_${hashString(parts.join('||'))}`;
}

/* ── Fuzzy identity ─────────────────────────────────────────────────────── */

/** Sorted, deduped `id:type` pairs across root and every subgraph definition. */
export function collectNodeIdentities(workflow: Workflow): string[] {
  const seen = new Set<string>();
  for (const { scope, nodes } of collectScopes(workflow)) {
    for (const node of nodes) {
      seen.add(scope ? `${scope}/${node.id}:${node.type}` : `${node.id}:${node.type}`);
    }
  }
  return [...seen].sort();
}

/**
 * Shared fraction of two identity sets, over the smaller set.
 *
 * Using the smaller side (rather than the union, as Jaccard would) is what
 * lets a small workflow still match the much larger one it grew into. The
 * absolute `LINEAGE_MATCH_MIN_SHARED` floor is what stops that same choice
 * from matching any tiny workflow into any big one that happens to contain a
 * few of its nodes.
 */
export function identityOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const smaller = a.length <= b.length ? a : b;
  const larger = new Set(a.length <= b.length ? b : a);
  let shared = 0;
  for (const entry of smaller) {
    if (larger.has(entry)) shared += 1;
  }
  return shared / smaller.length;
}

export function countSharedIdentities(a: string[], b: string[]): number {
  const larger = new Set(b);
  let shared = 0;
  for (const entry of a) {
    if (larger.has(entry)) shared += 1;
  }
  return shared;
}

export interface LineageMatch {
  lineageId: string;
  /** Closest member — the parent a newly minted member should hang off. */
  memberId: string;
  ratio: number;
  /** Node identities in one set but not the other; lower is closer. */
  distance: number;
}

/**
 * Best lineage for an unstamped workflow, or null to mint a new one.
 *
 * Resolves to the best-matching *member*, not the lineage root: a workflow
 * arriving from desktop ComfyUI or a download would otherwise attach at the
 * root and inherit the oldest ancestor's state.
 *
 * Admission is by `identityOverlap` (plus the shared-count floor), but ranking
 * is by symmetric difference, not by that ratio. Measuring over the smaller
 * set is what lets a workflow match the larger one it grew into — and it also
 * scores *every* member whose nodes are a subset of the candidate at a perfect
 * 1.0, so ranking by it would always pick the smallest, i.e. the oldest
 * ancestor. Distance picks the variant that actually looks most like this one.
 */
export function findLineageMatch(
  registry: LineageRegistry,
  identity: string[],
): LineageMatch | null {
  let best: LineageMatch | null = null;
  for (const lineage of registry.lineages) {
    for (const member of lineage.members) {
      const ratio = identityOverlap(identity, member.identity);
      if (ratio < LINEAGE_MATCH_RATIO) continue;
      const shared = countSharedIdentities(identity, member.identity);
      if (shared < LINEAGE_MATCH_MIN_SHARED) continue;
      const distance = identity.length + member.identity.length - 2 * shared;
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance && ratio > best.ratio)
      ) {
        best = { lineageId: lineage.id, memberId: member.id, ratio, distance };
      }
    }
  }
  return best;
}

/* ── Stamp read/write ───────────────────────────────────────────────────── */

export function readLineageStamp(workflow: Workflow | null | undefined): LineageStamp | null {
  const raw = workflow?.extra?.[LINEAGE_EXTRA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const { lineage, member } = raw as Partial<LineageStamp>;
  if (typeof lineage !== 'string' || !lineage) return null;
  if (typeof member !== 'string' || !member) return null;
  return { lineage, member };
}

/** Return a copy of `workflow` carrying `stamp` (no mutation of the input). */
export function withLineageStamp(workflow: Workflow, stamp: LineageStamp): Workflow {
  const existing = readLineageStamp(workflow);
  if (existing && existing.lineage === stamp.lineage && existing.member === stamp.member) {
    return workflow;
  }
  return {
    ...workflow,
    extra: {
      ...(workflow.extra ?? {}),
      [LINEAGE_EXTRA_KEY]: { lineage: stamp.lineage, member: stamp.member },
    },
  };
}

/* ── Registry normalization ─────────────────────────────────────────────── */

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function normalizeMember(raw: unknown): LineageMember | null {
  if (!raw || typeof raw !== 'object') return null;
  const member = raw as Partial<LineageMember>;
  if (typeof member.id !== 'string' || !member.id) return null;
  if (typeof member.fingerprint !== 'string' || !member.fingerprint) return null;
  return {
    id: member.id,
    parent: typeof member.parent === 'string' && member.parent ? member.parent : null,
    fingerprint: member.fingerprint,
    identity: isStringArray(member.identity) ? member.identity : [],
    createdAt: typeof member.createdAt === 'number' ? member.createdAt : 0,
  };
}

/**
 * Coerce whatever came back from the server into a usable registry. This is
 * shared, roaming state written by other devices and possibly a newer version
 * of the app, so anything unrecognized is dropped rather than trusted.
 */
export function normalizeRegistry(raw: unknown): LineageRegistry {
  if (!raw || typeof raw !== 'object') return createEmptyRegistry();
  const lineages = (raw as { lineages?: unknown }).lineages;
  if (!Array.isArray(lineages)) return createEmptyRegistry();

  const seenLineageIds = new Set<string>();
  const normalized: LineageRecord[] = [];
  for (const entry of lineages) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Partial<LineageRecord>;
    if (typeof record.id !== 'string' || !record.id) continue;
    if (seenLineageIds.has(record.id)) continue;

    const members: LineageMember[] = [];
    const seenMemberIds = new Set<string>();
    for (const rawMember of Array.isArray(record.members) ? record.members : []) {
      const member = normalizeMember(rawMember);
      if (!member || seenMemberIds.has(member.id)) continue;
      seenMemberIds.add(member.id);
      members.push(member);
    }
    if (members.length === 0) continue;

    // A parent pointer into a member that did not survive normalization would
    // strand the member; re-root it rather than dropping the branch.
    for (const member of members) {
      if (member.parent && !seenMemberIds.has(member.parent)) member.parent = null;
    }

    seenLineageIds.add(record.id);
    normalized.push({
      id: record.id,
      members,
      bookmarks: isStringArray(record.bookmarks) ? [...new Set(record.bookmarks)] : [],
      createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
    });
  }
  return { version: 1, lineages: normalized };
}

/**
 * Union of a local and a remote registry.
 *
 * The registry is a single shared document, so a plain last-write-wins push
 * would let one device's copy erase every family another device recorded —
 * including families this device has simply never opened. Merging keeps both
 * sides: lineages and members union by id, and a lineage present on both sides
 * takes its bookmark set from whichever copy was touched last.
 *
 * This does not make concurrent edits safe in general — two devices changing
 * the *same* lineage's bookmarks between syncs still resolve by `updatedAt`,
 * so the older edit is lost. It only guarantees that unrelated state survives.
 */
export function mergeRegistries(
  local: LineageRegistry,
  remote: LineageRegistry,
): LineageRegistry {
  const byId = new Map<string, LineageRecord>();
  for (const lineage of remote.lineages) {
    byId.set(lineage.id, { ...lineage, members: [...lineage.members] });
  }
  for (const lineage of local.lineages) {
    const existing = byId.get(lineage.id);
    if (!existing) {
      byId.set(lineage.id, { ...lineage, members: [...lineage.members] });
      continue;
    }
    const seenMembers = new Set(existing.members.map((member) => member.id));
    const members = [...existing.members];
    for (const member of lineage.members) {
      if (seenMembers.has(member.id)) continue;
      seenMembers.add(member.id);
      members.push(member);
    }
    const localIsNewer = lineage.updatedAt > existing.updatedAt;
    byId.set(lineage.id, {
      ...existing,
      members,
      bookmarks: localIsNewer ? [...lineage.bookmarks] : existing.bookmarks,
      createdAt: Math.min(
        existing.createdAt || lineage.createdAt,
        lineage.createdAt || existing.createdAt,
      ),
      updatedAt: Math.max(existing.updatedAt, lineage.updatedAt),
    });
  }
  return { version: 1, lineages: [...byId.values()] };
}

export function findLineageById(
  registry: LineageRegistry,
  lineageId: string,
): LineageRecord | null {
  return registry.lineages.find((lineage) => lineage.id === lineageId) ?? null;
}

export function findMemberByFingerprint(
  lineage: LineageRecord,
  fingerprint: string,
): LineageMember | null {
  return lineage.members.find((member) => member.fingerprint === fingerprint) ?? null;
}

export function generateLineageId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  // jsdom in older environments, and any context without a secure origin.
  return `lin-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

import type { Workflow, WorkflowInput, WorkflowLink, WorkflowNode } from '@/api/types';
import { computeNodeGroupsFor } from '@/utils/nodeGroups';

/**
 * Use Everywhere (`cg-use-everywhere`) broadcast resolution.
 *
 * UE nodes are "broadcasters": each of their connected inputs re-publishes its
 * upstream source, and every *unconnected* input elsewhere in the graph is a
 * candidate sink. Matching is by type, then optional title/input/group regexes
 * and group/colour restrictions, then priority.
 *
 * The pack's Python nodes are pure no-ops with no outputs — all of this lives in
 * the desktop frontend's JavaScript, which materialises the virtual links only
 * for the duration of `graphToPrompt` and then removes them again. This module
 * is the mobile equivalent: a pure resolver whose result the prompt builder and
 * the connection UI consult, so nothing is ever written into the graph.
 *
 * Port of `cg-use-everywhere/js/use_everywhere_graph_analysis.js → analyse_graph`
 * and `use_everywhere_classes.js → UseEverywhereList`.
 *
 * The same problem shape as the KJNodes Set/Get relays — see `setGetNodes.ts` /
 * `collapseSetGetNodes.ts` for the precedent this follows.
 */

/** A single broadcast published by one slot of one UE controller node. */
interface UeBroadcast {
  controllerId: number;
  /** Index of the controller's input (or output, for `ue_convert`) that publishes this. */
  controllerSlot: number;
  /** The real upstream node feeding the broadcast, already resolved past bypasses. */
  originId: number;
  originSlot: number;
  type: string;
  priority: number;
  titleRegex: UeRegex | null;
  inputRegex: UeRegex | null;
  /** Node ids this broadcast may reach, or null for "anywhere". */
  restrictTo: Set<number> | null;
  stringToCombo: boolean;
  sendToAny: boolean;
  /** Extra name-matching rule applied when one controller broadcasts a type twice. */
  additionalRequirement: ((input: WorkflowInput, node: WorkflowNode) => boolean) | null;
}

interface UeRegex {
  regex: RegExp;
  invert: boolean;
}

/** Where an unconnected input actually gets its data from. */
export interface UeResolution {
  /** The real upstream node — what the prompt should reference and the UI should jump to. */
  originId: number;
  originSlot: number;
  type: string;
  /** The UE node that routes it, for labelling ("via Anything Everywhere #134"). */
  controllerId: number;
  controllerSlot: number;
}

export type UeLinkMap = Map<string, UeResolution>;

/** Map key for a sink slot. */
export function ueSlotKey(nodeId: number, slotIndex: number): string {
  return `${nodeId}:${slotIndex}`;
}

// ---------------------------------------------------------------------------
// Node classification
// ---------------------------------------------------------------------------

function nodeClass(node: WorkflowNode): string {
  const sr = node.properties?.['Node name for S&R'];
  return typeof sr === 'string' && sr ? sr : node.type;
}

/**
 * A no-op broadcast-only UE node ("Anything Everywhere", "Anything Everywhere3",
 * "Anything Everywhere?", "Prompts Everywhere", "Seed Everywhere").
 *
 * These execute to nothing and declare no outputs, so they must be dropped from
 * the prompt. Note this is NOT the same as "can broadcast": UE also converts
 * `Seed Everywhere` into a real `PrimitiveInt` carrying `ue_convert`, and any
 * node can be flagged that way. Such nodes execute normally — see `canBroadcast`.
 */
export function isUseEverywhereNode(node: WorkflowNode): boolean {
  const type = nodeClass(node);
  if (!type) return false;
  return (
    type.startsWith('Anything Everywhere') ||
    type === 'Seed Everywhere' ||
    type === 'Prompts Everywhere'
  );
}

/** Whether this node publishes broadcasts (a UE node, or any node flagged `ue_convert`). */
export function canBroadcast(node: WorkflowNode): boolean {
  return Boolean(node.properties?.ue_convert) || isUseEverywhereNode(node);
}

/** Whether any scope of the workflow contains a broadcaster. */
export function workflowHasUseEverywhereNodes(
  workflow: Workflow | null | undefined,
): boolean {
  if (!workflow) return false;
  const scopeHas = (nodes?: WorkflowNode[]) => (nodes ?? []).some(canBroadcast);
  if (scopeHas(workflow.nodes)) return true;
  return (workflow.definitions?.subgraphs ?? []).some((sg) => scopeHas(sg.nodes));
}

// ---------------------------------------------------------------------------
// Property access
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a UE setting. Files saved before pack v7.0 keep these directly on
 * `properties` (beach.json does exactly this — `group_restricted` sits at the top
 * level with no `ue_properties` object at all); newer ones nest them under
 * `properties.ue_properties`. Nested wins where both exist.
 */
function ueProp(node: WorkflowNode, key: string): unknown {
  const nested = node.properties?.ue_properties;
  if (isRecord(nested) && nested[key] !== undefined) return nested[key];
  return node.properties?.[key];
}

function ueRegex(node: WorkflowNode, key: string): UeRegex | null {
  const source = ueProp(node, `${key}_regex`);
  if (typeof source !== 'string' || !source || source === '.*') return null;
  try {
    return { regex: new RegExp(source), invert: Boolean(ueProp(node, `${key}_regex_invert`)) };
  } catch {
    // A malformed regex in a saved workflow must not take the whole panel down.
    return null;
  }
}

function hasRegexRestrictions(node: WorkflowNode): boolean {
  return ['title', 'input', 'prompt', 'negative', 'group'].some((key) => {
    const value = ueProp(node, `${key}_regex`);
    return typeof value === 'string' && value.length > 0;
  });
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Port of `ue_properties.js → default_priority`. */
function defaultPriority(node: WorkflowNode, duplicateTypeCount: number): number {
  let p = 10;
  const type = nodeClass(node);
  if (type === 'Seed Everywhere' || type === 'Prompts Everywhere') p += 10;
  if (hasRegexRestrictions(node) || duplicateTypeCount > 0) p += 20;
  if (asNumber(ueProp(node, 'group_restricted')) > 0) p += 3;
  if (asNumber(ueProp(node, 'color_restricted')) > 0) p += 6;
  return p;
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

/** mode 0 is live; 2 (never) and 4 (bypass) are not, unless bypasses count. */
function nodeIsLive(node: WorkflowNode, treatBypassedAsLive: boolean): boolean {
  if (node.mode === 0 || node.mode === undefined) return true;
  if (node.mode === 2 || node.mode === 4) return treatBypassedAsLive;
  return true;
}

function typeTokens(type: unknown): string[] {
  return String(type ?? '')
    .split(',')
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * UE compares slot types with `!=` on the raw strings, so this is deliberately
 * an exact match rather than the looser token-overlap used elsewhere in the app:
 * treating "IMAGE" as compatible with "IMAGE,MASK" would wire connections the
 * desktop never makes. Case and surrounding space are still normalised.
 */
function typesEqual(a: unknown, b: unknown): boolean {
  const left = String(a ?? '').trim().toUpperCase();
  const right = String(b ?? '').trim().toUpperCase();
  if (!left || !right) return false;
  return left === right;
}

function inputLabel(input: WorkflowInput): string {
  return input.label || input.localized_name || input.name;
}

/** Port of `use_everywhere_classes.js → display_name`. */
function displayName(node: WorkflowNode): string {
  if (node.title) return node.title;
  if (node.type) return node.type;
  const sr = node.properties?.['Node name for S&R'];
  return typeof sr === 'string' ? sr : '';
}

/**
 * Follow a link upstream past bypassed nodes to the live source that actually
 * supplies the data. Port of `use_everywhere_utilities.js → handle_bypass`:
 * prefer the same-index input when its type matches, else the first input of the
 * matching type. Returns null when a bypassed chain has no live source.
 */
function resolveThroughBypass(
  workflow: Workflow,
  linkId: number,
  type: string,
): { originId: number; originSlot: number } | null {
  const linkById = new Map<number, WorkflowLink>(workflow.links.map((l) => [l[0], l]));
  const seen = new Set<number>();
  let currentLinkId: number = linkId;

  for (;;) {
    const link = linkById.get(currentLinkId);
    if (!link) return null;
    const originId: number = link[1];
    const originSlot: number = link[2];
    const parent = workflow.nodes.find((n) => n.id === originId);
    // An id absent from this scope is a subgraph I/O sentinel (-10/-20) — a
    // legitimate endpoint, so stop here rather than dropping the broadcast.
    if (!parent || parent.mode !== 4) return { originId, originSlot };
    if (seen.has(parent.id)) return null;
    seen.add(parent.id);

    const sameSlot = parent.inputs?.[originSlot];
    const nextLinkId: number | null | undefined =
      sameSlot && typesEqual(sameSlot.type, type)
        ? sameSlot.link
        : parent.inputs?.find((input) => typesEqual(input.type, type))?.link;
    if (nextLinkId == null) return null;
    currentLinkId = nextLinkId;
  }
}

/**
 * Whether a UE broadcast is allowed to land on this input. Port of
 * `use_everywhere_settings.js → is_connectable`: widget-backed inputs are opt-in,
 * plain slots are opt-out, and a node can refuse UE entirely.
 */
function isConnectable(node: WorkflowNode, input: WorkflowInput): boolean {
  if (node.properties?.rejects_ue_links) return false;
  if (input.widget) {
    const allowed = ueProp(node, 'widget_ue_connectable');
    return isRecord(allowed) ? Boolean(allowed[input.name]) : false;
  }
  const blocked = ueProp(node, 'input_ue_unconnectable');
  return isRecord(blocked) ? !blocked[input.name] : true;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolveUeOptions {
  /**
   * Whether bypassed nodes still receive broadcasts. Mirrors the pack's
   * "Connect to bypassed nodes" setting, which defaults to ON — so a bypassed
   * node's inputs read as fed rather than as missing. Broadcasters themselves
   * must always be strictly live; that is not configurable in UE either.
   */
  treatBypassedAsLive?: boolean;
}

/**
 * Collect every broadcast published in this scope.
 */
function collectBroadcasts(workflow: Workflow): UeBroadcast[] {
  const broadcasts: UeBroadcast[] = [];
  const nodeToGroup = computeNodeGroupsFor(workflow.nodes, workflow.groups);

  // Broadcasters must be strictly live regardless of the bypass setting.
  for (const node of workflow.nodes) {
    if (!canBroadcast(node)) continue;
    if (!nodeIsLive(node, false)) continue;

    const usesOutputs = Boolean(node.properties?.ue_convert);
    const slots: Array<{ index: number; source: { originId: number; originSlot: number }; type: string }> = [];

    if (usesOutputs) {
      // A `ue_convert` node re-publishes its own outputs. It is a real node that
      // still executes; only its broadcasting role is added here.
      const notBroadcasting = ueProp(node, 'output_not_broadcasting');
      (node.outputs ?? []).forEach((output, index) => {
        if (isRecord(notBroadcasting) && notBroadcasting[output.name]) return;
        slots.push({
          index,
          source: { originId: node.id, originSlot: index },
          type: String(output.type),
        });
      });
    } else {
      (node.inputs ?? []).forEach((input, index) => {
        if (input.link == null) return;
        const link = workflow.links.find((l) => l[0] === input.link);
        if (!link) return;
        // `||` not `??`: a malformed file can carry an empty type string, and
        // falling back to the slot's own type beats broadcasting "".
        const type = String(link[5] || input.type);
        const source = resolveThroughBypass(workflow, input.link, type);
        if (!source) return;
        slots.push({ index, source, type });
      });
    }

    // When one controller broadcasts the same type from two slots, UE
    // disambiguates by input name rather than letting them collide.
    const seenTypes = new Set<string>();
    const duplicateTypes = new Set<string>();
    for (const slot of slots) {
      const key = String(slot.type).toUpperCase();
      if (seenTypes.has(key)) duplicateTypes.add(key);
      seenTypes.add(key);
    }

    const priorityOverride = ueProp(node, 'priority');
    const priority =
      typeof priorityOverride === 'number'
        ? priorityOverride
        : defaultPriority(node, duplicateTypes.size);

    const restrictTo = computeRestriction(node, workflow, nodeToGroup);

    for (const slot of slots) {
      const sourceName = usesOutputs
        ? node.outputs?.[slot.index]?.label || node.outputs?.[slot.index]?.name || ''
        : inputLabel(node.inputs[slot.index]);
      broadcasts.push({
        controllerId: node.id,
        controllerSlot: slot.index,
        originId: slot.source.originId,
        originSlot: slot.source.originSlot,
        type: slot.type,
        priority,
        titleRegex: ueRegex(node, 'title'),
        inputRegex: ueRegex(node, 'input'),
        restrictTo,
        stringToCombo: asNumber(ueProp(node, 'string_to_combo')) > 0,
        sendToAny: asNumber(ueProp(node, 'send_to_any')) > 0,
        additionalRequirement: duplicateTypes.has(String(slot.type).toUpperCase())
          ? makeRepeatedTypeRule(asNumber(ueProp(node, 'repeated_type_rule')), sourceName)
          : null,
      });
    }
  }

  return broadcasts;
}

/** Port of the `repeated_type_rule` branch in `add_ue_from_node`. */
function makeRepeatedTypeRule(
  rule: number,
  sourceName: string,
): (input: WorkflowInput, node: WorkflowNode) => boolean {
  switch (rule) {
    case 1: // match start of input name
      return (input) => {
        const target = inputLabel(input);
        const chars = Math.min(sourceName.length, target.length);
        return target.slice(0, chars) === sourceName.slice(0, chars);
      };
    case 2: // match end of input name
      return (input) => {
        const target = inputLabel(input);
        const chars = Math.min(sourceName.length, target.length);
        return target.slice(target.length - chars) === sourceName.slice(sourceName.length - chars);
      };
    case 3: // input name matches the target node's title
      return (_input, node) => node.title === sourceName;
    default: // 0 — exact input-name match
      return (input) => inputLabel(input) === sourceName;
  }
}

/**
 * The set of node ids a controller may broadcast to, or null for unrestricted.
 *
 * Group membership is approximated with `computeNodeGroupsFor`, which assigns
 * each node to its innermost containing group; UE recomputes true geometric
 * containment and allows overlapping membership. The two agree except for nodes
 * sitting inside nested groups.
 */
function computeRestriction(
  node: WorkflowNode,
  workflow: Workflow,
  nodeToGroup: Map<number, number>,
): Set<number> | null {
  let restrictTo: Set<number> | null = null;

  const groupRestricted = asNumber(ueProp(node, 'group_restricted'));
  if (groupRestricted === 1 || groupRestricted === 2) {
    const myGroup = nodeToGroup.get(node.id);
    const inMyGroup = new Set<number>();
    for (const candidate of workflow.nodes) {
      const sameGroup = myGroup !== undefined && nodeToGroup.get(candidate.id) === myGroup;
      if (sameGroup) inMyGroup.add(candidate.id);
    }
    restrictTo =
      groupRestricted === 1
        ? inMyGroup
        : new Set(workflow.nodes.filter((n) => !inMyGroup.has(n.id)).map((n) => n.id));
  }

  const colorRestricted = asNumber(ueProp(node, 'color_restricted'));
  if (colorRestricted === 1 || colorRestricted === 2) {
    const wanted = node.color;
    const pool = restrictTo ?? new Set(workflow.nodes.map((n) => n.id));
    const next = new Set<number>();
    for (const candidate of workflow.nodes) {
      if (!pool.has(candidate.id)) continue;
      const same = candidate.color === wanted;
      if (colorRestricted === 1 ? same : !same) next.add(candidate.id);
    }
    restrictTo = next;
  }

  const groupRegex = ueRegex(node, 'group');
  if (groupRegex) {
    const matchingGroupIds = new Set(
      (workflow.groups ?? [])
        .filter((group) => groupRegex.regex.test(group.title) !== groupRegex.invert)
        .map((group) => group.id),
    );
    const next = new Set<number>();
    for (const candidate of workflow.nodes) {
      const groupId = nodeToGroup.get(candidate.id);
      if (groupId === undefined || !matchingGroupIds.has(groupId)) continue;
      if (restrictTo && !restrictTo.has(candidate.id)) continue;
      next.add(candidate.id);
    }
    restrictTo = next;
  }

  return restrictTo;
}

/** Port of `UseEverywhere.matches`. */
function broadcastMatches(
  broadcast: UeBroadcast,
  node: WorkflowNode,
  input: WorkflowInput,
): boolean {
  if (broadcast.originId === node.id) return false;
  if (broadcast.restrictTo && !broadcast.restrictTo.has(node.id)) return false;
  if (broadcast.additionalRequirement && !broadcast.additionalRequirement(input, node)) return false;

  if (broadcast.titleRegex) {
    const label = displayName(node);
    if (broadcast.titleRegex.regex.test(label) === broadcast.titleRegex.invert) return false;
  }

  if (!typesEqual(broadcast.type, input.type)) {
    // Two opt-in escapes from strict type equality, both driven by controller
    // properties: a STRING may feed a COMBO, and (pack 7.8+) anything may feed a
    // wildcard input.
    const isStringToCombo =
      broadcast.stringToCombo &&
      typeTokens(broadcast.type).includes('STRING') &&
      typeTokens(input.type).includes('COMBO');
    const isSendToAny = broadcast.sendToAny && typeTokens(input.type).includes('*');
    if (!isStringToCombo && !isSendToAny) return false;
  }

  if (broadcast.inputRegex) {
    const label = inputLabel(input);
    if (broadcast.inputRegex.regex.test(label) === broadcast.inputRegex.invert) return false;
  }

  return true;
}

/**
 * Resolve every unconnected input in one scope to the broadcast that feeds it.
 *
 * `workflow` must already be a single-scope view — pass the root workflow, or a
 * `getScopedWorkflowView(workflow, subgraphId)` result. UE matches within a
 * graph, so scopes never see each other's broadcasts.
 *
 * Returns an empty map when the scope has no broadcasters, so callers can treat
 * "no Use Everywhere here" as free.
 */
export function resolveUseEverywhereLinks(
  workflow: Workflow | null | undefined,
  options: ResolveUeOptions = {},
): UeLinkMap {
  const resolved: UeLinkMap = new Map();
  if (!workflow) return resolved;

  const treatBypassedAsLive = options.treatBypassedAsLive ?? true;
  const broadcasts = collectBroadcasts(workflow);
  if (broadcasts.length === 0) return resolved;

  for (const node of workflow.nodes) {
    if (canBroadcast(node) && isUseEverywhereNode(node)) continue;
    if (!nodeIsLive(node, treatBypassedAsLive)) continue;
    if (node.properties?.rejects_ue_links) continue;

    (node.inputs ?? []).forEach((input, index) => {
      if (!input) return;
      if (input.link != null) return;
      if (!isConnectable(node, input)) return;

      const matches = broadcasts.filter((broadcast) => broadcastMatches(broadcast, node, input));
      if (matches.length === 0) return;

      let winner = matches[0];
      if (matches.length > 1) {
        const sorted = [...matches].sort((a, b) => b.priority - a.priority);
        // An exact priority tie is ambiguous: UE deliberately leaves the input
        // unconnected rather than guessing, and so do we.
        if (sorted[0].priority === sorted[1].priority) return;
        winner = sorted[0];
      }

      resolved.set(ueSlotKey(node.id, index), {
        originId: winner.originId,
        originSlot: winner.originSlot,
        type: winner.type,
        controllerId: winner.controllerId,
        controllerSlot: winner.controllerSlot,
      });
    });
  }

  return resolved;
}

const EMPTY_UE_LINKS: UeLinkMap = new Map();

// Resolution is pure and depends only on the canonical workflow object, which is
// replaced wholesale on every edit — so cache per (workflow, scope) and let the
// UI ask as often as it likes. Dozens of connection buttons share one pass.
const scopedCache = new WeakMap<Workflow, Map<string, UeLinkMap>>();

/**
 * The broadcast map for one scope of the canonical workflow, memoised on the
 * workflow object's identity.
 *
 * Pass the *canonical* workflow (not a scoped view) plus the scope's subgraph id;
 * scoping happens inside so every caller shares one cache entry.
 */
export function getScopedUeLinkMap(
  workflow: Workflow | null | undefined,
  subgraphId: string | null,
  scopedView: Workflow | null | undefined,
): UeLinkMap {
  if (!workflow || !scopedView) return EMPTY_UE_LINKS;
  let byScope = scopedCache.get(workflow);
  if (!byScope) {
    byScope = new Map();
    scopedCache.set(workflow, byScope);
  }
  const key = subgraphId ?? '';
  const cached = byScope.get(key);
  if (cached) return cached;
  const resolved = scopedView.nodes.some(canBroadcast)
    ? resolveUseEverywhereLinks(scopedView)
    : EMPTY_UE_LINKS;
  byScope.set(key, resolved);
  return resolved;
}

/**
 * Resolve broadcasts across an *expanded* workflow, one scope at a time.
 *
 * `expandWorkflowSubgraphs` flattens every subgraph instance into a single node
 * list, so resolving over it directly would let a root broadcast reach inside a
 * subgraph — something UE never does, since it analyses each graph separately.
 * A node's prompt key encodes its scope (`placeholderKey:innerId`, root nodes
 * having no prefix), so partition on that and resolve each scope in isolation.
 *
 * Links stay shared: the resolver only ever matches broadcasts to sinks drawn
 * from the node list it is given, and looking a link up by id is scope-safe.
 */
export function resolveUseEverywhereForPrompt(
  expanded: Workflow,
  promptKeyMap: Map<number, string>,
  options: ResolveUeOptions = {},
): UeLinkMap {
  const ROOT = '';
  const byScope = new Map<string, WorkflowNode[]>();
  for (const node of expanded.nodes) {
    const key = promptKeyMap.get(node.id);
    const scope = key ? key.split(':').slice(0, -1).join(':') : ROOT;
    const list = byScope.get(scope);
    if (list) list.push(node);
    else byScope.set(scope, [node]);
  }

  if (byScope.size <= 1) return resolveUseEverywhereLinks(expanded, options);

  const merged: UeLinkMap = new Map();
  for (const nodes of byScope.values()) {
    if (!nodes.some(canBroadcast)) continue;
    const scoped = resolveUseEverywhereLinks({ ...expanded, nodes }, options);
    for (const [key, value] of scoped) merged.set(key, value);
  }
  return merged;
}

/**
 * The broadcasts available in a scope, deduplicated per (origin slot, controller).
 *
 * Used by the connection picker to offer "connect this to what the broadcast
 * carries" and to label sources that are already arriving over the air.
 */
export interface UeBroadcastOption {
  controllerId: number;
  controllerSlot: number;
  originId: number;
  originSlot: number;
  type: string;
}

/** One input somewhere in the scope that a broadcast currently feeds. */
export interface UeReceiver {
  nodeId: number;
  slotIndex: number;
}

/**
 * Every input fed by one controller slot.
 *
 * An Anything Everywhere node has no outputs of its own, so this is what its
 * outgoing side actually connects to — the list the card's synthesized output
 * button offers for navigation.
 */
export function listUeReceivers(
  ueLinks: UeLinkMap,
  controllerId: number,
  controllerSlot: number,
): UeReceiver[] {
  const receivers: UeReceiver[] = [];
  for (const [key, resolution] of ueLinks) {
    if (resolution.controllerId !== controllerId) continue;
    if (resolution.controllerSlot !== controllerSlot) continue;
    const separator = key.lastIndexOf(':');
    receivers.push({
      nodeId: Number(key.slice(0, separator)),
      slotIndex: Number(key.slice(separator + 1)),
    });
  }
  return receivers;
}

export function listUeBroadcasts(
  workflow: Workflow | null | undefined,
): UeBroadcastOption[] {
  if (!workflow) return [];
  return collectBroadcasts(workflow).map((broadcast) => ({
    controllerId: broadcast.controllerId,
    controllerSlot: broadcast.controllerSlot,
    originId: broadcast.originId,
    originSlot: broadcast.originSlot,
    type: broadcast.type,
  }));
}

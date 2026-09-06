import type {
  Workflow,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphDefinition,
  WorkflowSubgraphLink,
} from '@/api/types';
import {
  SUBGRAPH_INPUT_NODE_ID,
  SUBGRAPH_OUTPUT_NODE_ID,
  getLinkId,
  getLinkOriginId,
  getLinkOriginSlot,
  getLinkTargetId,
  getLinkTargetSlot,
  getLinkType,
} from '@/utils/canonicalWorkflowOps';

/**
 * Structural checks that stand in for the ones the ComfyUI backend runs when a
 * prompt is submitted.
 *
 * The subgraph-editing bugs this exists for do not throw and do not corrupt the
 * JSON — the workflow saves, reloads and renders. They surface only at queue
 * time, as `Return type mismatch between linked nodes` on some node nowhere
 * near the edit, because a link kept its id while the slot index under it came
 * to name a different input. Asserting "the move returned a workflow" therefore
 * proves nothing; asserting that every link still lands on a slot of its own
 * type is the property that was actually broken.
 *
 * Everything here is derived from the workflow alone — no node definitions, no
 * server — so it can run over a captured graph full of custom node types.
 */

export interface IntegrityProblem {
  /** Subgraph definition name, or 'root'. */
  scope: string;
  kind:
    | 'duplicate-link-id'
    | 'missing-origin-node'
    | 'missing-target-node'
    | 'origin-slot-out-of-range'
    | 'target-slot-out-of-range'
    | 'boundary-input-out-of-range'
    | 'boundary-output-out-of-range'
    | 'type-mismatch'
    | 'boundary-type-mismatch'
    | 'placeholder-slot-count'
    | 'placeholder-slot-name'
    | 'stale-input-cache'
    | 'stale-output-cache';
  detail: string;
}

/**
 * Types the graph uses as "anything goes". SetNode/GetNode relays and reroutes
 * carry `*`, and a slot that has never been connected can carry an empty type.
 * Comparing those against a concrete type is not a defect.
 */
const WILDCARD_TYPES = new Set(['*', '', 'any', '-1']);

function isWildcard(type: string | undefined): boolean {
  return type === undefined || WILDCARD_TYPES.has(String(type).trim().toLowerCase());
}

/**
 * Whether two declared slot types can carry the same link.
 *
 * Deliberately permissive: a comma list is a union (`"INT,FLOAT"`), and the
 * point is to catch a LATENT link landing on an INT input, not to relitigate
 * every custom node's type spelling.
 */
export function typesCompatible(a: string | undefined, b: string | undefined): boolean {
  if (isWildcard(a) || isWildcard(b)) return true;
  const left = new Set(String(a).toLowerCase().split(',').map((part) => part.trim()));
  const right = String(b).toLowerCase().split(',').map((part) => part.trim());
  return right.some((part) => left.has(part));
}

type ScopeLink = WorkflowLink | WorkflowSubgraphLink;

interface Scope {
  name: string;
  nodes: WorkflowNode[];
  links: ScopeLink[];
  /** Present for subgraph scopes; the boundary these links may address. */
  definition: WorkflowSubgraphDefinition | null;
}

function scopesOf(workflow: Workflow): Scope[] {
  const definitions = workflow.definitions?.subgraphs ?? [];
  return [
    { name: 'root', nodes: workflow.nodes ?? [], links: (workflow.links ?? []) as ScopeLink[], definition: null },
    ...definitions.map((definition) => ({
      name: definition.name ?? definition.id,
      nodes: definition.nodes ?? [],
      links: (definition.links ?? []) as ScopeLink[],
      definition,
    })),
  ];
}

function describeNode(node: WorkflowNode | undefined, id: number): string {
  if (!node) return `#${id}`;
  return `#${id} ${node.title ?? node.type}`;
}

/**
 * Every link in every scope, checked against the slots it claims to join.
 *
 * Returns problems rather than throwing so a test can report all of them at
 * once — one bad move tends to produce a dozen, and seeing the set is what
 * tells you which slot index drifted.
 */
export function findIntegrityProblems(workflow: Workflow): IntegrityProblem[] {
  const problems: IntegrityProblem[] = [];
  const definitionsById = new Map(
    (workflow.definitions?.subgraphs ?? []).map((definition) => [definition.id, definition]),
  );

  for (const scope of scopesOf(workflow)) {
    const push = (kind: IntegrityProblem['kind'], detail: string) =>
      problems.push({ scope: scope.name, kind, detail });
    const nodesById = new Map(scope.nodes.map((node) => [node.id, node]));

    const seenLinkIds = new Set<number>();
    for (const link of scope.links) {
      const id = getLinkId(link);
      if (seenLinkIds.has(id)) push('duplicate-link-id', `link ${id} appears more than once`);
      seenLinkIds.add(id);

      const originId = getLinkOriginId(link);
      const targetId = getLinkTargetId(link);
      const originSlot = getLinkOriginSlot(link);
      const targetSlot = getLinkTargetSlot(link);
      const linkType = getLinkType(link);

      // The origin side: either the boundary input node, or a real node.
      let originType: string | undefined;
      if (originId === SUBGRAPH_INPUT_NODE_ID) {
        const boundary = scope.definition?.inputs?.[originSlot];
        if (!boundary) {
          push(
            'boundary-input-out-of-range',
            `link ${id} reads boundary input slot ${originSlot}, boundary has ${scope.definition?.inputs?.length ?? 0}`,
          );
        } else {
          originType = boundary.type;
        }
      } else {
        const origin = nodesById.get(originId);
        if (!origin) {
          push('missing-origin-node', `link ${id} originates at absent node #${originId}`);
        } else if (!origin.outputs?.[originSlot]) {
          push(
            'origin-slot-out-of-range',
            `link ${id} reads output ${originSlot} of ${describeNode(origin, originId)}, which has ${origin.outputs?.length ?? 0}`,
          );
        } else {
          originType = origin.outputs[originSlot].type;
        }
      }

      // The target side, same two shapes.
      let targetType: string | undefined;
      let targetLabel = `#${targetId}`;
      if (targetId === SUBGRAPH_OUTPUT_NODE_ID) {
        const boundary = scope.definition?.outputs?.[targetSlot];
        if (!boundary) {
          push(
            'boundary-output-out-of-range',
            `link ${id} feeds boundary output slot ${targetSlot}, boundary has ${scope.definition?.outputs?.length ?? 0}`,
          );
        } else {
          targetType = boundary.type;
          targetLabel = `boundary output "${boundary.name}"`;
        }
      } else {
        const target = nodesById.get(targetId);
        if (!target) {
          push('missing-target-node', `link ${id} feeds absent node #${targetId}`);
        } else if (!target.inputs?.[targetSlot]) {
          push(
            'target-slot-out-of-range',
            `link ${id} feeds input ${targetSlot} of ${describeNode(target, targetId)}, which has ${target.inputs?.length ?? 0}`,
          );
        } else {
          targetType = target.inputs[targetSlot].type;
          targetLabel = `${describeNode(target, targetId)}.${target.inputs[targetSlot].name}`;
        }
      }

      // The check the backend actually fails on.
      if (!typesCompatible(originType, targetType)) {
        push(
          'type-mismatch',
          `link ${id}: ${targetLabel} declares ${targetType}, but is fed ${originType} from ${describeNode(nodesById.get(originId), originId)} slot ${originSlot}`,
        );
      }
      // The link's own recorded type drifting from its endpoints is the same
      // corruption one step earlier, and is what a reload would propagate.
      if (!typesCompatible(linkType, targetType) || !typesCompatible(linkType, originType)) {
        push(
          'boundary-type-mismatch',
          `link ${id} records type ${linkType} between ${originType} and ${targetType} (${targetLabel})`,
        );
      }
    }

    // Slot caches must agree with the link table; a node reading as connected
    // to a link that no longer exists renders as wired and queues as empty.
    const linksById = new Map(scope.links.map((link) => [getLinkId(link), link]));
    for (const node of scope.nodes) {
      node.inputs?.forEach((input, index) => {
        if (input.link == null) return;
        const link = linksById.get(input.link);
        if (!link || getLinkTargetId(link) !== node.id || getLinkTargetSlot(link) !== index) {
          push(
            'stale-input-cache',
            `${describeNode(node, node.id)}.${input.name} caches link ${input.link}, which ${link ? 'lands elsewhere' : 'does not exist'}`,
          );
        }
      });
      node.outputs?.forEach((output, index) => {
        const actual = scope.links
          .filter((link) => getLinkOriginId(link) === node.id && getLinkOriginSlot(link) === index)
          .map(getLinkId)
          .sort((a, b) => a - b);
        const cached = [...(output.links ?? [])].sort((a, b) => a - b);
        if (JSON.stringify(actual) !== JSON.stringify(cached)) {
          push(
            'stale-output-cache',
            `${describeNode(node, node.id)}.${output.name} caches [${cached}] but has [${actual}]`,
          );
        }
      });

      // A placeholder's slot lists ARE its definition's boundary after
      // normalization. When they drift, every link index in the parent scope
      // means something different from what the definition thinks.
      const definition = definitionsById.get(node.type);
      if (!definition) continue;
      const boundaryInputs = definition.inputs ?? [];
      const boundaryOutputs = definition.outputs ?? [];
      if ((node.inputs?.length ?? 0) !== boundaryInputs.length) {
        push(
          'placeholder-slot-count',
          `${describeNode(node, node.id)} has ${node.inputs?.length ?? 0} inputs, boundary "${definition.name}" has ${boundaryInputs.length}`,
        );
      }
      if ((node.outputs?.length ?? 0) !== boundaryOutputs.length) {
        push(
          'placeholder-slot-count',
          `${describeNode(node, node.id)} has ${node.outputs?.length ?? 0} outputs, boundary "${definition.name}" has ${boundaryOutputs.length}`,
        );
      }
      boundaryInputs.forEach((boundary, index) => {
        const slot = node.inputs?.[index];
        if (slot && boundary.name && slot.name !== boundary.name) {
          push(
            'placeholder-slot-name',
            `${describeNode(node, node.id)} input ${index} is "${slot.name}", boundary says "${boundary.name}"`,
          );
        }
      });
      boundaryOutputs.forEach((boundary, index) => {
        const slot = node.outputs?.[index];
        if (slot && boundary.name && slot.name !== boundary.name) {
          push(
            'placeholder-slot-name',
            `${describeNode(node, node.id)} output ${index} is "${slot.name}", boundary says "${boundary.name}"`,
          );
        }
      });
    }
  }

  return problems;
}

/**
 * One connection, named the way a person reads it rather than by index.
 *
 * Slot indices are exactly what these bugs shuffle, so a snapshot keyed by
 * index would move with the damage and compare equal. Keying by node title and
 * slot NAME is what makes "the framerate connection now feeds prev_latent"
 * show up as a diff.
 */
export type ConnectionKey = string;

function nodeLabel(node: WorkflowNode | undefined, id: number, definitionName?: string): string {
  if (id === SUBGRAPH_INPUT_NODE_ID) return '<boundary-in>';
  if (id === SUBGRAPH_OUTPUT_NODE_ID) return '<boundary-out>';
  if (!node) return `<missing #${id}>`;
  // Titles repeat across the graph ("GetNode"), so the widget value that names
  // a relay is part of its identity; ids are not, because a move re-mints them.
  const relayName = Array.isArray(node.widgets_values) && typeof node.widgets_values[0] === 'string'
    ? `:${node.widgets_values[0]}`
    : '';
  return `${node.title ?? definitionName ?? node.type}${relayName}`;
}

/**
 * The set of connections in a workflow, as `origin.slotName -> target.slotName`
 * strings within each scope.
 *
 * Compare two of these across an edit: everything the edit was not supposed to
 * touch must appear in both.
 */
export function connectionSnapshot(workflow: Workflow): Set<ConnectionKey> {
  const definitionsById = new Map(
    (workflow.definitions?.subgraphs ?? []).map((definition) => [definition.id, definition]),
  );
  const snapshot = new Set<ConnectionKey>();

  for (const scope of scopesOf(workflow)) {
    const nodesById = new Map(scope.nodes.map((node) => [node.id, node]));
    for (const link of scope.links) {
      const originId = getLinkOriginId(link);
      const targetId = getLinkTargetId(link);
      const origin = nodesById.get(originId);
      const target = nodesById.get(targetId);

      const originSlotName = originId === SUBGRAPH_INPUT_NODE_ID
        ? scope.definition?.inputs?.[getLinkOriginSlot(link)]?.name ?? `slot${getLinkOriginSlot(link)}`
        : origin?.outputs?.[getLinkOriginSlot(link)]?.name ?? `slot${getLinkOriginSlot(link)}`;
      const targetSlotName = targetId === SUBGRAPH_OUTPUT_NODE_ID
        ? scope.definition?.outputs?.[getLinkTargetSlot(link)]?.name ?? `slot${getLinkTargetSlot(link)}`
        : target?.inputs?.[getLinkTargetSlot(link)]?.name ?? `slot${getLinkTargetSlot(link)}`;

      snapshot.add(
        `${scope.name} | ${nodeLabel(origin, originId, definitionsById.get(origin?.type ?? '')?.name)}.${originSlotName}`
        + ` -> ${nodeLabel(target, targetId, definitionsById.get(target?.type ?? '')?.name)}.${targetSlotName}`,
      );
    }
  }

  return snapshot;
}

/** Connections present before an edit and gone after it. */
export function lostConnections(before: Workflow, after: Workflow): ConnectionKey[] {
  const now = connectionSnapshot(after);
  return [...connectionSnapshot(before)].filter((key) => !now.has(key)).sort();
}

/** Connections the edit introduced. */
export function gainedConnections(before: Workflow, after: Workflow): ConnectionKey[] {
  const was = connectionSnapshot(before);
  return [...connectionSnapshot(after)].filter((key) => !was.has(key)).sort();
}

/** Group problems by kind for a readable assertion message. */
export function summarizeProblems(problems: IntegrityProblem[]): string {
  if (problems.length === 0) return 'none';
  const byKind = new Map<string, IntegrityProblem[]>();
  for (const problem of problems) {
    const list = byKind.get(problem.kind) ?? [];
    list.push(problem);
    byKind.set(problem.kind, list);
  }
  return [...byKind.entries()]
    .map(([kind, list]) => `${kind} (${list.length}):\n${list.slice(0, 8).map((p) => `    [${p.scope}] ${p.detail}`).join('\n')}`)
    .join('\n  ');
}

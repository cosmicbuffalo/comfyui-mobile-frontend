import type {
  NodeTypeDefinition,
  NodeTypes,
  Workflow,
  WorkflowNode,
} from '@/api/types';
import {
  getActiveNodeInputDefinitions,
  getNodeWidgetIndexMap,
} from '@/utils/workflowInputs';
import {
  getPlaceholderValueIndexForBoundarySlot,
  getSubgraphBoundaryWidgetSlots,
} from '@/utils/widgetDefinitions';
import { isSpecialSeedValue, SPECIAL_SEED_RANDOM } from '@/utils/seedUtils';

type PromptNode = {
  class_type?: unknown;
  inputs?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPromptGraph(prompt: unknown): Record<string, unknown> | null {
  if (!isRecord(prompt)) return null;

  // Standard ComfyUI image/history metadata stores the graph directly. Also
  // accept a full API request shape so imported metadata from other producers
  // can use the same restoration path.
  return isRecord(prompt.prompt) ? prompt.prompt : prompt;
}

function isPromptNode(value: unknown): value is PromptNode {
  return isRecord(value) && isRecord(value.inputs);
}

type PromptNodeLookup = {
  direct: Map<string, PromptNode>;
  byCanonicalNodeId: Map<string, PromptNode[]>;
};

function buildPromptNodeLookup(prompt: unknown): PromptNodeLookup | null {
  const graph = getPromptGraph(prompt);
  if (!graph) return null;

  const direct = new Map<string, PromptNode>();
  const byCanonicalNodeId = new Map<string, PromptNode[]>();
  for (const [promptNodeId, value] of Object.entries(graph)) {
    if (!isPromptNode(value)) continue;
    direct.set(promptNodeId, value);

    // Expanded subgraph prompt ids are hierarchical (for example "50:7").
    // Canonical workflow definitions retain only the inner id ("7").
    // Root-level prompt ids carry no colon and are served by `direct`;
    // indexing them here too would let a root node collide with a
    // same-numbered inner node (definitions restart their id space, so
    // root 7 and inner 7 coexisting is the normal case, not the edge).
    if (!promptNodeId.includes(':')) continue;
    const canonicalNodeId = promptNodeId.split(':').pop();
    if (!canonicalNodeId) continue;
    const nodes = byCanonicalNodeId.get(canonicalNodeId) ?? [];
    nodes.push(value);
    byCanonicalNodeId.set(canonicalNodeId, nodes);
  }
  return { direct, byCanonicalNodeId };
}

type ResolvedNodeType = {
  classType: string;
  definition: NodeTypeDefinition;
};

function resolveNodeType(
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
): ResolvedNodeType | null {
  if (!nodeTypes) return null;
  const exact = nodeTypes[node.type];
  if (exact) return { classType: node.type, definition: exact };
  const match = Object.entries(nodeTypes).find(([, definition]) => (
    definition.name === node.type || definition.display_name === node.type
  ));
  return match ? { classType: match[0], definition: match[1] } : null;
}

type SeedWidgetBinding = {
  inputName: string;
  widgetIndex: number;
};

function isSeedInputName(name: string): boolean {
  return name.toLowerCase().includes('seed');
}

function getSeedWidgetBindings(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
): { bindings: SeedWidgetBinding[]; classType: string } {
  const resolvedType = resolveNodeType(nodeTypes, node);
  const widgetIndexMap = getNodeWidgetIndexMap(workflow, node);
  if (resolvedType) {
    const bindings = getActiveNodeInputDefinitions(
      resolvedType.definition,
      node,
      widgetIndexMap,
    ).flatMap((definition) => {
      const [inputType] = definition.inputDef;
      if (
        definition.widgetIndex === null ||
        String(inputType).toUpperCase() !== 'INT' ||
        !isSeedInputName(definition.name)
      ) {
        return [];
      }
      return [{
        inputName: definition.qualifiedName,
        widgetIndex: definition.widgetIndex,
      }];
    });
    return { bindings, classType: resolvedType.classType };
  }

  // A workflow-level or per-node widget index map is enough to restore custom
  // seed widgets even when object_info for that custom node is unavailable.
  const bindings = Object.entries(widgetIndexMap ?? {}).flatMap(([name, index]) => (
    Number.isInteger(index) && index >= 0 && isSeedInputName(name)
      ? [{ inputName: name, widgetIndex: index }]
      : []
  ));
  return { bindings, classType: node.type };
}

function getWidgetValue(node: WorkflowNode, binding: SeedWidgetBinding): unknown {
  if (Array.isArray(node.widgets_values)) {
    return node.widgets_values[binding.widgetIndex];
  }
  if (isRecord(node.widgets_values)) {
    return node.widgets_values[binding.inputName];
  }
  return undefined;
}

function writeWidgetValues(
  node: WorkflowNode,
  updates: Map<SeedWidgetBinding, number>,
): WorkflowNode {
  if (Array.isArray(node.widgets_values)) {
    const values = [...node.widgets_values];
    for (const [binding, seed] of updates) values[binding.widgetIndex] = seed;
    return { ...node, widgets_values: values };
  }
  if (isRecord(node.widgets_values)) {
    const values = { ...node.widgets_values };
    for (const [binding, seed] of updates) values[binding.inputName] = seed;
    return { ...node, widgets_values: values };
  }
  return node;
}

function readConcreteSeed(promptNode: PromptNode, inputName: string): number | null {
  if (!isRecord(promptNode.inputs)) return null;
  const seed = promptNode.inputs[inputName];
  return (
    typeof seed === 'number' &&
    Number.isFinite(seed) &&
    Number.isInteger(seed) &&
    !isSpecialSeedValue(seed)
  ) ? seed : null;
}

/** Resolve boundary connections using their target slots and full instance paths. */
function restorePlaceholderNode(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
  lookup: PromptNodeLookup,
): WorkflowNode {
  const subgraph = workflow.definitions?.subgraphs?.find((entry) => entry.id === node.type);
  if (!subgraph || !Array.isArray(node.widgets_values)) return node;
  const definitions = new Map(workflow.definitions?.subgraphs?.map((sg) => [sg.id, sg]));
  // Match canonical node objects so a root id cannot alias an inner id. Shared
  // definitions can have multiple paths; their restored value must agree.
  const paths: string[] = [];
  const visit = (nodes: WorkflowNode[], prefix: string, ancestors: Set<string>) => {
    for (const candidate of nodes) {
      const path = prefix ? `${prefix}:${candidate.id}` : String(candidate.id);
      if (candidate === node) paths.push(path);
      const definition = definitions.get(candidate.type);
      if (definition && !ancestors.has(definition.id)) {
        visit(definition.nodes, path, new Set([...ancestors, definition.id]));
      }
    }
  };
  visit(workflow.nodes, '', new Set());

  const readBoundary = (
    definition: typeof subgraph, slot: number, prefix: string, seeds: Set<number>, depth = 0,
  ) => {
    if (depth > 32) return;
    for (const id of definition.inputs?.[slot]?.linkIds ?? []) {
      const link = definition.links.find((entry) => entry.id === id);
      const target = definition.nodes.find((entry) => entry.id === link?.target_id);
      if (!link || !target) continue;
      const path = `${prefix}:${target.id}`;
      const nested = definitions.get(target.type);
      if (nested) {
        readBoundary(nested, link.target_slot, path, seeds, depth + 1);
      } else {
        const input = target.inputs?.[link.target_slot];
        const promptNode = lookup.direct.get(path);
        if (!input || !promptNode || promptNode.class_type !== (resolveNodeType(nodeTypes, target)?.classType ?? target.type)) continue;
        const seed = readConcreteSeed(promptNode, input.name);
        if (seed !== null) seeds.add(seed);
      }
    }
  };

  const updates = new Map<number, number>();
  for (const { boundarySlot } of getSubgraphBoundaryWidgetSlots(subgraph)) {
    const boundaryInput = subgraph.inputs?.[boundarySlot];
    const name = boundaryInput?.name;
    if (!name || !isSeedInputName(name)) continue;
    if (String(boundaryInput?.type ?? 'INT').toUpperCase() !== 'INT') continue;
    const valueIndex = getPlaceholderValueIndexForBoundarySlot(node, subgraph, boundarySlot);
    if (valueIndex === null) continue;
    if (node.widgets_values[valueIndex] !== SPECIAL_SEED_RANDOM) continue;

    const seeds = new Set<number>();
    for (const path of paths) readBoundary(subgraph, boundarySlot, path, seeds);
    if (seeds.size === 1) updates.set(valueIndex, seeds.values().next().value!);
  }
  if (updates.size === 0) return node;

  const values = [...node.widgets_values];
  for (const [valueIndex, seed] of updates) values[valueIndex] = seed;
  return { ...node, widgets_values: values };
}

function restoreNode(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
  lookup: PromptNodeLookup,
  rootScope: boolean,
): WorkflowNode {
  // A placeholder's `type` is a subgraph UUID, which nodeTypes has no schema
  // for; its seeds are found through the boundary instead.
  if (workflow.definitions?.subgraphs?.some((entry) => entry.id === node.type)) {
    return restorePlaceholderNode(workflow, nodeTypes, node, lookup);
  }
  const { bindings, classType } = getSeedWidgetBindings(workflow, nodeTypes, node);
  const randomBindings = bindings.filter(
    (binding) => getWidgetValue(node, binding) === SPECIAL_SEED_RANDOM,
  );
  if (randomBindings.length === 0) return node;

  const candidates = rootScope
    ? [lookup.direct.get(String(node.id))].filter((value): value is PromptNode => Boolean(value))
    : lookup.byCanonicalNodeId.get(String(node.id)) ?? [];
  const matchingCandidates = candidates.filter(
    (candidate) => candidate.class_type === classType,
  );
  if (matchingCandidates.length === 0) return node;

  const updates = new Map<SeedWidgetBinding, number>();
  for (const binding of randomBindings) {
    const seeds = new Set<number>();
    for (const candidate of matchingCandidates) {
      const seed = readConcreteSeed(candidate, binding.inputName);
      if (seed !== null) seeds.add(seed);
    }
    // Repeated instances of a subgraph can theoretically resolve one canonical
    // widget differently. In that case there is no single honest value to load.
    if (seeds.size === 1) {
      updates.set(binding, seeds.values().next().value!);
    }
  }
  return updates.size > 0 ? writeWidgetValues(node, updates) : node;
}

function restoreNodes(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  nodes: WorkflowNode[],
  lookup: PromptNodeLookup,
  rootScope: boolean,
): { nodes: WorkflowNode[]; changed: boolean } {
  let changed = false;
  const restored = nodes.map((node) => {
    const next = restoreNode(workflow, nodeTypes, node, lookup, rootScope);
    if (next !== node) changed = true;
    return next;
  });
  return { nodes: changed ? restored : nodes, changed };
}

/**
 * Replace saved -1 seed sentinels with the values from the prompt graph that
 * actually executed. Other widget values remain authored as-is. The workflow
 * is left untouched when prompt metadata is missing, connected rather than
 * concrete, type-mismatched, or ambiguous across subgraph instances.
 */
export function restoreExecutedSeedWidgets(
  workflow: Workflow,
  prompt: unknown,
  nodeTypes: NodeTypes | null,
): Workflow {
  const lookup = buildPromptNodeLookup(prompt);
  if (!lookup) return workflow;

  const root = restoreNodes(workflow, nodeTypes, workflow.nodes ?? [], lookup, true);
  let subgraphsChanged = false;
  const subgraphs = workflow.definitions?.subgraphs?.map((subgraph) => {
    const restored = restoreNodes(
      workflow,
      nodeTypes,
      subgraph.nodes ?? [],
      lookup,
      false,
    );
    if (!restored.changed) return subgraph;
    subgraphsChanged = true;
    return { ...subgraph, nodes: restored.nodes };
  });

  if (!root.changed && !subgraphsChanged) return workflow;
  return {
    ...workflow,
    nodes: root.nodes,
    ...(subgraphsChanged
      ? {
          definitions: {
            ...workflow.definitions,
            subgraphs,
          },
        }
      : {}),
  };
}

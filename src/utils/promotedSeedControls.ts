import type { NodeTypes, Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import type { SeedMode } from '@/utils/seedUtils';
import { getWidgetIndexForInput, nodeTypeStripsSeedControl } from '@/utils/seedUtils';
import { getPlaceholderValueIndexForBoundarySlot } from '@/utils/widgetDefinitions';

/**
 * A seed a subgraph placeholder promotes, traced to the widget that owns it.
 *
 * Stock resolves control_after_generate one promoted input at a time
 * (`applyPromotedWidgetControl`, frontend promotedWidgetControl.ts): for every
 * UNLINKED promoted input on the host it finds the concrete interior widget --
 * recursing through nested subgraphs -- and reads THAT widget's linked
 * control. The host owns the value; the interior node owns the mode. A value
 * further down only stands when the host holds none (see
 * promotedSeedValueSource) -- otherwise the boundary overrides it.
 *
 * So a placeholder has one of these per promoted seed, each with its own mode,
 * and nothing here keys on the widget's name: identity is the boundary slot.
 */
export interface PromotedSeedControl {
  /** The placeholder's input slot (== boundary slot once normalized). */
  inputSlot: number;
  /** Where the placeholder keeps this seed's value in widgets_values. */
  valueIndex: number;
  /** The definition holding the concrete node that owns the seed widget. */
  subgraphId: string;
  node: WorkflowNode;
  seedWidgetIndex: number;
  /** That node's control_after_generate slot. */
  controlWidgetIndex: number;
  mode: SeedMode;
  /** How the value travels from the host to that node. */
  trace: PromotedSlotTrace;
}

const SEED_MODES: ReadonlySet<string> = new Set(['fixed', 'increment', 'decrement', 'randomize']);

function findDefinition(workflow: Workflow, id: string): WorkflowSubgraphDefinition | undefined {
  return workflow.definitions?.subgraphs?.find((subgraph) => subgraph.id === id);
}

/** The interior link a boundary slot feeds, first one when it fans out. */
function boundaryLink(definition: WorkflowSubgraphDefinition, slot: number) {
  const links = definition.links ?? [];
  const linkIds = definition.inputs?.[slot]?.linkIds ?? [];
  for (const id of linkIds) {
    const link = links.find((candidate) => candidate.id === id);
    if (link) return link;
  }
  return links.find((link) => link.origin_id === -10 && link.origin_slot === slot);
}

function inputDefinitionType(nodeTypes: NodeTypes, node: WorkflowNode, name: string): unknown {
  const input = nodeTypes[node.type]?.input;
  const definition = input?.required?.[name] ?? input?.optional?.[name];
  return Array.isArray(definition) ? definition[0] : undefined;
}

/**
 * A placeholder input slot mapped to the boundary slot of `definition`. Slot ==
 * boundary slot once load has normalized the placeholder; the name decides when
 * it has not, so an unnormalized input can never borrow its neighbour's widget.
 */
function boundarySlotFor(
  placeholder: WorkflowNode,
  definition: WorkflowSubgraphDefinition,
  inputSlot: number,
): number {
  const name = placeholder.inputs?.[inputSlot]?.name;
  const boundaries = definition.inputs ?? [];
  if (boundaries[inputSlot]?.name === name) return inputSlot;
  const byName = boundaries.findIndex((boundary) => boundary.name === name);
  return byName === -1 ? inputSlot : byName;
}

/** A placeholder nested between the host and the widget, and where it keeps the value. */
interface PromotedHop {
  subgraphId: string;
  node: WorkflowNode;
  valueIndex: number;
}

/** Where one boundary slot's value ends up: the placeholders it passes through, then the widget. */
export interface PromotedSlotTrace {
  hops: PromotedHop[];
  subgraphId: string;
  node: WorkflowNode;
  widgetName: string;
  widgetIndex: number;
}

/** Follow one boundary slot down through nested placeholders to the widget it drives. */
function traceBoundarySlot(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  definition: WorkflowSubgraphDefinition,
  slot: number,
  visited: Set<string> = new Set(),
): PromotedSlotTrace | null {
  if (visited.has(definition.id)) return null;
  const link = boundaryLink(definition, slot);
  if (!link) return null;
  const target = (definition.nodes ?? []).find((node) => node.id === link.target_id);
  if (!target) return null;

  const nested = findDefinition(workflow, target.type);
  if (nested) {
    const nestedSlot = boundarySlotFor(target, nested, link.target_slot);
    const valueIndex = getPlaceholderValueIndexForBoundarySlot(target, nested, nestedSlot);
    const below = traceBoundarySlot(
      workflow, nodeTypes, nested, nestedSlot, new Set([...visited, definition.id]),
    );
    if (!below || valueIndex === null) return below;
    return { ...below, hops: [{ subgraphId: definition.id, node: target, valueIndex }, ...below.hops] };
  }

  const targetInput = target.inputs?.[link.target_slot];
  const widgetName = targetInput?.widget?.name ?? targetInput?.name;
  if (!widgetName) return null;
  const widgetIndex = getWidgetIndexForInput(workflow, nodeTypes, target, widgetName);
  if (widgetIndex === null) return null;
  return { hops: [], subgraphId: definition.id, node: target, widgetName, widgetIndex };
}

function held(values: unknown, index: number): unknown {
  const value = Array.isArray(values) ? values[index] : undefined;
  return value === null ? undefined : value;
}

/**
 * The value a promoted slot executes with. The host's own entry wins; a host
 * that holds none (templates routinely ship widgets_values: []) falls through
 * to each nested placeholder in turn and finally to the widget itself -- the
 * same order expansion pushes values down in. null reads as "no value" at
 * every level, as it does there.
 */
function effectiveValue(placeholder: WorkflowNode, valueIndex: number, trace: PromotedSlotTrace): unknown {
  const own = held(placeholder.widgets_values, valueIndex);
  if (own !== undefined) return own;
  for (const hop of trace.hops) {
    const value = held(hop.node.widgets_values, hop.valueIndex);
    if (value !== undefined) return value;
  }
  return held(trace.node.widgets_values, trace.widgetIndex);
}

/**
 * The seed a controlled slot currently runs, and whether the host holds it.
 * (A host that holds none executes a value from further down.)
 */
export function promotedSeedValueSource(
  placeholder: WorkflowNode,
  control: PromotedSeedControl,
): { holder: 'placeholder' | 'below'; value: unknown } {
  const own = held(placeholder.widgets_values, control.valueIndex);
  if (own !== undefined) return { holder: 'placeholder', value: own };
  return { holder: 'below', value: effectiveValue(placeholder, control.valueIndex, control.trace) };
}

/** The value a controlled slot runs with when the host's own entry is set aside. */
export function promotedSeedValueBelowHost(control: PromotedSeedControl): unknown {
  for (const hop of control.trace.hops) {
    const value = held(hop.node.widgets_values, hop.valueIndex);
    if (value !== undefined) return value;
  }
  return held(control.node.widgets_values, control.seedWidgetIndex);
}

/**
 * Every promoted seed on `placeholder` whose interior widget carries a
 * control_after_generate, in boundary order. Linked inputs are left out, as
 * stock leaves them out: their value comes from the link, not from the host.
 */
export function resolvePromotedSeedControls(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  placeholder: WorkflowNode,
): PromotedSeedControl[] {
  if (!nodeTypes) return [];
  const definition = findDefinition(workflow, placeholder.type);
  if (!definition) return [];

  const controls: PromotedSeedControl[] = [];
  (placeholder.inputs ?? []).forEach((input, inputSlot) => {
    if (!input.widget || input.link != null) return;
    const boundarySlot = boundarySlotFor(placeholder, definition, inputSlot);
    const valueIndex = getPlaceholderValueIndexForBoundarySlot(placeholder, definition, boundarySlot);
    if (valueIndex === null) return;
    const trace = traceBoundarySlot(workflow, nodeTypes, definition, boundarySlot);
    if (!trace) return;
    const { node, widgetName, widgetIndex } = trace;
    if (String(inputDefinitionType(nodeTypes, node, widgetName)) !== 'INT') return;
    if (nodeTypeStripsSeedControl(node.type) || !Array.isArray(node.widgets_values)) return;
    const mode = node.widgets_values[widgetIndex + 1];
    if (typeof mode !== 'string' || !SEED_MODES.has(mode)) return;
    controls.push({
      inputSlot,
      valueIndex,
      subgraphId: trace.subgraphId,
      node,
      seedWidgetIndex: widgetIndex,
      controlWidgetIndex: widgetIndex + 1,
      mode: mode as SeedMode,
      trace,
    });
  });
  return controls;
}

/**
 * The placeholder's widgets_values with every empty slot below `length` filled
 * with the value it currently executes, ready for a write at `length - 1`.
 *
 * A queue-time write has to land on the placeholder itself -- that is where
 * stock keeps each instance's value, so two instances of one subgraph advance
 * independently -- but writing past the end of a short array would leave null
 * in every slot beneath it, and stock writes a null entry over the inner
 * widget's default. Returns null when some slot's value cannot be traced, so
 * the caller can refuse the write rather than pad.
 */
export function materializePromotedValues(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  placeholder: WorkflowNode,
  length: number,
): unknown[] | null {
  const values = Array.isArray(placeholder.widgets_values) ? [...placeholder.widgets_values] : [];
  const missing = [...Array(length).keys()].filter((index) => held(values, index) === undefined);
  if (missing.length === 0) return values;
  if (!nodeTypes) return null;
  const definition = findDefinition(workflow, placeholder.type);
  if (!definition) return null;

  const traceByValueIndex = new Map<number, PromotedSlotTrace>();
  (definition.inputs ?? []).forEach((_boundary, boundarySlot) => {
    const valueIndex = getPlaceholderValueIndexForBoundarySlot(placeholder, definition, boundarySlot);
    if (valueIndex === null || !missing.includes(valueIndex)) return;
    const trace = traceBoundarySlot(workflow, nodeTypes, definition, boundarySlot);
    if (trace) traceByValueIndex.set(valueIndex, trace);
  });
  for (const index of missing) {
    const trace = traceByValueIndex.get(index);
    const value = trace ? effectiveValue(placeholder, index, trace) : undefined;
    if (value === undefined) return null;
    values[index] = value;
  }
  return values;
}

/**
 * Give every placeholder whose controlled slots it does not hold the values
 * those slots run, so each instance owns its seeds from the start -- what stock
 * serializes after its first run. Run on load, before the dirty and undo
 * baselines, so it is never an edit and queue time only ever writes seeds.
 * Placeholders inside definitions are covered too. A placeholder with a slot
 * that cannot be traced is left alone rather than padded with null.
 */
export function materializeControlledPromotedValues(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
): Workflow {
  if (!nodeTypes || !workflow.definitions?.subgraphs?.length) return workflow;
  const materialize = (node: WorkflowNode): WorkflowNode => {
    const missing = resolvePromotedSeedControls(workflow, nodeTypes, node)
      .filter((control) => held(node.widgets_values, control.valueIndex) === undefined);
    if (missing.length === 0) return node;
    const length = Math.max(...missing.map((control) => control.valueIndex)) + 1;
    const values = materializePromotedValues(workflow, nodeTypes, node, length);
    return values ? { ...node, widgets_values: values } : node;
  };
  let changed = false;
  const nodes = workflow.nodes.map((node) => {
    const next = materialize(node);
    changed ||= next !== node;
    return next;
  });
  const subgraphs = workflow.definitions.subgraphs.map((definition) => {
    const inner = (definition.nodes ?? []).map(materialize);
    if (inner.every((node, index) => node === definition.nodes?.[index])) return definition;
    changed = true;
    return { ...definition, nodes: inner };
  });
  return changed
    ? { ...workflow, nodes, definitions: { ...workflow.definitions, subgraphs } }
    : workflow;
}

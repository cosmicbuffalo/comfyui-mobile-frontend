import { beforeEach, describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import { makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { getPlaceholderValueIndexForBoundarySlot } from '@/utils/widgetDefinitions';
import { getWorkflowForPersistence } from '@/utils/workflowPersistence';

/**
 * One property, over every boundary edit: a promoted widget still shows ITS OWN
 * value afterwards.
 *
 * The suites around this one each answer a narrower question and all of them
 * stayed green through a reorder that rotated every value on the card. The
 * stock-compatibility corpus asks whether the file still loads — a workflow
 * with its values rotated loads perfectly. The reorder cases assert the slot
 * ORDER. Nothing asked whether the value under a name was still that name's.
 *
 * So this reads values back the way the card does, through
 * getPlaceholderValueIndexForBoundarySlot, and checks the whole name-to-value
 * mapping rather than one slot: a swap between two neighbours is invisible if
 * you only look at the one you moved.
 */

const SG = 'sg-a';
const innerKey = (id: number) => makeLocationPointer({ type: 'node', nodeId: id, subgraphId: SG });

/** Distinct, self-identifying values: the assertion message names the culprit. */
const SLOTS = ['alpha', 'beta', 'gamma', 'delta'] as const;
const VALUE_OF: Record<string, string> = Object.fromEntries(
  SLOTS.map((name) => [name, `value-of-${name}`]),
);

function innerNode(id: number, name: string): WorkflowNode {
  return {
    id,
    itemKey: innerKey(id),
    type: 'Sampler',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [{ name, type: 'STRING', link: 100 + id, widget: { name } }],
    outputs: [],
    properties: {},
    widgets_values: [],
  } as unknown as WorkflowNode;
}

function build(names: readonly string[]): Workflow {
  const definition = {
    id: SG,
    name: 'Sub',
    outputs: [],
    groups: [],
    inputs: names.map((name, index) => ({
      id: `i${index}`,
      name,
      type: 'STRING',
      linkIds: [105 + index],
    })),
    nodes: names.map((name, index) => innerNode(5 + index, name)),
    links: names.map((_, index) => ({
      id: 105 + index,
      origin_id: -10,
      origin_slot: index,
      target_id: 5 + index,
      target_slot: 0,
      type: 'STRING',
    })),
  } as unknown as WorkflowSubgraphDefinition;

  const placeholder = {
    id: 99,
    itemKey: makeLocationPointer({ type: 'node', nodeId: 99, subgraphId: null }),
    type: SG,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: names.map((name) => VALUE_OF[name]),
  } as unknown as WorkflowNode;

  return {
    last_node_id: 200,
    last_link_id: 200,
    nodes: [placeholder],
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: { subgraphs: [definition] },
  } as Workflow;
}

const def = () => useWorkflowStore.getState().workflow!.definitions!.subgraphs![0];
const inst = () => useWorkflowStore.getState().workflow!.nodes.find((x) => x.id === 99)!;

/** What the card shows, per slot name — resolved the way the card resolves it. */
function shownBySlotName(): Record<string, unknown> {
  const definition = def();
  const placeholder = inst();
  const values = (placeholder.widgets_values ?? []) as unknown[];
  const shown: Record<string, unknown> = {};
  (definition.inputs ?? []).forEach((slot, index) => {
    const valueIndex = getPlaceholderValueIndexForBoundarySlot(placeholder, definition, index);
    if (slot.name) shown[slot.name] = valueIndex == null ? undefined : values[valueIndex];
  });
  return shown;
}

const expectedFor = (names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, VALUE_OF[name]]));

function enter(names: readonly string[] = SLOTS) {
  useWorkflowStore.setState({
    workflow: build(names),
    scopeStack: [{ type: 'root' }, { type: 'subgraph', id: SG, placeholderNodeId: 99 }],
    itemKeyByPointer: {},
    pointerByHierarchicalKey: {},
    nodeTypes: null,
  });
}

describe('a promoted widget keeps its own value through every boundary edit', () => {
  beforeEach(() => enter());

  // Every from/to pair on a four-slot boundary: adjacent, multi-position, and
  // both directions. The bug that prompted this suite was invisible in one
  // direction and a rotation in the other.
  for (let from = 0; from < SLOTS.length; from += 1) {
    for (let to = 0; to < SLOTS.length; to += 1) {
      if (from === to) continue;
      it(`survives moving slot ${from} to ${to}`, () => {
        useWorkflowStore.getState().moveBoundarySlot('input', from, to);

        const order = [...SLOTS];
        const [moved] = order.splice(from, 1);
        order.splice(to, 0, moved);
        expect((def().inputs ?? []).map((slot) => slot.name)).toEqual(order);
        expect(shownBySlotName()).toEqual(expectedFor(SLOTS));
      });
    }
  }

  it('survives a run of moves, not just one', () => {
    const store = () => useWorkflowStore.getState();
    store().moveBoundarySlot('input', 0, 3);
    store().moveBoundarySlot('input', 1, 0);
    store().moveBoundarySlot('input', 2, 3);
    store().moveBoundarySlot('input', 3, 1);

    expect(shownBySlotName()).toEqual(expectedFor(SLOTS));
  });

  for (let removed = 0; removed < SLOTS.length; removed += 1) {
    it(`leaves the other values alone when slot ${removed} is removed`, () => {
      useWorkflowStore.getState().removeBoundarySlot('input', removed);

      const survivors = SLOTS.filter((_, index) => index !== removed);
      expect(shownBySlotName()).toEqual(expectedFor(survivors));
    });
  }

  it('leaves the other values alone when a slot is removed after a reorder', () => {
    const store = () => useWorkflowStore.getState();
    store().moveBoundarySlot('input', 3, 0);
    // delta now leads; removing the slot that has moved under it is where an
    // index captured before the reorder would take the wrong one.
    store().removeBoundarySlot('input', 0);

    expect(shownBySlotName()).toEqual(expectedFor(['alpha', 'beta', 'gamma']));
  });

  it('renaming for the whole type disturbs no value', () => {
    useWorkflowStore.getState().setBoundarySlotLabel('input', 1, 'Renamed', 'definition');

    // The label changes; the slot NAME, which the values are keyed by, does not.
    expect(shownBySlotName()).toEqual(expectedFor(SLOTS));
  });

  it('still shows every value after a save round trip', () => {
    useWorkflowStore.getState().moveBoundarySlot('input', 0, 3);

    // Everything above checks state in memory. What the user reopens is what
    // went through persistence, which strips and normalizes on the way out —
    // a reorder that looked right in the app and wrong on disk would read as
    // "it forgot my values when I reloaded".
    const saved = getWorkflowForPersistence(useWorkflowStore.getState().workflow!)!;
    const reloaded = JSON.parse(JSON.stringify(saved)) as Workflow;

    const definition = reloaded.definitions!.subgraphs![0];
    const placeholder = reloaded.nodes.find((candidate) => candidate.id === 99)!;
    const values = (placeholder.widgets_values ?? []) as unknown[];
    const shown: Record<string, unknown> = {};
    (definition.inputs ?? []).forEach((slot, index) => {
      const valueIndex = getPlaceholderValueIndexForBoundarySlot(placeholder, definition, index);
      if (slot.name) shown[slot.name] = valueIndex == null ? undefined : values[valueIndex];
    });

    expect(shown).toEqual(expectedFor(SLOTS));
  });
});

/**
 * The same property across INSTANCES, which is where it is most likely to be
 * wrong and hardest to see by hand.
 *
 * A shared type's boundary belongs to the type, so a reorder driven from one
 * instance rewrites the value list of every other one — including instances in
 * other scopes. A browser pass over a real workflow could not settle this:
 * every instance there held identical values, so a rotation between them would
 * have looked like no change at all. Distinct values per instance are the whole
 * point of the fixture.
 */
describe('each instance of a shared type keeps its OWN values', () => {
  const NESTING = 'sg-outer';
  const NAMES = ['alpha', 'beta', 'gamma'] as const;
  const ROOT_VALUES = ['root-alpha', 'root-beta', 'root-gamma'];
  const NESTED_VALUES = ['nested-alpha', 'nested-beta', 'nested-gamma'];

  const instancePlaceholder = (id: number, values: string[]): WorkflowNode => ({
    id,
    itemKey: makeLocationPointer({ type: 'node', nodeId: id, subgraphId: null }),
    type: SG,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: values,
  }) as unknown as WorkflowNode;

  beforeEach(() => {
    const shared = build(NAMES).definitions!.subgraphs![0];
    const workflow = {
      last_node_id: 300,
      last_link_id: 300,
      nodes: [instancePlaceholder(99, ROOT_VALUES), {
        id: 77,
        itemKey: makeLocationPointer({ type: 'node', nodeId: 77, subgraphId: null }),
        type: NESTING,
        pos: [0, 0], size: [10, 10], flags: {}, order: 0, mode: 0,
        inputs: [], outputs: [], properties: {}, widgets_values: [],
      }],
      links: [],
      groups: [],
      config: {},
      version: 1,
      definitions: {
        subgraphs: [
          shared,
          {
            id: NESTING,
            name: 'Outer',
            inputs: [],
            outputs: [],
            groups: [],
            nodes: [instancePlaceholder(88, NESTED_VALUES)],
            links: [],
          } as unknown as WorkflowSubgraphDefinition,
        ],
      },
    } as unknown as Workflow;

    useWorkflowStore.setState({
      workflow,
      scopeStack: [{ type: 'root' }, { type: 'subgraph', id: SG, placeholderNodeId: 99 }],
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
      nodeTypes: null,
    });
  });

  const shownFor = (nodeId: number): Record<string, unknown> => {
    const workflow = useWorkflowStore.getState().workflow!;
    const definition = workflow.definitions!.subgraphs!.find((d) => d.id === SG)!;
    const all = [
      ...workflow.nodes,
      ...(workflow.definitions!.subgraphs ?? []).flatMap((d) => d.nodes ?? []),
    ];
    const placeholder = all.find((candidate) => candidate.id === nodeId)!;
    const values = (placeholder.widgets_values ?? []) as unknown[];
    const shown: Record<string, unknown> = {};
    (definition.inputs ?? []).forEach((slot, index) => {
      const valueIndex = getPlaceholderValueIndexForBoundarySlot(placeholder, definition, index);
      if (slot.name) shown[slot.name] = valueIndex == null ? undefined : values[valueIndex];
    });
    return shown;
  };

  const pairs = (values: string[]) =>
    Object.fromEntries(NAMES.map((name, index) => [name, values[index]]));

  for (let from = 0; from < NAMES.length; from += 1) {
    for (let to = 0; to < NAMES.length; to += 1) {
      if (from === to) continue;
      it(`keeps both instances' values when slot ${from} moves to ${to}`, () => {
        useWorkflowStore.getState().moveBoundarySlot('input', from, to);

        // The instance driving the edit, and the one in another scope that
        // never appeared on screen. Neither may adopt the other's values.
        expect(shownFor(99)).toEqual(pairs(ROOT_VALUES));
        expect(shownFor(88)).toEqual(pairs(NESTED_VALUES));
      });
    }
  }

  it('keeps both instances\' values when a slot is removed', () => {
    useWorkflowStore.getState().removeBoundarySlot('input', 1);

    const survivors = ['alpha', 'gamma'];
    expect(Object.keys(shownFor(99)).sort()).toEqual(survivors);
    expect(shownFor(99)).toEqual({ alpha: 'root-alpha', gamma: 'root-gamma' });
    expect(shownFor(88)).toEqual({ alpha: 'nested-alpha', gamma: 'nested-gamma' });
  });

  it.each([0, 1, 2])('keeps all remaining instance values when slot %i is unpromoted', (slot) => {
    const workflow = useWorkflowStore.getState().workflow!;
    const inner = workflow.definitions!.subgraphs![0].nodes![slot];
    inner.properties = { __lm_widget_ids: [NAMES[slot]] };
    inner.widgets_values = ['shared default'];
    useWorkflowStore.setState({ scopeStack: [{ type: 'root' }] });

    expect(useWorkflowStore.getState().demoteWidget({
      subgraphId: SG, boundarySlot: slot, instanceNodeId: 99,
    })).toBe(true);

    const without = (values: string[]) => Object.fromEntries(
      NAMES.flatMap((name, index) => index === slot ? [] : [[name, values[index]]]),
    );
    expect(shownFor(99)).toEqual(without(ROOT_VALUES));
    expect(shownFor(88)).toEqual(without(NESTED_VALUES));
    expect(useWorkflowStore.getState().workflow!.definitions!.subgraphs![0].nodes![slot].widgets_values)
      .toEqual([ROOT_VALUES[slot]]);
  });
});

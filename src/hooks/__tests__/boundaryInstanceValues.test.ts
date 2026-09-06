import { beforeEach, describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import { makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { expandWorkflowSubgraphs } from '@/utils/expandWorkflowSubgraphs';
import { getPlaceholderValueIndexForBoundarySlot } from '@/utils/widgetDefinitions';

const SG = 'sg-a';
const innerKey = (id: number) => makeLocationPointer({ type: 'node', nodeId: id, subgraphId: SG });

function n(id: number, o: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    itemKey: innerKey(id),
    type: 'Sampler',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...o,
  } as WorkflowNode;
}

const NODE_TYPES = {
  Sampler: {
    input: { required: { steps: ['INT', { default: 20 }], cfg: ['FLOAT', { default: 7 }] } },
    output: [],
    output_name: [],
    name: 'Sampler',
  },
} as never;

function placeholder(o: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
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
    widgets_values: [],
    ...o,
  } as WorkflowNode;
}

function wf(def: WorkflowSubgraphDefinition, nodes: WorkflowNode[]): Workflow {
  return {
    last_node_id: 200,
    last_link_id: 0,
    nodes,
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: { subgraphs: [def] },
  } as Workflow;
}

const def = () => useWorkflowStore.getState().workflow!.definitions!.subgraphs![0];
const inst = () => useWorkflowStore.getState().workflow!.nodes.find((x) => x.id === 99)!;

beforeEach(() => {
  useWorkflowStore.setState({
    workflow: null,
    scopeStack: [{ type: 'root' }],
    itemKeyByPointer: {},
    pointerByHierarchicalKey: {},
    nodeTypes: NODE_TYPES,
  });
});

describe('instance values survive every boundary edit', () => {
  /**
   * The shape that made these edits dangerous: an instance whose proxyWidgets
   * list holds a DIRECT entry as well as a boundary one. The value order is
   * then the proxy list's, not the boundary's, and the two disagree. Shipped
   * templates use this shape constantly.
   */
  function mixedProxyWorkflow() {
    const definition = {
      id: SG,
      name: 'Sub',
      inputs: [{ id: 'i1', name: 'steps', type: 'INT', linkIds: [7] }],
      outputs: [],
      nodes: [
        n(5, {
          inputs: [{ name: 'steps', type: 'INT', link: 7, widget: { name: 'steps' } }],
          widgets_values: [20, 7],
        }),
      ],
      links: [{ id: 7, origin_id: -10, origin_slot: 0, target_id: 5, target_slot: 0, type: 'INT' }],
      groups: [],
    } as unknown as WorkflowSubgraphDefinition;

    return wf(definition, [
      placeholder({
        inputs: [{ name: 'steps', type: 'INT', link: null, widget: { name: 'steps' } }],
        properties: { proxyWidgets: [['5', 'cfg'], ['-1', 'steps']] },
        widgets_values: [7.5, 45],
      }),
    ]);
  }

  const enterSub = (workflow: Workflow) => {
    useWorkflowStore.setState({
      workflow,
      scopeStack: [{ type: 'root' }, { type: 'subgraph', id: SG, placeholderNodeId: 99 }],
    });
  };

  it('carries home the value the card was showing, not the one at the boundary index', () => {
    enterSub(mixedProxyWorkflow());
    // The card reads `steps` at proxy index 1 — the 45.
    expect(getPlaceholderValueIndexForBoundarySlot(inst(), def(), 0)).toBe(1);

    useWorkflowStore.getState().demoteWidget({ nodeKey: innerKey(5), inputName: 'steps' });

    expect(def().nodes.find((x) => x.id === 5)?.widgets_values).toEqual([45, 7]);
    // The direct proxy keeps its own value and its place.
    expect(inst().widgets_values).toEqual([7.5]);
    expect(inst().properties.proxyWidgets).toEqual([['5', 'cfg']]);
  });

  it('removes a slot together with the value and proxy entry that named it', () => {
    const definition = {
      id: SG, name: 'Sub', outputs: [], groups: [],
      inputs: [
        { id: 'i1', name: 'steps', type: 'INT', linkIds: [7] },
        { id: 'i2', name: 'cfg', type: 'FLOAT', linkIds: [8] },
      ],
      nodes: [
        n(5, { inputs: [{ name: 'steps', type: 'INT', link: 7, widget: { name: 'steps' } }] }),
        n(6, { inputs: [{ name: 'cfg', type: 'FLOAT', link: 8, widget: { name: 'cfg' } }] }),
      ],
      links: [
        { id: 7, origin_id: -10, origin_slot: 0, target_id: 5, target_slot: 0, type: 'INT' },
        { id: 8, origin_id: -10, origin_slot: 1, target_id: 6, target_slot: 0, type: 'FLOAT' },
      ],
    } as unknown as WorkflowSubgraphDefinition;
    enterSub(wf(definition, [
      placeholder({
        properties: { proxyWidgets: [['-1', 'steps'], ['-1', 'cfg']] },
        widgets_values: [33, 8.5],
      }),
    ]));

    useWorkflowStore.getState().removeBoundarySlot('input', 0);

    // The survivor keeps ITS value; nothing is left pointing at a slot that has
    // gone, which used to leave the next widget reading undefined. With only
    // boundary entries left, the list says no more than the boundary does and
    // is dropped rather than written as `-1` entries the desktop quarantines.
    expect(inst().properties.proxyWidgets).toBeUndefined();
    expect(inst().widgets_values).toEqual([8.5]);
  });

  it('keeps the value when only one target of a fan-out changes form', () => {
    const definition = {
      id: SG, name: 'Sub', outputs: [], groups: [],
      inputs: [
        { id: 'i1', name: 'steps', type: 'INT', linkIds: [7, 8] },
        { id: 'i2', name: 'cfg', type: 'FLOAT', linkIds: [9] },
      ],
      nodes: [
        n(5, { inputs: [{ name: 'steps', type: 'INT', link: 7, widget: { name: 'steps' } }] }),
        n(6, { inputs: [{ name: 'steps', type: 'INT', link: 8, widget: { name: 'steps' } }] }),
        n(7, { inputs: [{ name: 'cfg', type: 'FLOAT', link: 9, widget: { name: 'cfg' } }] }),
      ],
      links: [
        { id: 7, origin_id: -10, origin_slot: 0, target_id: 5, target_slot: 0, type: 'INT' },
        { id: 8, origin_id: -10, origin_slot: 0, target_id: 6, target_slot: 0, type: 'INT' },
        { id: 9, origin_id: -10, origin_slot: 1, target_id: 7, target_slot: 0, type: 'FLOAT' },
      ],
    } as unknown as WorkflowSubgraphDefinition;
    enterSub(wf(definition, [
      placeholder({
        properties: { proxyWidgets: [['-1', 'steps'], ['-1', 'cfg']] },
        widgets_values: [45, 8.5],
      }),
    ]));

    // Node 5's end becomes a socket; node 6 still drives `steps` as a widget,
    // so the boundary is still widget-backed and still owns its value.
    useWorkflowStore.getState().setPromotedWidgetForm(
      { nodeKey: innerKey(5), inputName: 'steps' },
      'input',
    );

    expect(inst().widgets_values).toEqual([45, 8.5]);
    expect(inst().properties.proxyWidgets).toBeUndefined();
  });

  it('gives a newly widget-backed boundary its own value, seeded from the inner widget', () => {
    const definition = {
      id: SG, name: 'Sub', inputs: [] as unknown[], outputs: [], groups: [],
      nodes: [
        n(4, { type: 'Text', widgets_values: ['a portrait of a cat'] }),
        n(6, {
          inputs: [{ name: 'steps', type: 'INT', link: null, widget: { name: 'steps' } }],
          widgets_values: [20, 7],
        }),
      ],
      links: [],
    } as unknown as WorkflowSubgraphDefinition;
    enterSub(wf(definition, [
      placeholder({
        properties: { proxyWidgets: [['4', 'text']] },
        widgets_values: ['a portrait of a cat'],
      }),
    ]));

    useWorkflowStore.getState().addBoundaryInput({ nodeKey: innerKey(6), inputSlot: 0 });

    // The new widget gets a slot of its own rather than landing on the prompt.
    expect(inst().properties.proxyWidgets).toEqual([['4', 'text'], ['-1', 'steps']]);
    expect(inst().widgets_values).toEqual(['a portrait of a cat', 20]);
    const expanded = expandWorkflowSubgraphs(useWorkflowStore.getState().workflow!, NODE_TYPES);
    const inner = expanded.workflow.nodes.find((x) => x.inputs.some((i) => i.name === 'steps'));
    expect(inner?.widgets_values).toEqual([20, 7]);
  });

  it('keeps a mixed list, which is the case that carries information', () => {
    // A list holding a DIRECT entry says something the boundary cannot: it
    // orders a widget the boundary knows nothing about. That one is written.
    enterSub(mixedProxyWorkflow());
    useWorkflowStore.getState().moveBoundarySlot('input', 0, 0);
    expect(inst().properties.proxyWidgets).toEqual([['5', 'cfg'], ['-1', 'steps']]);
  });

  it('leaves a value it cannot supply absent rather than writing null over it', () => {
    // The desktop frontend's primary path guards on `value !== undefined`, so a
    // null entry is written into the widget store and overwrites the inner
    // widget's default. An index past the end of the array is skipped and the
    // default stands — which is what a slot we have no value for should do.
    const definition = {
      id: SG, name: 'Sub', outputs: [], groups: [],
      inputs: [
        { id: 'i1', name: 'steps', type: 'INT', linkIds: [7] },
        { id: 'i2', name: 'cfg', type: 'FLOAT', linkIds: [8] },
      ],
      nodes: [
        // Neither inner node stores a value, so there is nothing to seed with.
        n(5, {
          inputs: [{ name: 'steps', type: 'INT', link: 7, widget: { name: 'steps' } }],
          widgets_values: [],
        }),
        n(6, {
          inputs: [{ name: 'cfg', type: 'FLOAT', link: 8, widget: { name: 'cfg' } }],
          widgets_values: [],
        }),
      ],
      links: [
        { id: 7, origin_id: -10, origin_slot: 0, target_id: 5, target_slot: 0, type: 'INT' },
        { id: 8, origin_id: -10, origin_slot: 1, target_id: 6, target_slot: 0, type: 'FLOAT' },
      ],
    } as unknown as WorkflowSubgraphDefinition;
    enterSub(wf(definition, [placeholder({ widgets_values: [33] })]));

    // Renaming touches the boundary, so the instance is reconciled.
    useWorkflowStore.getState().setBoundarySlotLabel('input', 0, 'Steps', 'definition');

    // `steps` keeps its 33; `cfg` has no value and gets no null.
    expect(inst().widgets_values).toEqual([33]);
  });

  it('keeps a trailing falsy value that is a real one', () => {
    // The truncation drops trailing nulls, which are not valid widget values.
    // A trailing 0, false or empty string IS a value, and losing it would be
    // the failure this guards against.
    const definition = {
      id: SG, name: 'Sub', outputs: [], groups: [],
      inputs: [
        { id: 'i1', name: 'steps', type: 'INT', linkIds: [7] },
        { id: 'i2', name: 'denoise', type: 'FLOAT', linkIds: [8] },
      ],
      nodes: [
        n(5, {
          inputs: [{ name: 'steps', type: 'INT', link: 7, widget: { name: 'steps' } }],
          widgets_values: [20],
        }),
        n(6, {
          inputs: [{ name: 'denoise', type: 'FLOAT', link: 8, widget: { name: 'denoise' } }],
          widgets_values: [1],
        }),
      ],
      links: [
        { id: 7, origin_id: -10, origin_slot: 0, target_id: 5, target_slot: 0, type: 'INT' },
        { id: 8, origin_id: -10, origin_slot: 1, target_id: 6, target_slot: 0, type: 'FLOAT' },
      ],
    } as unknown as WorkflowSubgraphDefinition;
    enterSub(wf(definition, [placeholder({ widgets_values: [33, 0] })]));

    useWorkflowStore.getState().setBoundarySlotLabel('input', 0, 'Steps', 'definition');

    expect(inst().widgets_values).toEqual([33, 0]);
  });

  it('demotes one target of a fan-out without unpromoting the others', () => {
    // One boundary can drive several inner widgets. Demoting one of them used
    // to remove the slot and every link on it, so the other nodes lost their
    // promotion too — silently, and with the placeholder's value.
    const definition = {
      id: SG, name: 'Sub', outputs: [], groups: [],
      inputs: [{ id: 'i1', name: 'steps', type: 'INT', linkIds: [7, 8] }],
      nodes: [
        n(5, {
          inputs: [{ name: 'steps', type: 'INT', link: 7, widget: { name: 'steps' } }],
          widgets_values: [20],
        }),
        n(6, {
          inputs: [{ name: 'steps', type: 'INT', link: 8, widget: { name: 'steps' } }],
          widgets_values: [20],
        }),
      ],
      links: [
        { id: 7, origin_id: -10, origin_slot: 0, target_id: 5, target_slot: 0, type: 'INT' },
        { id: 8, origin_id: -10, origin_slot: 0, target_id: 6, target_slot: 0, type: 'INT' },
      ],
    } as unknown as WorkflowSubgraphDefinition;
    enterSub(wf(definition, [placeholder({ widgets_values: [45] })]));

    useWorkflowStore.getState().demoteWidget({ nodeKey: innerKey(5), inputName: 'steps' });

    // The boundary survives, still feeding node 6.
    expect(def().inputs?.map((slot) => slot.name)).toEqual(['steps']);
    const remaining = def().links.filter((link) => link.origin_id === -10);
    expect(remaining.map((link) => link.target_id)).toEqual([6]);
    // Node 5 keeps its widget, holding the value the placeholder was showing.
    expect(def().nodes.find((x) => x.id === 5)?.inputs[0]).toMatchObject({
      widget: { name: 'steps' },
      link: null,
    });
    expect(def().nodes.find((x) => x.id === 5)?.widgets_values).toEqual([45]);
    // Node 6 is untouched, and the instance keeps the value it still owns.
    expect(def().nodes.find((x) => x.id === 6)?.inputs[0]?.link).toBe(8);
    expect(inst().widgets_values).toEqual([45]);
  });

  it('removes the boundary when the last target of a fan-out is demoted', () => {
    const definition = {
      id: SG, name: 'Sub', outputs: [], groups: [],
      inputs: [{ id: 'i1', name: 'steps', type: 'INT', linkIds: [7] }],
      nodes: [
        n(5, {
          inputs: [{ name: 'steps', type: 'INT', link: 7, widget: { name: 'steps' } }],
          widgets_values: [20],
        }),
      ],
      links: [
        { id: 7, origin_id: -10, origin_slot: 0, target_id: 5, target_slot: 0, type: 'INT' },
      ],
    } as unknown as WorkflowSubgraphDefinition;
    enterSub(wf(definition, [placeholder({ widgets_values: [45] })]));

    useWorkflowStore.getState().demoteWidget({ nodeKey: innerKey(5), inputName: 'steps' });

    expect(def().inputs ?? []).toEqual([]);
    expect(inst().widgets_values).toEqual([]);
  });

  /**
   * A reorder is the one edit that moves the values itself.
   *
   * Every other boundary edit leaves them where they were and lets the
   * reconcile carry them across by name, which is why it is handed the order
   * they were written against. A reorder has already moved them — so naming the
   * old order made the reconcile move them a SECOND time. Every widget came out
   * holding a neighbour's value, and once the double shift walked one past the
   * end it was dropped as a trailing empty and the widget rendered blank.
   */
  function threeSlotWorkflow() {
    const definition = {
      id: SG, name: 'Sub', outputs: [], groups: [],
      inputs: [
        { id: 'i1', name: 'alpha', type: 'INT', linkIds: [7] },
        { id: 'i2', name: 'beta', type: 'INT', linkIds: [8] },
        { id: 'i3', name: 'gamma', type: 'INT', linkIds: [9] },
      ],
      nodes: [
        n(5, { inputs: [{ name: 'alpha', type: 'INT', link: 7, widget: { name: 'alpha' } }] }),
        n(6, { inputs: [{ name: 'beta', type: 'INT', link: 8, widget: { name: 'beta' } }] }),
        n(7, { inputs: [{ name: 'gamma', type: 'INT', link: 9, widget: { name: 'gamma' } }] }),
      ],
      links: [
        { id: 7, origin_id: -10, origin_slot: 0, target_id: 5, target_slot: 0, type: 'INT' },
        { id: 8, origin_id: -10, origin_slot: 1, target_id: 6, target_slot: 0, type: 'INT' },
        { id: 9, origin_id: -10, origin_slot: 2, target_id: 7, target_slot: 0, type: 'INT' },
      ],
    } as unknown as WorkflowSubgraphDefinition;
    return wf(definition, [placeholder({ widgets_values: [11, 22, 33] })]);
  }

  const slotNames = () => (def().inputs ?? []).map((slot) => slot.name);

  it('carries each value with its slot on an adjacent reorder', () => {
    enterSub(threeSlotWorkflow());

    useWorkflowStore.getState().moveBoundarySlot('input', 0, 1);

    expect(slotNames()).toEqual(['beta', 'alpha', 'gamma']);
    // beta led with 22, alpha follows with 11. Leaving [11, 22, 33] here would
    // mean every widget had quietly adopted its neighbour's value.
    expect(inst().widgets_values).toEqual([22, 11, 33]);
  });

  it('carries each value with its slot across more than one position', () => {
    enterSub(threeSlotWorkflow());

    // The move a card makes when it steps over a two-slot row, such as a
    // promoted seed drawn with its control_after_generate as one block.
    useWorkflowStore.getState().moveBoundarySlot('input', 0, 2);

    expect(slotNames()).toEqual(['beta', 'gamma', 'alpha']);
    expect(inst().widgets_values).toEqual([22, 33, 11]);
  });

  it('loses no value when the moved slot lands last', () => {
    enterSub(threeSlotWorkflow());

    useWorkflowStore.getState().moveBoundarySlot('input', 0, 2);

    // The blank-widget symptom: a value shifted past the end is dropped as a
    // trailing empty, so the count is the tell as much as the order.
    expect(inst().widgets_values).toHaveLength(3);
    expect(inst().widgets_values).not.toContain(null);
  });
});

import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import {
  collectPromotedWidgetViews,
  reorderInstancePromotedValues,
  resolveBoundaryTargetWidgetNames,
  findPromotedWidgetSlot,
  insertPromotedValueOnInstances,
  removePromotedValueFromInstances,
} from '@/utils/promotedWidgetForm';

const SG = 'sg-a';

function node(id: number, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: `key-${id}`,
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
    ...overrides,
  } as WorkflowNode;
}

/**
 * A subgraph whose inner Sampler has `steps` promoted, in whichever form the
 * caller asks for, plus one placeholder instance holding the value.
 */
function makeWorkflow(options?: {
  form?: 'widget' | 'input';
  instanceValues?: unknown[];
  placeholderInputLink?: number | null;
}) {
  const form = options?.form ?? 'widget';
  const inner = node(5, {
    itemKey: `${SG}/node:5`,
    widgets_values: [12],
    inputs: [
      {
        name: 'steps',
        type: 'INT',
        link: 20,
        ...(form === 'widget' ? { widget: { name: 'steps' } } : {}),
      },
    ],
    properties: { __lm_widget_ids: ['steps'] },
  });
  const placeholder = node(99, {
    type: SG,
    widgets_values: options?.instanceValues ?? [30],
    inputs: [
      {
        name: 'steps',
        type: 'INT',
        link: options?.placeholderInputLink ?? null,
        ...(form === 'widget' ? { widget: { name: 'steps' } } : {}),
      },
    ],
    properties: form === 'widget' ? { proxyWidgets: [['-1', 'steps']] } : {},
  });
  const workflow = {
    last_node_id: 99,
    last_link_id: 0,
    nodes: [placeholder],
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: {
      subgraphs: [
        {
          id: SG,
          name: 'Sub',
          inputs: [{ id: 'i1', name: 'steps', type: 'INT', linkIds: [20] }],
          outputs: [],
          nodes: [inner],
          links: [
            { id: 20, origin_id: -10, origin_slot: 0, target_id: 5, target_slot: 0, type: 'INT' },
          ],
          groups: [],
        },
      ],
    },
  } as unknown as Workflow;
  return { workflow, inner, placeholder };
}

const IN_SG = [
  { type: 'root' } as const,
  { type: 'subgraph', id: SG, placeholderNodeId: 99 } as const,
];

describe('findPromotedWidgetSlot', () => {
  it('reports the widget form when the inner slot carries widget metadata', () => {
    const { workflow } = makeWorkflow({ form: 'widget' });
    expect(findPromotedWidgetSlot(workflow.definitions!.subgraphs![0], 5, 'steps')).toMatchObject({
      boundarySlot: 0,
      boundaryName: 'steps',
      form: 'widget',
      targetSlot: 0,
    });
  });

  it('reports the input form when it does not', () => {
    const { workflow } = makeWorkflow({ form: 'input' });
    expect(findPromotedWidgetSlot(workflow.definitions!.subgraphs![0], 5, 'steps')?.form)
      .toBe('input');
  });

  it('finds nothing for a widget that was never promoted', () => {
    const { workflow } = makeWorkflow();
    expect(findPromotedWidgetSlot(workflow.definitions!.subgraphs![0], 5, 'cfg')).toBeNull();
  });
});

describe('collectPromotedWidgetViews', () => {
  it('routes a widget-form promotion to the instance that was entered', () => {
    const { workflow, inner } = makeWorkflow({ instanceValues: [30] });

    const [view] = collectPromotedWidgetViews(workflow, IN_SG, inner, null);

    expect(view).toMatchObject({
      widgetName: 'steps',
      innerWidgetIndex: 0,
      form: 'widget',
      drivenByConnection: false,
      value: 30,
    });
    expect(view.route).toMatchObject({ subgraphId: null, nodeId: 99, widgetIndex: 0 });
  });

  it('leaves an input-form promotion reading its own node, with no route out', () => {
    const { workflow, inner } = makeWorkflow({ form: 'input' });

    const [view] = collectPromotedWidgetViews(workflow, IN_SG, inner, null);

    expect(view).toMatchObject({ form: 'input', route: null, value: undefined });
  });

  it('marks a boundary fed from outside so no control is offered', () => {
    const { workflow, inner } = makeWorkflow({ placeholderInputLink: 77 });

    const [view] = collectPromotedWidgetViews(workflow, IN_SG, inner, null);

    expect(view.drivenByConnection).toBe(true);
  });

  it('sees nothing at root scope', () => {
    const { workflow, inner } = makeWorkflow();
    expect(collectPromotedWidgetViews(workflow, [{ type: 'root' }], inner, null)).toEqual([]);
  });
});

describe('instance value bookkeeping', () => {
  it('inserts a value and proxy entry at the index the boundary order gives it', () => {
    const { workflow } = makeWorkflow({ instanceValues: [1, 2] });
    const patched = insertPromotedValueOnInstances(workflow, SG, 'cfg', 1, 8, [
      'steps',
      'cfg',
    ]);
    const instance = patched.nodes.find((candidate) => candidate.id === 99);
    expect(instance?.widgets_values).toEqual([1, 8, 2]);
    expect(instance?.properties.proxyWidgets).toEqual([['-1', 'steps'], ['-1', 'cfg']]);
  });

  it('removes the value and its proxy entry together', () => {
    const { workflow } = makeWorkflow({ instanceValues: [30] });
    const patched = removePromotedValueFromInstances(workflow, SG, 'steps', 0);
    const instance = patched.nodes.find((candidate) => candidate.id === 99);
    expect(instance?.widgets_values).toEqual([]);
    expect(instance?.properties.proxyWidgets).toEqual([]);
  });

  it('can clear only the proxy entry when the value slot is already gone', () => {
    const { workflow } = makeWorkflow({ instanceValues: [30] });
    const patched = removePromotedValueFromInstances(workflow, SG, 'steps', null);
    const instance = patched.nodes.find((candidate) => candidate.id === 99);
    expect(instance?.widgets_values).toEqual([30]);
    expect(instance?.properties.proxyWidgets).toEqual([]);
  });
});

describe('move targets', () => {
  it('offers no move at either end of the widget list', () => {
    const { workflow, inner } = makeWorkflow();
    // The fixture has a single boundary input, so it is both first and last.
    const [view] = collectPromotedWidgetViews(workflow, IN_SG, inner, null);
    expect(view.boundarySlot).toBe(0);
    expect(view.moveUpTo).toBeNull();
    expect(view.moveDownTo).toBeNull();
  });
});

describe('reorderInstancePromotedValues', () => {
  it('carries each value with its widget rather than leaving it at its index', () => {
    const { workflow } = makeWorkflow({ instanceValues: [12, 7.5] });
    const withProxies = {
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === 99
          ? {
              ...node,
              properties: { proxyWidgets: [['-1', 'steps'], ['-1', 'cfg']] },
            }
          : node,
      ),
    } as Workflow;

    const reordered = reorderInstancePromotedValues(withProxies, SG, {
      oldWidgetNames: ['steps', 'cfg'],
      newWidgetNames: ['cfg', 'steps'],
      newBoundaryNames: ['cfg', 'steps'],
    });

    const instance = reordered.nodes.find((node) => node.id === 99);
    expect(instance?.properties.proxyWidgets).toEqual([['-1', 'cfg'], ['-1', 'steps']]);
    expect(instance?.widgets_values).toEqual([7.5, 12]);
  });

  it('reorders only the boundary entries, and only among themselves', () => {
    // The shape that broke in the wild: proxyWidgets mixes DIRECT entries
    // (naming an inner node) with boundary-routed `-1` entries, and the `-1`
    // names are the LAST widget-backed slots rather than the first. Zipping the
    // `-1` block against the full boundary list renamed those four entries to
    // the first four slots — leaving the values at their indices, so a seed was
    // read as a width and a prompt as a step count. Nothing errored.
    const { workflow } = makeWorkflow({ instanceValues: [] });
    const instance = {
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === 99
          ? {
              ...node,
              properties: {
                proxyWidgets: [
                  ['850', 'width'],
                  ['850', 'height'],
                  ['227', 'steps'],
                  ['-1', 'seed'],
                  ['-1', 'value'],
                  ['-1', 'text'],
                ],
              },
              widgets_values: [1024, 576, 20, 42, 3.5, 'a prompt'],
            }
          : node,
      ),
    } as Workflow;

    const boundaryOrder = ['width', 'height', 'steps', 'end_at_step', 'seed', 'value', 'text'];
    const newOrder = ['width', 'height', 'steps', 'end_at_step', 'text', 'seed', 'value'];
    const reordered = reorderInstancePromotedValues(instance, SG, {
      oldWidgetNames: boundaryOrder,
      // `text` moves above `seed`; the direct-proxied slots are untouched.
      newWidgetNames: newOrder,
      newBoundaryNames: newOrder,
    });

    const patched = reordered.nodes.find((node) => node.id === 99);
    // The direct entries keep their names AND their positions.
    expect(patched?.properties.proxyWidgets).toEqual([
      ['850', 'width'],
      ['850', 'height'],
      ['227', 'steps'],
      ['-1', 'text'],
      ['-1', 'seed'],
      ['-1', 'value'],
    ]);
    // Every value travelled with the entry that names it.
    expect(patched?.widgets_values).toEqual([1024, 576, 20, 'a prompt', 42, 3.5]);
  });

  it('leaves the entries alone when the move does not touch a promoted slot', () => {
    // Moving a slot that is direct-proxied changes no `-1` relative order, so
    // the instance must come back untouched rather than renamed.
    const { workflow } = makeWorkflow({ instanceValues: [] });
    const instance = {
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === 99
          ? {
              ...node,
              properties: { proxyWidgets: [['850', 'width'], ['-1', 'seed'], ['-1', 'text']] },
              widgets_values: [1024, 42, 'a prompt'],
            }
          : node,
      ),
    } as Workflow;

    const reordered = reorderInstancePromotedValues(instance, SG, {
      oldWidgetNames: ['width', 'frame_rate', 'motion', 'seed', 'text'],
      newWidgetNames: ['width', 'motion', 'frame_rate', 'seed', 'text'],
      newBoundaryNames: ['width', 'motion', 'frame_rate', 'seed', 'text'],
    });

    const patched = reordered.nodes.find((node) => node.id === 99);
    expect(patched?.properties.proxyWidgets).toEqual([
      ['850', 'width'],
      ['-1', 'seed'],
      ['-1', 'text'],
    ]);
    expect(patched?.widgets_values).toEqual([1024, 42, 'a prompt']);
  });

  it('places an input-form promotion, which has no widget, by its boundary position', () => {
    // An `input`-form promotion IS a promoted slot with no widget on it, so it
    // appears in proxyWidgets but not in the widget-backed list. Ranking the
    // promoted block against the widget-backed subset alone cannot place it,
    // and it sank to the end of the list on ANY move — including moves that
    // touched nothing promoted, which should be no-ops.
    const { workflow } = makeWorkflow({ instanceValues: [] });
    const instance = {
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === 99
          ? {
              ...node,
              properties: {
                proxyWidgets: [
                  ['850', 'width'],
                  ['-1', 'seed'],
                  ['-1', 'value'],
                  ['-1', 'text'],
                ],
              },
              widgets_values: [1024, 42, 3.5, 'a prompt'],
            }
          : node,
      ),
    } as Workflow;

    // `value` is promoted as an input slot: present on the boundary, absent
    // from the widget-backed list. The move touches neither it nor its
    // neighbours.
    const boundary = ['width', 'frame_rate', 'motion', 'seed', 'value', 'text'];
    const moved = ['width', 'motion', 'frame_rate', 'seed', 'value', 'text'];
    const widgetBacked = ['width', 'frame_rate', 'motion', 'seed', 'text'];

    const reordered = reorderInstancePromotedValues(instance, SG, {
      oldWidgetNames: widgetBacked,
      newWidgetNames: ['width', 'motion', 'frame_rate', 'seed', 'text'],
      newBoundaryNames: moved,
    });

    const patched = reordered.nodes.find((node) => node.id === 99);
    // A genuine no-op: `value` keeps its place between seed and text.
    expect(patched?.properties.proxyWidgets).toEqual([
      ['850', 'width'],
      ['-1', 'seed'],
      ['-1', 'value'],
      ['-1', 'text'],
    ]);
    expect(patched?.widgets_values).toEqual([1024, 42, 3.5, 'a prompt']);
    void boundary;
  });

  it('reorders around an input-form promotion without displacing it', () => {
    const { workflow } = makeWorkflow({ instanceValues: [] });
    const instance = {
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === 99
          ? {
              ...node,
              properties: {
                proxyWidgets: [['-1', 'seed'], ['-1', 'value'], ['-1', 'text']],
              },
              widgets_values: [42, 3.5, 'a prompt'],
            }
          : node,
      ),
    } as Workflow;

    // `text` moves above `seed`; `value` — the widgetless one — stays between
    // whatever now surrounds it, by its own boundary position.
    const reordered = reorderInstancePromotedValues(instance, SG, {
      oldWidgetNames: ['seed', 'text'],
      newWidgetNames: ['text', 'seed'],
      newBoundaryNames: ['text', 'seed', 'value'],
    });

    const patched = reordered.nodes.find((node) => node.id === 99);
    expect(patched?.properties.proxyWidgets).toEqual([
      ['-1', 'text'],
      ['-1', 'seed'],
      ['-1', 'value'],
    ]);
    expect(patched?.widgets_values).toEqual(['a prompt', 42, 3.5]);
  });

  it('permutes by boundary order when the instance lists no proxyWidgets', () => {
    const { workflow } = makeWorkflow({ instanceValues: [12, 7.5] });
    const stripped = {
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === 99 ? { ...node, properties: {} } : node,
      ),
    } as Workflow;

    const reordered = reorderInstancePromotedValues(stripped, SG, {
      oldWidgetNames: ['steps', 'cfg'],
      newWidgetNames: ['cfg', 'steps'],
      newBoundaryNames: ['cfg', 'steps'],
    });

    expect(reordered.nodes.find((node) => node.id === 99)?.widgets_values).toEqual([7.5, 12]);
  });

  it('leaves everything alone when the two orders disagree in length', () => {
    const { workflow } = makeWorkflow({ instanceValues: [12, 7.5] });
    const reordered = reorderInstancePromotedValues(workflow, SG, {
      oldWidgetNames: ['steps'],
      newWidgetNames: ['cfg', 'steps'],
      newBoundaryNames: ['cfg', 'steps'],
    });
    expect(reordered).toBe(workflow);
  });
});

describe('boundary/widget name mapping', () => {
  it('reports what the boundary calls a promoted widget', () => {
    const { workflow, inner } = makeWorkflow();
    workflow.definitions!.subgraphs![0].inputs![0].label = 'Positive prompt';

    const [view] = collectPromotedWidgetViews(workflow, IN_SG, inner, null);

    // The widget is `steps` on the node; the boundary calls its slot something
    // else, which is what the card shows beside it.
    expect(view.widgetName).toBe('steps');
    expect(view.boundaryLabel).toBe('Positive prompt');
  });

  it('falls back to the slot name when the boundary carries no label', () => {
    const { workflow, inner } = makeWorkflow();
    const [view] = collectPromotedWidgetViews(workflow, IN_SG, inner, null);
    expect(view.boundaryLabel).toBe('steps');
  });

  it('names the inner widgets a boundary slot drives', () => {
    const { workflow } = makeWorkflow();
    expect(resolveBoundaryTargetWidgetNames(workflow.definitions!.subgraphs![0], 0))
      .toEqual(['steps']);
    expect(resolveBoundaryTargetWidgetNames(workflow.definitions!.subgraphs![0], 9)).toEqual([]);
    expect(resolveBoundaryTargetWidgetNames(undefined, 0)).toEqual([]);
  });

  it('lists every target of a slot that fans out, without repeating one', () => {
    const { workflow } = makeWorkflow();
    const definition = workflow.definitions!.subgraphs![0];
    definition.nodes.push({
      ...definition.nodes[0],
      id: 6,
      itemKey: `${SG}/node:6`,
      inputs: [{ name: 'cfg', type: 'FLOAT', link: 21, widget: { name: 'cfg' } }],
    });
    definition.links.push({
      id: 21,
      origin_id: -10,
      origin_slot: 0,
      target_id: 6,
      target_slot: 0,
      type: 'FLOAT',
    } as never);

    expect(resolveBoundaryTargetWidgetNames(definition, 0)).toEqual(['steps', 'cfg']);
  });
});

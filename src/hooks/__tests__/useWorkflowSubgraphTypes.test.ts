import { beforeEach, describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import { useWorkflowStore } from '../useWorkflow';
import {
  resolveSubgraphPlaceholderWidgetDefs,
  resolveSubgraphProxyWidgetDefs,
} from '@/utils/widgetDefinitions';

const SG = 'sg-type';

function makeNode(id: number, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: `root/node:${id}`,
    type: 'Any',
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
  };
}

// Definition with one STRING boundary input ("prompt") slot-promoted on the
// placeholder, plus one proxy widget targeting inner node 100's "steps".
function makeTypeWorkflow(): Workflow {
  const def: WorkflowSubgraphDefinition = {
    id: SG,
    name: 'Layer {n}',
    inputs: [{ id: 'i1', name: 'prompt', type: 'STRING', linkIds: [] }],
    outputs: [],
    nodes: [makeNode(100, { type: 'KSampler', widgets_values: [20] })],
    links: [],
    groups: [],
    extra: { 'comfyui-mobile': { nextInstanceNumber: 3 } },
  };
  const placeholder = makeNode(1, {
    type: SG,
    properties: {
      mobileInstanceNumber: 2,
      proxyWidgets: [['100', 'steps']],
    },
    inputs: [{ name: 'prompt', type: 'STRING', widget: { name: 'prompt' }, link: null }],
    widgets_values: ['hello'],
  });
  return {
    last_node_id: 100,
    last_link_id: 0,
    nodes: [placeholder],
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: { subgraphs: [def] },
  };
}

describe('setPromotedWidgetLabel', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: makeTypeWorkflow(),
      scopeStack: [{ type: 'root' }],
      nodeTypes: null,
    });
  });

  const def = () =>
    useWorkflowStore.getState().workflow!.definitions!.subgraphs!.find((sg) => sg.id === SG)!;
  const placeholder = () =>
    useWorkflowStore.getState().workflow!.nodes.find((n) => n.id === 1)!;

  it('writes a slot label onto the definition boundary input, shared and interpolated per instance', () => {
    useWorkflowStore.getState().setPromotedWidgetLabel(SG, { kind: 'slot', slotName: 'prompt' }, 'Prompt {n}');
    expect(def().inputs?.[0]?.label).toBe('Prompt {n}');

    const widgets = resolveSubgraphPlaceholderWidgetDefs(
      placeholder(),
      useWorkflowStore.getState().workflow!,
      null,
    );
    expect(widgets[0]?.name).toBe('Prompt 2'); // instance number 2
  });

  it('clears a slot label with an empty string', () => {
    useWorkflowStore.getState().setPromotedWidgetLabel(SG, { kind: 'slot', slotName: 'prompt' }, 'X');
    useWorkflowStore.getState().setPromotedWidgetLabel(SG, { kind: 'slot', slotName: 'prompt' }, '  ');
    expect(def().inputs?.[0]?.label).toBeUndefined();
  });

  it('stores proxy labels in the definition mobile metadata and renders them', () => {
    useWorkflowStore.getState().setPromotedWidgetLabel(
      SG,
      { kind: 'proxy', innerNodeId: 100, widgetName: 'steps' },
      'Steps {n}',
    );
    const meta = def().extra?.['comfyui-mobile'] as { proxyLabels?: Record<string, string> };
    expect(meta.proxyLabels).toEqual({ '100:steps': 'Steps {n}' });

    // Rendering needs nodeTypes for the inner widget lookup.
    const nodeTypes = {
      KSampler: {
        input: { required: { steps: ['INT', { default: 20 }] } },
        output: [],
        output_name: [],
        name: 'KSampler',
        display_name: 'KSampler',
        description: '',
        python_module: '',
        category: '',
      },
    } as never;
    const widgets = resolveSubgraphProxyWidgetDefs(
      placeholder(),
      useWorkflowStore.getState().workflow!,
      nodeTypes,
    );
    expect(widgets[0]?.name).toBe('Steps 2');
  });

  it('clearing a proxy label falls back to the derived name', () => {
    useWorkflowStore.getState().setPromotedWidgetLabel(
      SG,
      { kind: 'proxy', innerNodeId: 100, widgetName: 'steps' },
      'Custom',
    );
    useWorkflowStore.getState().setPromotedWidgetLabel(
      SG,
      { kind: 'proxy', innerNodeId: 100, widgetName: 'steps' },
      '',
    );
    const meta = def().extra?.['comfyui-mobile'] as { proxyLabels?: Record<string, string> };
    expect(meta.proxyLabels).toEqual({});
  });

  it('no-ops for an unknown definition id', () => {
    const before = useWorkflowStore.getState().workflow;
    useWorkflowStore.getState().setPromotedWidgetLabel('nope', { kind: 'slot', slotName: 'prompt' }, 'X');
    expect(useWorkflowStore.getState().workflow).toBe(before);
  });
});

describe('deleting the type you are standing in', () => {
  beforeEach(() => {
    const wf = makeTypeWorkflow();
    useWorkflowStore.setState({
      workflow: wf,
      scopeStack: [{ type: 'root' }, { type: 'subgraph', id: SG, placeholderNodeId: 1 }],
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
    });
  });

  it('surfaces to root rather than leaving an empty scope behind', () => {
    // The type list is reachable from inside a subgraph, so this is a real
    // route to standing in a definition that no longer exists — an empty node
    // list under a breadcrumb for something that is gone.
    useWorkflowStore.getState().deleteSubgraphType(SG, 'delete');

    expect(useWorkflowStore.getState().scopeStack).toEqual([{ type: 'root' }]);
  });

  it('surfaces to root when the instances are dissolved out instead', () => {
    useWorkflowStore.getState().deleteSubgraphType(SG, 'dissolve');

    expect(useWorkflowStore.getState().scopeStack).toEqual([{ type: 'root' }]);
  });
});

describe('renameSubgraphType / deleteSubgraphType', () => {
  // Two instances of one type, each fed by its own source node.
  const build = () => {
    const wf = makeTypeWorkflow();
    wf.nodes.push(
      makeNode(2, {
        type: SG,
        properties: { mobileInstanceNumber: 3 },
        inputs: [{ name: 'prompt', type: 'STRING', widget: { name: 'prompt' }, link: null }],
        widgets_values: ['second'],
      }),
    );
    // Give the definition a real inner node so dissolve has something to promote.
    return wf;
  };
  const setup = (wf: Workflow) =>
    useWorkflowStore.setState({
      workflow: wf,
      scopeStack: [{ type: 'root' }],
      itemKeyByPointer: { 'root/node:1': 'root/node:1', 'root/node:2': 'root/node:2' },
      pointerByHierarchicalKey: { 'root/node:1': 'root/node:1', 'root/node:2': 'root/node:2' },
      nodeTypes: null,
    });
  const defs = () => useWorkflowStore.getState().workflow?.definitions?.subgraphs ?? [];
  const nodes = () => useWorkflowStore.getState().workflow?.nodes ?? [];

  it('renames the type once for every instance', () => {
    setup(build());
    useWorkflowStore.getState().renameSubgraphType(SG, 'Renamed {n}');
    expect(defs()[0].name).toBe('Renamed {n}');
    // Instances are unchanged; the shared name is what re-titles them.
    expect(nodes().filter((n) => n.type === SG)).toHaveLength(2);
  });

  it('ignores a blank rename', () => {
    setup(build());
    const before = useWorkflowStore.getState().workflow;
    useWorkflowStore.getState().renameSubgraphType(SG, '   ');
    expect(useWorkflowStore.getState().workflow).toBe(before);
  });

  it('deletes an unused type outright', () => {
    const wf = makeTypeWorkflow();
    wf.nodes = []; // no placeholders at all
    setup(wf);
    useWorkflowStore.getState().deleteSubgraphType(SG, 'delete');
    expect(defs()).toHaveLength(0);
  });

  it("delete mode removes every instance and the definition", () => {
    setup(build());
    expect(nodes().filter((n) => n.type === SG)).toHaveLength(2);
    useWorkflowStore.getState().deleteSubgraphType(SG, 'delete');
    expect(defs()).toHaveLength(0);
    expect(nodes().filter((n) => n.type === SG)).toHaveLength(0);
  });

  it('dissolve mode promotes inner nodes and drops the definition', () => {
    setup(build());
    useWorkflowStore.getState().deleteSubgraphType(SG, 'dissolve');
    expect(defs()).toHaveLength(0);
    // No placeholders remain, and the inner KSampler was promoted once per
    // instance (two copies with fresh ids).
    expect(nodes().filter((n) => n.type === SG)).toHaveLength(0);
    expect(nodes().filter((n) => n.type === 'KSampler')).toHaveLength(2);
  });

  it('no-ops for an unknown type id', () => {
    setup(build());
    const before = useWorkflowStore.getState().workflow;
    useWorkflowStore.getState().deleteSubgraphType('nope', 'delete');
    expect(useWorkflowStore.getState().workflow).toBe(before);
  });

  /**
   * A workflow where the type's ONLY instance sits inside another subgraph.
   * Both delete modes used to walk root alone, so such a type reported as "in
   * use" and then had nothing dissolved or deleted.
   */
  const buildNestedOnly = (): Workflow => {
    const wf = makeTypeWorkflow();
    const HOST = 'sg-host';
    const nested = makeNode(2, {
      type: SG,
      properties: { mobileInstanceNumber: 3 },
      inputs: [{ name: 'prompt', type: 'STRING', widget: { name: 'prompt' }, link: null }],
      widgets_values: ['nested'],
    });
    wf.definitions!.subgraphs!.push({
      id: HOST,
      name: 'Host',
      inputs: [],
      outputs: [],
      nodes: [nested],
      links: [],
      groups: [],
    });
    wf.nodes = [makeNode(3, { type: HOST })];
    return wf;
  };
  const nestedNodes = () =>
    useWorkflowStore.getState().workflow?.definitions?.subgraphs?.find(
      (sg) => sg.id === 'sg-host',
    )?.nodes ?? [];

  it('delete mode reaches an instance nested inside another subgraph', () => {
    setup(buildNestedOnly());
    expect(nestedNodes().filter((n) => n.type === SG)).toHaveLength(1);

    useWorkflowStore.getState().deleteSubgraphType(SG, 'delete');

    expect(nestedNodes().filter((n) => n.type === SG)).toHaveLength(0);
    expect(defs().some((d) => d.id === SG)).toBe(false);
  });

  it('dissolve mode reaches a nested instance, promoting into its own scope', () => {
    setup(buildNestedOnly());

    useWorkflowStore.getState().deleteSubgraphType(SG, 'dissolve');

    expect(defs().some((d) => d.id === SG)).toBe(false);
    // The inner node lands in the subgraph that held the placeholder, not root.
    expect(nestedNodes().filter((n) => n.type === 'KSampler')).toHaveLength(1);
    expect(
      (useWorkflowStore.getState().workflow?.nodes ?? []).filter((n) => n.type === 'KSampler'),
    ).toHaveLength(0);
  });
});

describe('replaceSubgraphInstance (store)', () => {
  it('replaces, rebuilds layout, and returns the drop summary', () => {
    const otherDef = {
      id: 'other-type',
      name: 'Other',
      inputs: [{ id: 'x', name: 'different', type: 'LATENT', linkIds: [] }],
      outputs: [],
      nodes: [makeNode(200)],
      links: [],
      groups: [],
      extra: { 'comfyui-mobile': { nextInstanceNumber: 2 } },
    };
    const wf = makeTypeWorkflow();
    wf.definitions!.subgraphs!.push(otherDef);
    // Give the placeholder a live IMAGE feed that can't match the new type.
    wf.nodes.push(
      makeNode(2, { outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [90] }] }),
    );
    wf.nodes[0].inputs = [
      ...wf.nodes[0].inputs!,
      { name: 'image', type: 'IMAGE', link: 90 },
    ];
    wf.links = [[90, 2, 0, 1, 1, 'IMAGE']];
    useWorkflowStore.setState({
      workflow: wf,
      scopeStack: [{ type: 'root' }],
      itemKeyByPointer: { 'root/node:1': 'root/node:1', 'root/node:2': 'root/node:2' },
      pointerByHierarchicalKey: { 'root/node:1': 'root/node:1', 'root/node:2': 'root/node:2' },
    });

    const dropped = useWorkflowStore
      .getState()
      .replaceSubgraphInstance('root/node:1', 'other-type');

    expect(dropped).toEqual([
      { direction: 'input', slotName: 'image', slotType: 'IMAGE', peerNodeTitle: 'Any' },
    ]);
    const next = useWorkflowStore.getState().workflow!;
    const replaced = next.nodes.find((n) => n.id === 1)!;
    expect(replaced.type).toBe('other-type');
    expect(replaced.itemKey).toBeTruthy(); // re-annotated
    // The old definition survives with zero instances: every definition is a
    // type, and a type is not deleted by having its last instance swapped away.
    expect(next.definitions!.subgraphs!.map((d) => d.id).sort()).toEqual([
      'other-type',
      SG,
    ].sort());
  });
});

describe('setInstanceWidgetLabel', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: makeTypeWorkflow(),
      scopeStack: [{ type: 'root' }],
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
    });
  });

  const placeholder = () => useWorkflowStore.getState().workflow?.nodes.find((n) => n.id === 1);
  const definition = () =>
    useWorkflowStore.getState().workflow?.definitions?.subgraphs?.find((sg) => sg.id === SG);

  it('writes a boundary slot name onto the one placeholder, not the type', () => {
    useWorkflowStore
      .getState()
      .setInstanceWidgetLabel('root/node:1', { kind: 'slot', direction: 'input', slotName: 'prompt' }, 'Positive');

    expect(placeholder()?.properties?.mobileSlotLabels).toEqual({ 'input:prompt': 'Positive' });
    expect(definition()?.inputs?.[0]?.label).toBeUndefined();
  });

  it('writes a proxy widget name onto the same instance map', () => {
    useWorkflowStore
      .getState()
      .setInstanceWidgetLabel('root/node:1', { kind: 'proxy', innerNodeId: 100, widgetName: 'steps' }, 'Detail');

    expect(placeholder()?.properties?.mobileSlotLabels).toEqual({ 'proxy:100:steps': 'Detail' });
  });

  it('shows the instance name on the card, over the type name', () => {
    useWorkflowStore
      .getState()
      .setPromotedWidgetLabel(SG, { kind: 'slot', slotName: 'prompt' }, 'Prompt {n}');
    useWorkflowStore
      .getState()
      .setInstanceWidgetLabel('root/node:1', { kind: 'slot', direction: 'input', slotName: 'prompt' }, 'Positive {n}');

    const widgets = resolveSubgraphPlaceholderWidgetDefs(
      placeholder() as WorkflowNode,
      useWorkflowStore.getState().workflow as Workflow,
      null,
    );
    // The instance override wins, and still renders its own {n}.
    expect(widgets[0]?.name).toBe('Positive 2');
  });

  it('shows an instance proxy name over the type proxy name', () => {
    useWorkflowStore
      .getState()
      .setPromotedWidgetLabel(SG, { kind: 'proxy', innerNodeId: 100, widgetName: 'steps' }, 'Shared');
    useWorkflowStore
      .getState()
      .setInstanceWidgetLabel('root/node:1', { kind: 'proxy', innerNodeId: 100, widgetName: 'steps' }, 'Detail');

    const nodeTypes = {
      KSampler: {
        input: { required: { steps: ['INT', { default: 20 }] } },
        output: [],
        output_name: [],
        name: 'KSampler',
        display_name: 'KSampler',
        description: '',
        python_module: '',
        category: '',
      },
    } as never;
    const widgets = resolveSubgraphProxyWidgetDefs(
      placeholder() as WorkflowNode,
      useWorkflowStore.getState().workflow as Workflow,
      nodeTypes,
    );
    expect(widgets[0]?.name).toBe('Detail');
  });

  it('clearing an instance name falls back to the type name', () => {
    useWorkflowStore
      .getState()
      .setPromotedWidgetLabel(SG, { kind: 'slot', slotName: 'prompt' }, 'Prompt');
    useWorkflowStore
      .getState()
      .setInstanceWidgetLabel('root/node:1', { kind: 'slot', direction: 'input', slotName: 'prompt' }, 'Positive');

    useWorkflowStore
      .getState()
      .setInstanceWidgetLabel('root/node:1', { kind: 'slot', direction: 'input', slotName: 'prompt' }, '  ');

    expect(placeholder()?.properties?.mobileSlotLabels).toBeUndefined();
    const widgets = resolveSubgraphPlaceholderWidgetDefs(
      placeholder() as WorkflowNode,
      useWorkflowStore.getState().workflow as Workflow,
      null,
    );
    expect(widgets[0]?.name).toBe('Prompt');
  });

  it('is a no-op when nothing would change', () => {
    const before = useWorkflowStore.getState().workflow;
    useWorkflowStore
      .getState()
      .setInstanceWidgetLabel('root/node:1', { kind: 'slot', direction: 'input', slotName: 'prompt' }, '');

    // A fresh workflow object here would dirty the tab for nothing.
    expect(useWorkflowStore.getState().workflow).toBe(before);
  });

  it('ignores a key that resolves to no node', () => {
    useWorkflowStore
      .getState()
      .setInstanceWidgetLabel('root/node:404', { kind: 'slot', direction: 'input', slotName: 'prompt' }, 'X');

    expect(placeholder()?.properties?.mobileSlotLabels).toBeUndefined();
  });
});

describe('forkSubgraphType', () => {
  /** Three instances of one type, all at root. */
  const build = () => {
    const wf = makeTypeWorkflow();
    wf.nodes.push(
      makeNode(2, { type: SG, properties: { mobileInstanceNumber: 2 } }),
      makeNode(3, { type: SG, properties: { mobileInstanceNumber: 3 } }),
    );
    return wf;
  };

  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: build(),
      scopeStack: [{ type: 'root' }],
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
      nodeTypes: null,
    });
  });

  const defs = () => useWorkflowStore.getState().workflow?.definitions?.subgraphs ?? [];
  const nodes = () => useWorkflowStore.getState().workflow?.nodes ?? [];

  it('moves the chosen instances onto a new type and leaves the rest behind', () => {
    const newId = useWorkflowStore.getState().forkSubgraphType(SG, [1, 3], 'Variant');

    expect(newId).toBeTruthy();
    expect(defs().map((d) => d.id)).toContain(newId);
    expect(nodes().filter((n) => n.type === newId).map((n) => n.id)).toEqual([1, 3]);
    // Instance 2 was not chosen, so it still follows the original.
    expect(nodes().filter((n) => n.type === SG).map((n) => n.id)).toEqual([2]);
  });

  it('numbers the moved instances afresh within the new type', () => {
    const newId = useWorkflowStore.getState().forkSubgraphType(SG, [1, 3], 'Variant');

    // They were 1 and 3 in the old type; in the new one they are its 1 and 2.
    const moved = nodes().filter((n) => n.type === newId);
    expect(moved.map((n) => n.properties?.mobileInstanceNumber)).toEqual([1, 2]);
    const forked = defs().find((d) => d.id === newId)!;
    const meta = forked.extra?.['comfyui-mobile'] as { nextInstanceNumber?: number };
    expect(meta).toMatchObject({ nextInstanceNumber: 3 });
  });

  it('gives the fork its own copy of the body, so the two can diverge', () => {
    const newId = useWorkflowStore.getState().forkSubgraphType(SG, [1], 'Variant');

    const original = defs().find((d) => d.id === SG)!;
    const forked = defs().find((d) => d.id === newId)!;
    expect(forked.name).toBe('Variant');
    expect(original.name).toBe('Layer {n}');
    // Same shape, different objects and different inner node ids.
    expect(forked.nodes).toHaveLength(original.nodes.length);
    expect(forked.nodes[0].id).not.toBe(original.nodes[0].id);
    expect(forked.nodes[0]).not.toBe(original.nodes[0]);
  });

  it('keeps the original name when the fork is given a blank one', () => {
    const newId = useWorkflowStore.getState().forkSubgraphType(SG, [1], '   ');
    expect(defs().find((d) => d.id === newId)?.name).toBe('Layer {n}');
  });

  it('does nothing when no instance was chosen', () => {
    const before = useWorkflowStore.getState().workflow;
    expect(useWorkflowStore.getState().forkSubgraphType(SG, [], 'Variant')).toBeNull();
    expect(useWorkflowStore.getState().workflow).toBe(before);
  });

  it('ignores node ids that are not instances of this type', () => {
    const before = useWorkflowStore.getState().workflow;
    expect(useWorkflowStore.getState().forkSubgraphType(SG, [999], 'Variant')).toBeNull();
    expect(useWorkflowStore.getState().workflow).toBe(before);
  });

  it('no-ops for an unknown type id', () => {
    expect(useWorkflowStore.getState().forkSubgraphType('nope', [1], 'Variant')).toBeNull();
  });
});

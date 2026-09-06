import { beforeEach, describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import { makeLocationPointer } from '@/utils/mobileLayout';
import { validateAndNormalizeWorkflow } from '@/utils/workflowValidator';
import { normalizeSubgraphPlaceholders } from '@/utils/normalizeSubgraphPlaceholders';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowUndoStore } from '../useWorkflowUndo';
import { expandWorkflowSubgraphs } from '@/utils/expandWorkflowSubgraphs';

const SG = 'sg-a';

const innerKey = (nodeId: number) =>
  makeLocationPointer({ type: 'node', nodeId, subgraphId: SG });

function innerNode(id: number, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: innerKey(id),
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

// Subgraph with input slot 0 ("clip") feeding node 1, and output slot 0
// ("image") fed by node 2. Nodes 3 and 4 are spare CLIP consumers / IMAGE
// producers for retargeting.
function makeSubgraphWorkflow(defOverrides?: Partial<WorkflowSubgraphDefinition>): Workflow {
  const def: WorkflowSubgraphDefinition = {
    id: SG,
    name: 'Sub',
    // The envelope the desktop frontend loads a definition through. Present
    // on every real one, so a fixture without it would read as a definition
    // needing repair rather than a valid one.
    inputNode: { id: -10, bounding: [-400, 0, 120, 60] },
    outputNode: { id: -20, bounding: [400, 0, 120, 60] },
    version: 1,
    revision: 0,
    state: { lastGroupId: 0, lastNodeId: 4, lastLinkId: 9, lastRerouteId: 0 },
    inputs: [{ id: 'i1', name: 'clip', type: 'CLIP', linkIds: [7] }],
    outputs: [{ id: 'o1', name: 'image', type: 'IMAGE', linkIds: [9] }],
    nodes: [
      innerNode(1, { inputs: [{ name: 'clip', type: 'CLIP', link: 7 }] }),
      innerNode(2, { outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [9] }] }),
      innerNode(3, { inputs: [{ name: 'clip', type: 'CLIP', link: null }] }),
      innerNode(4, { outputs: [{ name: 'IMAGE', type: 'IMAGE', links: null }] }),
    ],
    links: [
      { id: 7, origin_id: -10, origin_slot: 0, target_id: 1, target_slot: 0, type: 'CLIP' },
      { id: 9, origin_id: 2, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
    ],
    groups: [],
    ...defOverrides,
  };
  return {
    last_node_id: 4,
    last_link_id: 9,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: { subgraphs: [def] },
  };
}

function enterScope(workflow: Workflow) {
  useWorkflowStore.setState({
    workflow,
    scopeStack: [
      { type: 'root' },
      { type: 'subgraph', id: SG, placeholderNodeId: 99 },
    ],
  });
}

const currentDef = () =>
  useWorkflowStore.getState().workflow?.definitions?.subgraphs?.find((sg) => sg.id === SG);

describe('boundary edit actions', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: null,
      scopeStack: [{ type: 'root' }],
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
    });
  });

  it('connectBoundaryInput replaces the fan-out and keeps linkIds fresh', () => {
    enterScope(makeSubgraphWorkflow());

    useWorkflowStore.getState().connectBoundaryInput(0, [
      { nodeKey: innerKey(1), inputSlot: 0 },
      { nodeKey: innerKey(3), inputSlot: 0 },
    ]);

    const def = currentDef();
    const boundaryLinks = (def?.links ?? []).filter((l) => l.origin_id === -10);
    expect(boundaryLinks).toHaveLength(2);
    // Old boundary link 7 is gone; new ids mint above the scope's max (9).
    expect(boundaryLinks.map((l) => l.id)).toEqual([10, 11]);
    expect(boundaryLinks.every((l) => l.origin_slot === 0 && l.type === 'CLIP')).toBe(true);
    expect(new Set(boundaryLinks.map((l) => l.target_id))).toEqual(new Set([1, 3]));
    expect(def?.nodes.find((n) => n.id === 1)?.inputs[0]?.link).toBe(10);
    expect(def?.nodes.find((n) => n.id === 3)?.inputs[0]?.link).toBe(11);
    // Derived cache matches what save-time repair would rebuild.
    expect(def?.inputs?.[0]?.linkIds).toEqual([10, 11]);
  });

  it('connectBoundaryInput clears the previous target when retargeting', () => {
    enterScope(makeSubgraphWorkflow());

    useWorkflowStore.getState().connectBoundaryInput(0, [{ nodeKey: innerKey(3), inputSlot: 0 }]);

    const def = currentDef();
    expect(def?.nodes.find((n) => n.id === 1)?.inputs[0]?.link).toBeNull();
    expect(def?.nodes.find((n) => n.id === 3)?.inputs[0]?.link).toBe(10);
    expect(def?.inputs?.[0]?.linkIds).toEqual([10]);
  });

  it('connectBoundaryInput displaces a regular link already feeding a chosen target', () => {
    const wf = makeSubgraphWorkflow();
    const def = wf.definitions!.subgraphs![0];
    // Node 4 (as a CLIP source here) feeds node 3 via regular link 12.
    def.nodes = def.nodes.map((n) => {
      if (n.id === 3) return { ...n, inputs: [{ name: 'clip', type: 'CLIP', link: 12 }] };
      if (n.id === 4) return { ...n, outputs: [{ name: 'CLIP', type: 'CLIP', links: [12] }] };
      return n;
    });
    def.links = [...def.links, { id: 12, origin_id: 4, origin_slot: 0, target_id: 3, target_slot: 0, type: 'CLIP' }];
    enterScope(wf);

    useWorkflowStore.getState().connectBoundaryInput(0, [
      { nodeKey: innerKey(1), inputSlot: 0 },
      { nodeKey: innerKey(3), inputSlot: 0 },
    ]);

    const next = currentDef();
    expect(next?.links.some((l) => l.id === 12)).toBe(false);
    expect(next?.nodes.find((n) => n.id === 4)?.outputs[0]?.links).toBeNull();
    expect(next?.nodes.find((n) => n.id === 3)?.inputs[0]?.link).toBe(14);
  });

  it('connectBoundaryInput with a stale key commits nothing', () => {
    const wf = makeSubgraphWorkflow();
    enterScope(wf);

    useWorkflowStore.getState().connectBoundaryInput(0, [
      { nodeKey: innerKey(1), inputSlot: 0 },
      { nodeKey: innerKey(77), inputSlot: 0 },
    ]);

    expect(useWorkflowStore.getState().workflow).toBe(wf);
  });

  it('connectBoundaryOutput replaces the feeder and maintains output.links', () => {
    enterScope(makeSubgraphWorkflow());

    useWorkflowStore.getState().connectBoundaryOutput(0, { nodeKey: innerKey(4), outputSlot: 0 });

    const def = currentDef();
    const boundaryLinks = (def?.links ?? []).filter((l) => l.target_id === -20);
    expect(boundaryLinks).toHaveLength(1);
    expect(boundaryLinks[0]).toMatchObject({ id: 10, origin_id: 4, origin_slot: 0, target_slot: 0, type: 'IMAGE' });
    expect(def?.nodes.find((n) => n.id === 2)?.outputs[0]?.links).toBeNull();
    expect(def?.nodes.find((n) => n.id === 4)?.outputs[0]?.links).toEqual([10]);
    expect(def?.outputs?.[0]?.linkIds).toEqual([10]);
  });

  it('connectBoundaryOutput(null) disconnects the slot', () => {
    enterScope(makeSubgraphWorkflow());

    useWorkflowStore.getState().connectBoundaryOutput(0, null);

    const def = currentDef();
    expect((def?.links ?? []).filter((l) => l.target_id === -20)).toHaveLength(0);
    expect(def?.nodes.find((n) => n.id === 2)?.outputs[0]?.links).toBeNull();
    expect(def?.outputs?.[0]?.linkIds).toEqual([]);
  });

  it('disconnectBoundaryLink removes one link from a fan-out only', () => {
    const wf = makeSubgraphWorkflow();
    const def = wf.definitions!.subgraphs![0];
    def.nodes = def.nodes.map((n) =>
      n.id === 3 ? { ...n, inputs: [{ name: 'clip', type: 'CLIP', link: 8 }] } : n,
    );
    def.links = [...def.links, { id: 8, origin_id: -10, origin_slot: 0, target_id: 3, target_slot: 0, type: 'CLIP' }];
    def.inputs = [{ ...def.inputs![0], linkIds: [7, 8] }];
    enterScope(wf);

    useWorkflowStore.getState().disconnectBoundaryLink('input', 0, 3, 0);

    const next = currentDef();
    expect(next?.nodes.find((n) => n.id === 3)?.inputs[0]?.link).toBeNull();
    expect(next?.nodes.find((n) => n.id === 1)?.inputs[0]?.link).toBe(7);
    expect(next?.inputs?.[0]?.linkIds).toEqual([7]);
  });

  it('save-time repair is a no-op after boundary edits', () => {
    enterScope(makeSubgraphWorkflow());
    useWorkflowStore.getState().connectBoundaryInput(0, [{ nodeKey: innerKey(3), inputSlot: 0 }]);
    useWorkflowStore.getState().connectBoundaryOutput(0, { nodeKey: innerKey(4), outputSlot: 0 });

    const workflow = useWorkflowStore.getState().workflow!;
    const repaired = validateAndNormalizeWorkflow(workflow);
    expect(repaired.definitions?.subgraphs).toEqual(workflow.definitions?.subgraphs);
  });

  it('no-ops at root scope', () => {
    const wf = makeSubgraphWorkflow();
    useWorkflowStore.setState({ workflow: wf, scopeStack: [{ type: 'root' }] });

    useWorkflowStore.getState().connectBoundaryInput(0, [{ nodeKey: innerKey(3), inputSlot: 0 }]);
    useWorkflowStore.getState().connectBoundaryOutput(0, null);
    useWorkflowStore.getState().disconnectBoundaryLink('input', 0, 1, 0);

    expect(useWorkflowStore.getState().workflow).toBe(wf);
  });

  it('records one undo step per boundary action and round-trips', () => {
    useWorkflowUndoStore.setState({ histories: {} });
    const wf = makeSubgraphWorkflow();
    useWorkflowStore.setState({
      workflow: wf,
      scopeStack: [
        { type: 'root' },
        { type: 'subgraph', id: SG, placeholderNodeId: 99 },
      ],
      activeSessionId: 'tab-T',
      workflowLoadedAt: 12345,
      nodeTypes: null,
    });
    useWorkflowUndoStore.setState({ histories: {} });

    useWorkflowStore.getState().connectBoundaryInput(0, [{ nodeKey: innerKey(3), inputSlot: 0 }]);

    const undoLen = () => useWorkflowUndoStore.getState().histories['tab-T']?.undo.length ?? 0;
    expect(undoLen()).toBe(1);

    useWorkflowUndoStore.getState().undo();
    const def = currentDef();
    expect(def?.nodes.find((n) => n.id === 1)?.inputs[0]?.link).toBe(7);
    expect(def?.inputs?.[0]?.linkIds).toEqual([7]);
  });

  describe('promoting and demoting boundary slots', () => {
    /** A placeholder instance at root, so slot rebuild and widgets_values can
     *  be asserted on something real. */
    function withInstance(workflow: Workflow, widgetsValues: unknown[] = []): Workflow {
      return {
        ...workflow,
        nodes: [
          {
            id: 99,
            itemKey: makeLocationPointer({ type: 'node', nodeId: 99, subgraphId: null }),
            type: SG,
            pos: [0, 0],
            size: [200, 100],
            flags: {},
            order: 0,
            mode: 0,
            inputs: [{ name: 'clip', type: 'CLIP', link: null }],
            outputs: [{ name: 'image', type: 'IMAGE', links: null }],
            properties: {},
            widgets_values: widgetsValues,
          } as WorkflowNode,
        ],
      };
    }

    it('addBoundaryInput appends a slot, wires it, and gives every instance the port', () => {
      enterScope(withInstance(makeSubgraphWorkflow()));

      useWorkflowStore.getState().addBoundaryInput({ nodeKey: innerKey(3), inputSlot: 0 });

      const def = currentDef();
      expect(def?.inputs?.map((slot) => slot.name)).toEqual(['clip', 'clip_1']);
      // Appended, so no existing slot index — or widgets_values index — moves.
      expect(def?.inputs?.[0]?.linkIds).toEqual([7]);
      const added = (def?.links ?? []).find((link) => link.origin_slot === 1);
      expect(added).toMatchObject({ origin_id: -10, target_id: 3, target_slot: 0, type: 'CLIP' });
      expect(def?.nodes.find((n) => n.id === 3)?.inputs[0]?.link).toBe(added?.id);
      expect(def?.inputs?.[1]?.linkIds).toEqual([added?.id]);

      // The placeholder is rebuilt from the definition, so it gains the port.
      const placeholder = useWorkflowStore.getState().workflow?.nodes.find((n) => n.id === 99);
      expect(placeholder?.inputs.map((input) => input.name)).toEqual(['clip', 'clip_1']);
    });

    it('promoteWidget materializes the input and seeds every placeholder instance', () => {
      const workflow = withInstance(makeSubgraphWorkflow());
      const definition = workflow.definitions!.subgraphs![0];
      definition.nodes.push(innerNode(5, {
        type: 'Sampler',
        widgets_values: [12],
      }));
      workflow.nodes.push({
        ...workflow.nodes[0],
        id: 100,
        itemKey: makeLocationPointer({ type: 'node', nodeId: 100, subgraphId: null }),
      });
      enterScope(workflow);

      const promoted = useWorkflowStore.getState().promoteWidget({
        nodeKey: innerKey(5),
        inputName: 'steps',
        inputType: 'INT',
        value: 12,
      });

      expect(promoted).toBe(true);
      const def = currentDef();
      expect(def?.inputs?.at(-1)).toMatchObject({ name: 'steps', type: 'INT' });
      const addedLink = def?.links.find((link) => link.target_id === 5);
      expect(addedLink).toMatchObject({ origin_id: -10, origin_slot: 1, target_slot: 0, type: 'INT' });
      expect(def?.nodes.find((candidate) => candidate.id === 5)?.inputs[0]).toMatchObject({
        name: 'steps',
        type: 'INT',
        link: addedLink?.id,
        widget: { name: 'steps' },
      });
      for (const instance of useWorkflowStore.getState().workflow?.nodes ?? []) {
        expect(instance.inputs.at(-1)).toMatchObject({ name: 'steps', widget: { name: 'steps' } });
        // Only boundary entries, in boundary order: the list would say nothing
        // the boundary does not, so it is left off.
        expect(instance.properties.proxyWidgets).toBeUndefined();
        expect(instance.widgets_values).toEqual([12]);
      }

      expect(useWorkflowStore.getState().promoteWidget({
        nodeKey: innerKey(5),
        inputName: 'steps',
        inputType: 'INT',
        value: 12,
      })).toBe(false);
      expect(currentDef()?.inputs).toHaveLength(2);
    });

    // A subgraph holding one Sampler with a `steps` widget, plus a second
    // placeholder instance, is enough to exercise both promotion forms.
    function withSampler() {
      const workflow = withInstance(makeSubgraphWorkflow());
      workflow.definitions!.subgraphs![0].nodes.push(innerNode(5, {
        type: 'Sampler',
        widgets_values: [12],
      }));
      enterScope(workflow);
      // A real session always has node definitions loaded; they are what says
      // which widgets_values slot `steps` owns on the inner node.
      useWorkflowStore.setState({
        nodeTypes: {
          Sampler: {
            input: { required: { steps: ['INT', { default: 20 }] } },
            output: [],
            output_name: [],
            name: 'Sampler',
          },
        } as never,
      });
      return workflow;
    }

    const promoteTarget = { nodeKey: innerKey(5), inputName: 'steps', inputType: 'INT', value: 12 };
    const innerSampler = () => currentDef()?.nodes.find((node) => node.id === 5);
    const placeholder = () =>
      useWorkflowStore.getState().workflow?.nodes.find((node) => node.id === 99);

    it('records one undo step per promotion action, and round-trips', () => {
      // demoteWidget writes three times — the value coming home, the slot
      // removal, and clearing the proxy entry — which recorded as three undo
      // steps until they were bracketed. One user action, one undo.
      useWorkflowUndoStore.setState({ histories: {} });
      withSampler();
      useWorkflowStore.setState({ activeSessionId: 'tab-U', workflowLoadedAt: 1 });
      useWorkflowUndoStore.setState({ histories: {} });
      const undoLen = () => useWorkflowUndoStore.getState().histories['tab-U']?.undo.length ?? 0;

      useWorkflowStore.getState().promoteWidget(promoteTarget);
      expect(undoLen()).toBe(1);
      const promoted = JSON.stringify(useWorkflowStore.getState().workflow);

      useWorkflowStore.getState().setPromotedWidgetForm(
        { nodeKey: innerKey(5), inputName: 'steps' },
        'input',
      );
      expect(undoLen()).toBe(2);

      useWorkflowStore.getState().setPromotedWidgetForm(
        { nodeKey: innerKey(5), inputName: 'steps' },
        'widget',
      );
      useWorkflowStore.getState().demoteWidget({ nodeKey: innerKey(5), inputName: 'steps' });
      expect(undoLen()).toBe(4);

      // One undo puts the whole demotion back.
      useWorkflowUndoStore.getState().undo();
      expect(JSON.stringify(useWorkflowStore.getState().workflow)).toBe(promoted);
    });

    it('promotes as a plain input slot when asked, leaving the value on the inner node', () => {
      withSampler();

      expect(useWorkflowStore.getState().promoteWidget(promoteTarget, { form: 'input' })).toBe(true);

      // The boundary slot and its link are the same as the widget form's...
      const def = currentDef();
      expect(def?.inputs?.at(-1)).toMatchObject({ name: 'steps', type: 'INT' });
      const link = def?.links.find((candidate) => candidate.target_id === 5);
      expect(link).toMatchObject({ origin_id: -10, target_slot: 0 });
      // ...but the inner slot carries no widget, so nothing downstream reads it
      // as widget-backed: the placeholder shows a socket and owns no value.
      expect(innerSampler()?.inputs[0]?.widget).toBeUndefined();
      expect(placeholder()?.inputs.at(-1)?.widget).toBeUndefined();
      expect(placeholder()?.widgets_values).toEqual([]);
      expect(placeholder()?.properties.proxyWidgets ?? []).toEqual([]);
      // The value stayed where it was.
      expect(innerSampler()?.widgets_values).toEqual([12]);
    });

    it('converts a promoted widget into an input slot, carrying the value home', () => {
      withSampler();
      useWorkflowStore.getState().promoteWidget(promoteTarget);
      // The instance edits its own copy; that is the value that must survive.
      useWorkflowStore.setState({
        workflow: {
          ...useWorkflowStore.getState().workflow!,
          nodes: useWorkflowStore.getState().workflow!.nodes.map((node) =>
            node.id === 99 ? { ...node, widgets_values: [30] } : node,
          ),
        },
      });

      expect(
        useWorkflowStore.getState().setPromotedWidgetForm(
          { nodeKey: innerKey(5), inputName: 'steps' },
          'input',
        ),
      ).toBe(true);

      expect(innerSampler()?.inputs[0]?.widget).toBeUndefined();
      expect(innerSampler()?.widgets_values).toEqual([30]);
      // The boundary no longer backs a widget, so the instance keeps no value
      // for it and the empty proxy list is removed rather than left behind.
      expect(placeholder()?.widgets_values).toEqual([]);
      expect(placeholder()?.properties.proxyWidgets).toBeUndefined();
      // The boundary slot itself is untouched — this is a change of form, not
      // an unpromotion.
      expect(currentDef()?.inputs?.at(-1)).toMatchObject({ name: 'steps' });
      expect(currentDef()?.links.some((link) => link.target_id === 5)).toBe(true);
    });

    it('converts an input slot into a widget, seeding every instance from the inner value', () => {
      withSampler();
      useWorkflowStore.getState().promoteWidget(promoteTarget, { form: 'input' });

      expect(
        useWorkflowStore.getState().setPromotedWidgetForm(
          { nodeKey: innerKey(5), inputName: 'steps' },
          'widget',
        ),
      ).toBe(true);

      expect(innerSampler()?.inputs[0]?.widget).toEqual({ name: 'steps' });
      for (const instance of useWorkflowStore.getState().workflow?.nodes ?? []) {
        expect(instance.widgets_values).toEqual([12]);
        expect(instance.properties.proxyWidgets).toBeUndefined();
      }
    });

    it('refuses a conversion to the form it is already in', () => {
      withSampler();
      useWorkflowStore.getState().promoteWidget(promoteTarget);
      expect(
        useWorkflowStore.getState().setPromotedWidgetForm(
          { nodeKey: innerKey(5), inputName: 'steps' },
          'widget',
        ),
      ).toBe(false);
    });

    it('demotes a promoted widget back onto the inner node with the value it showed', () => {
      withSampler();
      useWorkflowStore.getState().promoteWidget(promoteTarget);
      useWorkflowStore.setState({
        workflow: {
          ...useWorkflowStore.getState().workflow!,
          nodes: useWorkflowStore.getState().workflow!.nodes.map((node) =>
            node.id === 99 ? { ...node, widgets_values: [45] } : node,
          ),
        },
      });

      expect(
        useWorkflowStore.getState().demoteWidget({ nodeKey: innerKey(5), inputName: 'steps' }),
      ).toBe(true);

      const def = currentDef();
      // Boundary slot and link both gone.
      expect(def?.inputs?.map((slot) => slot.name)).toEqual(['clip']);
      expect(def?.links.some((link) => link.target_id === 5)).toBe(false);
      // The widget draws again, holding what the placeholder was showing.
      expect(innerSampler()?.inputs[0]).toMatchObject({ widget: { name: 'steps' }, link: null });
      expect(innerSampler()?.widgets_values).toEqual([45]);
      // Nothing left over on the instances: with no promoted widgets left, the
      // proxy list is removed rather than left behind empty.
      for (const instance of useWorkflowStore.getState().workflow?.nodes ?? []) {
        expect(instance.widgets_values).toEqual([]);
        expect(instance.properties.proxyWidgets).toBeUndefined();
      }
    });

    it('demotes a socket-form promotion too, restoring the widget', () => {
      withSampler();
      useWorkflowStore.getState().promoteWidget(promoteTarget, { form: 'input' });

      expect(
        useWorkflowStore.getState().demoteWidget({ nodeKey: innerKey(5), inputName: 'steps' }),
      ).toBe(true);

      expect(currentDef()?.inputs?.map((slot) => slot.name)).toEqual(['clip']);
      expect(innerSampler()?.inputs[0]).toMatchObject({ widget: { name: 'steps' }, link: null });
      expect(innerSampler()?.widgets_values).toEqual([12]);
    });

    it('leaves each instance free to hold its own promoted value', () => {
      // The point of promoting a widget on a SHARED type: the node inside is
      // one node, but the value is per-instance — which is what lets twelve
      // instances of one subgraph each carry their own seed.
      const workflow = withInstance(makeSubgraphWorkflow());
      workflow.definitions!.subgraphs![0].nodes.push(innerNode(5, {
        type: 'Sampler',
        widgets_values: [12],
      }));
      workflow.nodes.push({
        ...workflow.nodes[0],
        id: 100,
        itemKey: makeLocationPointer({ type: 'node', nodeId: 100, subgraphId: null }),
      });
      enterScope(workflow);

      useWorkflowStore.getState().promoteWidget({
        nodeKey: innerKey(5),
        inputName: 'steps',
        inputType: 'INT',
        value: 12,
      });

      const instances = () =>
        (useWorkflowStore.getState().workflow?.nodes ?? []).filter((n) => n.type === SG);
      const [first, second] = instances();
      // Seeded alike, but not sharing the array — one edit must not be both.
      expect(first.widgets_values).not.toBe(second.widgets_values);

      useWorkflowStore.setState({
        workflow: {
          ...useWorkflowStore.getState().workflow!,
          nodes: (useWorkflowStore.getState().workflow?.nodes ?? []).map((node) =>
            node.type !== SG ? node : { ...node, widgets_values: [node.id === first.id ? 111 : 222] },
          ),
        } as Workflow,
      });

      const [a, b] = instances();
      expect(a.widgets_values).toEqual([111]);
      expect(b.widgets_values).toEqual([222]);
      // And the definition they share is untouched by either.
      const inner = currentDef()?.nodes.find((n) => n.id === 5);
      expect(inner?.widgets_values).toEqual([12]);
    });

    it('gives each instance its own value at expansion, not the definition\'s', () => {
      const workflow = withInstance(makeSubgraphWorkflow());
      workflow.definitions!.subgraphs![0].nodes.push(innerNode(5, {
        type: 'Sampler',
        widgets_values: [12],
      }));
      workflow.nodes.push({
        ...workflow.nodes[0],
        id: 100,
        itemKey: makeLocationPointer({ type: 'node', nodeId: 100, subgraphId: null }),
      });
      enterScope(workflow);
      useWorkflowStore.getState().promoteWidget({
        nodeKey: innerKey(5),
        inputName: 'steps',
        inputType: 'INT',
        value: 12,
      });

      const withValues = {
        ...useWorkflowStore.getState().workflow!,
        nodes: (useWorkflowStore.getState().workflow?.nodes ?? []).map((node, index) =>
          node.type !== SG ? node : { ...node, widgets_values: [index === 0 ? 111 : 222] },
        ),
      } as Workflow;

      const nodeTypes = {
        Sampler: {
          input: { required: { steps: ['INT', {}] }, optional: {} },
          output: [], output_name: [], name: 'Sampler', display_name: 'Sampler',
          description: '', python_module: '', category: '',
        },
      } as never;
      const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(withValues, nodeTypes);

      // Each placeholder's copy of the inner node carries that placeholder's
      // number, not the one sitting on the shared definition.
      const values = expanded.nodes
        .filter((node) => node.type === 'Sampler')
        .map((node) => [promptKeyMap.get(node.id), (node.widgets_values as unknown[])[0]]);
      expect(values).toEqual(
        expect.arrayContaining([
          [expect.stringContaining(':5'), 111],
          [expect.stringContaining(':5'), 222],
        ]),
      );
      expect(values.map((entry) => entry[1]).sort()).toEqual([111, 222]);
    });

    it('addBoundaryInput displaces a link already feeding the promoted input', () => {
      const workflow = makeSubgraphWorkflow();
      const def = workflow.definitions!.subgraphs![0];
      // Node 4's IMAGE output feeds node 3's input over a regular inner link.
      def.nodes = def.nodes.map((node) =>
        node.id === 3 ? { ...node, inputs: [{ name: 'clip', type: 'CLIP', link: 20 }] } : node,
      );
      def.links = [
        ...def.links,
        { id: 20, origin_id: 4, origin_slot: 0, target_id: 3, target_slot: 0, type: 'CLIP' },
      ];
      def.nodes = def.nodes.map((node) =>
        node.id === 4 ? { ...node, outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [20] }] } : node,
      );
      enterScope(workflow);

      useWorkflowStore.getState().addBoundaryInput({ nodeKey: innerKey(3), inputSlot: 0 });

      const after = currentDef();
      expect((after?.links ?? []).some((link) => link.id === 20)).toBe(false);
      expect(after?.nodes.find((n) => n.id === 4)?.outputs[0]?.links).toBeNull();
    });

    it('addBoundaryInput is a no-op for an input already promoted', () => {
      enterScope(makeSubgraphWorkflow());

      useWorkflowStore.getState().addBoundaryInput({ nodeKey: innerKey(1), inputSlot: 0 });

      expect(currentDef()?.inputs).toHaveLength(1);
    });

    it('addBoundaryOutput appends a slot and leaves the source feeding whatever else it fed', () => {
      const workflow = makeSubgraphWorkflow();
      const def = workflow.definitions!.subgraphs![0];
      // Node 4 already feeds node 3, and is now also promoted.
      def.nodes = def.nodes.map((node) =>
        node.id === 4 ? { ...node, outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [21] }] } : node,
      );
      def.links = [
        ...def.links,
        { id: 21, origin_id: 4, origin_slot: 0, target_id: 3, target_slot: 0, type: 'IMAGE' },
      ];
      enterScope(workflow);

      useWorkflowStore.getState().addBoundaryOutput({ nodeKey: innerKey(4), outputSlot: 0 });

      const after = currentDef();
      expect(after?.outputs?.map((slot) => slot.name)).toEqual(['image', 'IMAGE']);
      const source = after?.nodes.find((n) => n.id === 4);
      // Both the pre-existing inner link and the new boundary link.
      expect(source?.outputs[0]?.links).toHaveLength(2);
      expect(source?.outputs[0]?.links).toContain(21);
    });

    it('removeBoundarySlot shifts the slots after it instead of silently rewiring them', () => {
      enterScope(makeSubgraphWorkflow());
      // Two more inputs, so there is something after the one being removed.
      useWorkflowStore.getState().addBoundaryInput({ nodeKey: innerKey(3), inputSlot: 0 });
      expect(currentDef()?.inputs).toHaveLength(2);

      useWorkflowStore.getState().removeBoundarySlot('input', 0);

      const def = currentDef();
      expect(def?.inputs?.map((slot) => slot.name)).toEqual(['clip_1']);
      // The surviving slot's link now addresses index 0, not the stale index 1.
      const boundaryLinks = (def?.links ?? []).filter((link) => link.origin_id === -10);
      expect(boundaryLinks).toHaveLength(1);
      expect(boundaryLinks[0]).toMatchObject({ origin_slot: 0, target_id: 3 });
      expect(def?.inputs?.[0]?.linkIds).toEqual([boundaryLinks[0].id]);
      // The demoted slot's own link is gone, and its target input freed.
      expect(def?.nodes.find((n) => n.id === 1)?.inputs[0]?.link).toBeNull();
    });

    it('removeBoundarySlot takes the demoted widget value off every instance', () => {
      const workflow = makeSubgraphWorkflow();
      const def = workflow.definitions!.subgraphs![0];
      // Two widget-backed boundary inputs, so instance values are ['a', 'b'].
      def.inputs = [
        { id: 'i1', name: 'seed', type: 'INT', linkIds: [7] },
        { id: 'i2', name: 'steps', type: 'INT', linkIds: [8] },
      ];
      def.nodes = def.nodes.map((node) =>
        node.id === 1
          ? { ...node, inputs: [{ name: 'seed', type: 'INT', link: 7, widget: { name: 'seed' } }] }
          : node.id === 3
            ? { ...node, inputs: [{ name: 'steps', type: 'INT', link: 8, widget: { name: 'steps' } }] }
            : node,
      );
      def.links = [
        { id: 7, origin_id: -10, origin_slot: 0, target_id: 1, target_slot: 0, type: 'INT' },
        { id: 8, origin_id: -10, origin_slot: 1, target_id: 3, target_slot: 0, type: 'INT' },
        { id: 9, origin_id: 2, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
      ];
      enterScope(withInstance(workflow, ['a', 'b']));

      useWorkflowStore.getState().removeBoundarySlot('input', 0);

      const placeholder = useWorkflowStore.getState().workflow?.nodes.find((n) => n.id === 99);
      // 'a' belonged to the demoted slot; 'b' must not slide into its place.
      expect(placeholder?.widgets_values).toEqual(['b']);
    });

    it('leaves the other instances\' connections alone when a connected slot goes', () => {
      // The reported corruption: deleting a boundary input from inside the
      // subgraph moved the OUTER connections of the slots after it onto the
      // wrong inputs — a prompt ended up feeding an image input. Deleting a
      // slot must drop that slot's own connection and touch nothing else.
      const workflow = withInstance(makeSubgraphWorkflow({
        inputs: [
          { id: 'i1', name: 'clip', type: 'CLIP', linkIds: [7] },
          { id: 'i2', name: 'positive', type: 'CONDITIONING', linkIds: [] },
          { id: 'i3', name: 'image', type: 'IMAGE', linkIds: [] },
        ],
      }));
      // Three feeders at root, one per boundary slot.
      workflow.nodes.push(
        { ...workflow.nodes[0], id: 200, type: 'CLIPLoader',
          itemKey: makeLocationPointer({ type: 'node', nodeId: 200, subgraphId: null }),
          inputs: [], outputs: [{ name: 'CLIP', type: 'CLIP', links: [40] }] } as WorkflowNode,
        { ...workflow.nodes[0], id: 201, type: 'PositivePrompt',
          itemKey: makeLocationPointer({ type: 'node', nodeId: 201, subgraphId: null }),
          inputs: [], outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [41] }] } as WorkflowNode,
        { ...workflow.nodes[0], id: 202, type: 'LoadImage',
          itemKey: makeLocationPointer({ type: 'node', nodeId: 202, subgraphId: null }),
          inputs: [], outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [42] }] } as WorkflowNode,
      );
      workflow.nodes = workflow.nodes.map((node) =>
        node.id === 99
          ? {
              ...node,
              inputs: [
                { name: 'clip', type: 'CLIP', link: 40 },
                { name: 'positive', type: 'CONDITIONING', link: 41 },
                { name: 'image', type: 'IMAGE', link: 42 },
              ],
            }
          : node,
      );
      workflow.links = [
        [40, 200, 0, 99, 0, 'CLIP'],
        [41, 201, 0, 99, 1, 'CONDITIONING'],
        [42, 202, 0, 99, 2, 'IMAGE'],
      ] as Workflow['links'];
      enterScope(workflow);

      // Delete the middle slot from inside the subgraph.
      useWorkflowStore.getState().removeBoundarySlot('input', 1);

      const after = useWorkflowStore.getState().workflow!;
      const placeholder = after.nodes.find((node) => node.id === 99);
      expect(placeholder?.inputs.map((input) => input.name)).toEqual(['clip', 'image']);
      // The image feeder still feeds the image slot — not the one the prompt
      // vacated.
      expect(after.links.find((link) => link[0] === 42)).toEqual([42, 202, 0, 99, 1, 'IMAGE']);
      expect(after.links.find((link) => link[0] === 40)).toEqual([40, 200, 0, 99, 0, 'CLIP']);
      // The deleted slot's own connection is gone, both as a link and on the
      // node that was feeding it.
      expect(after.links.some((link) => link[0] === 41)).toBe(false);
      expect(after.nodes.find((node) => node.id === 201)?.outputs[0]?.links ?? []).toEqual([]);
      expect(placeholder?.inputs[1]?.link).toBe(42);
    });

    it('moves a boundary slot without moving anyone else\'s connection or value', () => {
      // Reordering is a delete and a re-insert in one step, which is the same
      // machinery that displaced links when a slot was deleted. Everything must
      // follow its own slot: the links outside, the inner wiring, and each
      // instance's promoted value.
      const workflow = withInstance(makeSubgraphWorkflow({
        inputs: [
          { id: 'i1', name: 'clip', type: 'CLIP', linkIds: [7] },
          { id: 'i2', name: 'steps', type: 'INT', linkIds: [50] },
          { id: 'i3', name: 'cfg', type: 'FLOAT', linkIds: [51] },
        ],
      }));
      const definition = workflow.definitions!.subgraphs![0];
      definition.nodes.push(
        innerNode(5, {
          type: 'Sampler',
          widgets_values: [12],
          inputs: [{ name: 'steps', type: 'INT', link: 50, widget: { name: 'steps' } }],
        }),
        innerNode(6, {
          type: 'Guider',
          widgets_values: [7.5],
          inputs: [{ name: 'cfg', type: 'FLOAT', link: 51, widget: { name: 'cfg' } }],
        }),
      );
      definition.links.push(
        { id: 50, origin_id: -10, origin_slot: 1, target_id: 5, target_slot: 0, type: 'INT' },
        { id: 51, origin_id: -10, origin_slot: 2, target_id: 6, target_slot: 0, type: 'FLOAT' },
      );
      // One feeder outside, wired to the slot that is NOT moving.
      workflow.nodes.push({
        ...workflow.nodes[0],
        id: 200,
        type: 'CLIPLoader',
        itemKey: makeLocationPointer({ type: 'node', nodeId: 200, subgraphId: null }),
        inputs: [],
        outputs: [{ name: 'CLIP', type: 'CLIP', links: [40] }],
      } as WorkflowNode);
      workflow.nodes = workflow.nodes.map((node) =>
        node.id === 99
          ? {
              ...node,
              inputs: [
                { name: 'clip', type: 'CLIP', link: 40 },
                { name: 'steps', type: 'INT', link: null },
                { name: 'cfg', type: 'FLOAT', link: null },
              ],
              properties: { proxyWidgets: [['-1', 'steps'], ['-1', 'cfg']] },
              widgets_values: [12, 7.5],
            }
          : node,
      );
      workflow.links = [[40, 200, 0, 99, 0, 'CLIP']] as Workflow['links'];
      enterScope(workflow);

      // Move `cfg` (slot 2) above `steps` (slot 1).
      expect(useWorkflowStore.getState().moveBoundarySlot('input', 2, 1)).toBe(true);

      const def = currentDef();
      expect(def?.inputs?.map((slot) => slot.name)).toEqual(['clip', 'cfg', 'steps']);
      // Inner links follow their own slots.
      expect(def?.links.find((link) => link.id === 51)?.origin_slot).toBe(1);
      expect(def?.links.find((link) => link.id === 50)?.origin_slot).toBe(2);
      expect(def?.links.find((link) => link.id === 7)?.origin_slot).toBe(0);

      const after = useWorkflowStore.getState().workflow!;
      const placeholder = after.nodes.find((node) => node.id === 99);
      expect(placeholder?.inputs.map((input) => input.name)).toEqual(['clip', 'cfg', 'steps']);
      // The outside connection stayed on `clip`, which never moved.
      expect(after.links.find((link) => link[0] === 40)).toEqual([40, 200, 0, 99, 0, 'CLIP']);
      // Values moved WITH their widgets rather than staying at their index —
      // the silent half of this class of bug.
      // The order lives in the boundary now, so the values simply follow it.
      expect(placeholder?.properties.proxyWidgets).toBeUndefined();
      expect(placeholder?.widgets_values).toEqual([7.5, 12]);
    });

    it('refuses a move that would not change anything', () => {
      enterScope(withInstance(makeSubgraphWorkflow()));
      expect(useWorkflowStore.getState().moveBoundarySlot('input', 0, 0)).toBe(false);
      expect(useWorkflowStore.getState().moveBoundarySlot('input', 0, 5)).toBe(false);
      expect(useWorkflowStore.getState().moveBoundarySlot('input', -1, 0)).toBe(false);
    });

    it('removeBoundarySlot drops an output slot and the link feeding it', () => {
      enterScope(withInstance(makeSubgraphWorkflow()));

      useWorkflowStore.getState().removeBoundarySlot('output', 0);

      const def = currentDef();
      expect(def?.outputs ?? []).toHaveLength(0);
      expect((def?.links ?? []).some((link) => link.target_id === -20)).toBe(false);
      expect(def?.nodes.find((n) => n.id === 2)?.outputs[0]?.links).toBeNull();
    });

    it('does nothing outside a subgraph scope', () => {
      useWorkflowStore.setState({
        workflow: makeSubgraphWorkflow(),
        scopeStack: [{ type: 'root' }],
      });

      useWorkflowStore.getState().addBoundaryInput({ nodeKey: innerKey(3), inputSlot: 0 });
      useWorkflowStore.getState().removeBoundarySlot('input', 0);

      expect(currentDef()?.inputs).toHaveLength(1);
    });
  });

  describe('boundary slot labels', () => {
    /** The subgraph plus one placeholder instance at root. */
    function withInstances(count: number): Workflow {
      const workflow = makeSubgraphWorkflow();
      const placeholders: WorkflowNode[] = [];
      for (let index = 0; index < count; index += 1) {
        const nodeId = 99 + index;
        placeholders.push({
          id: nodeId,
          itemKey: makeLocationPointer({ type: 'node', nodeId, subgraphId: null }),
          type: SG,
          pos: [0, 0],
          size: [200, 100],
          flags: {},
          order: 0,
          mode: 0,
          inputs: [{ name: 'clip', type: 'CLIP', link: null }],
          outputs: [{ name: 'image', type: 'IMAGE', links: null }],
          properties: { mobileInstanceNumber: index + 1 },
          widgets_values: [],
        } as WorkflowNode);
      }
      return { ...workflow, nodes: placeholders };
    }

    const placeholder = (nodeId = 99) =>
      useWorkflowStore.getState().workflow?.nodes.find((n) => n.id === nodeId);

    it('writes an all-instances name onto the definition', () => {
      enterScope(withInstances(2));

      useWorkflowStore.getState().setBoundarySlotLabel('input', 0, 'Conditioning', 'definition');

      expect(currentDef()?.inputs?.[0]?.label).toBe('Conditioning');
      // Nothing lands on the instances, so they all read the shared name.
      expect(placeholder(99)?.properties?.mobileSlotLabels).toBeUndefined();
      expect(placeholder(100)?.properties?.mobileSlotLabels).toBeUndefined();
    });

    it('writes a this-instance name onto the instance that was entered', () => {
      enterScope(withInstances(2));

      useWorkflowStore.getState().setBoundarySlotLabel('input', 0, 'Positive', 'instance');

      // Keyed by slot NAME, and only on the placeholder the scope came in by.
      expect(placeholder(99)?.properties?.mobileSlotLabels).toEqual({ 'input:clip': 'Positive' });
      expect(placeholder(100)?.properties?.mobileSlotLabels).toBeUndefined();
      expect(currentDef()?.inputs?.[0]?.label).toBeUndefined();
    });

    it('renames from a placeholder card, with the scope stack nowhere near it', () => {
      // The rename reachable from a placeholder's widget menu runs at ROOT
      // scope: the user is outside the subgraph, looking at the card. Requiring
      // a subgraph scope made Save a silent no-op — the modal closed and
      // nothing was written.
      useWorkflowStore.setState({
        workflow: withInstances(1),
        scopeStack: [{ type: 'root' }],
      });

      useWorkflowStore.getState().setBoundarySlotLabel('input', 0, 'Style', 'definition', {
        subgraphId: SG,
      });

      expect(currentDef()?.inputs?.[0]?.label).toBe('Style');
    });

    it('writes an instance name onto the placeholder the card belongs to', () => {
      // Two instances, to prove the write lands on the one named rather than
      // on whichever is found first.
      useWorkflowStore.setState({
        workflow: withInstances(2),
        scopeStack: [{ type: 'root' }],
      });

      useWorkflowStore.getState().setBoundarySlotLabel('input', 0, 'Mine', 'instance', {
        subgraphId: SG,
        instanceNodeId: 100,
      });

      const nodes = useWorkflowStore.getState().workflow?.nodes ?? [];
      expect(nodes.find((node) => node.id === 100)?.properties.mobileSlotLabels)
        .toEqual({ 'input:clip': 'Mine' });
      expect(nodes.find((node) => node.id === 99)?.properties.mobileSlotLabels).toBeUndefined();
      // The definition is untouched by an instance-scoped rename.
      expect(currentDef()?.inputs?.[0]?.label).toBeUndefined();
    });

    it('keeps an instance name off the placeholder slot, which load would overwrite', () => {
      enterScope(withInstances(1));
      useWorkflowStore.getState().setBoundarySlotLabel('input', 0, 'Shared', 'definition');
      useWorkflowStore.getState().setBoundarySlotLabel('input', 0, 'Positive', 'instance');

      // The obvious home for the override is the placeholder's own slot label,
      // and it is the wrong one: normalization rebuilds that from the
      // definition, so a name written there reverts on the next load.
      const normalized = normalizeSubgraphPlaceholders(
        useWorkflowStore.getState().workflow as Workflow,
      );
      const node = normalized.nodes.find((n) => n.id === 99);
      expect(node?.inputs[0]?.label).toBe('Shared');
      expect(node?.properties?.mobileSlotLabels).toEqual({ 'input:clip': 'Positive' });
    });

    it('clearing an instance name returns that instance to the shared one', () => {
      enterScope(withInstances(2));
      useWorkflowStore.getState().setBoundarySlotLabel('input', 0, 'Positive', 'instance');

      useWorkflowStore.getState().setBoundarySlotLabel('input', 0, '   ', 'instance');

      // The whole property goes, rather than being left as an empty object.
      expect(placeholder(99)?.properties?.mobileSlotLabels).toBeUndefined();
    });

    it('clearing an all-instances name drops the label rather than blanking it', () => {
      enterScope(withInstances(1));
      useWorkflowStore.getState().setBoundarySlotLabel('output', 0, 'Picture', 'definition');

      useWorkflowStore.getState().setBoundarySlotLabel('output', 0, '', 'definition');

      expect('label' in (currentDef()?.outputs?.[0] ?? {})).toBe(false);
    });

    it('leaves one instance name in place when another slot is renamed', () => {
      enterScope(withInstances(1));
      useWorkflowStore.getState().setBoundarySlotLabel('input', 0, 'Positive', 'instance');

      useWorkflowStore.getState().setBoundarySlotLabel('output', 0, 'Picture', 'instance');

      expect(placeholder(99)?.properties?.mobileSlotLabels).toEqual({
        'input:clip': 'Positive',
        'output:image': 'Picture',
      });
    });

    it('does nothing at root, where there is no boundary to rename', () => {
      useWorkflowStore.setState({
        workflow: withInstances(1),
        scopeStack: [{ type: 'root' }],
      });

      useWorkflowStore.getState().setBoundarySlotLabel('input', 0, 'Nope', 'definition');

      expect(currentDef()?.inputs?.[0]?.label).toBeUndefined();
    });
  });
});

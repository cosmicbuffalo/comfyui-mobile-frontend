import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import { makeLocationPointer } from '@/utils/mobileLayout';
import { buildLayoutForWorkflow } from '../useWorkflow/layoutOps';
import { UNDO_ACTION_LABELS } from '@/utils/undoActionLabels';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowUndoStore } from '../useWorkflowUndo';
import { useWorkflowClipboardStore } from '../useWorkflowClipboard';
import { useLoraManagerStore } from '../useLoraManager';


/**
 * Every undoable action, run for real, checked for the toast it produces.
 *
 * The audit in `undoActionLabels.test.ts` proves each action HAS a name. This
 * proves the name arrives: that the action records a step at all, that the step
 * carries its own label rather than a generic one or an inner action's, and
 * that both Undo and Redo announce it. A label in the table that no run can
 * reach would pass the audit and still leave the user with a nameless toast.
 *
 * The case table is exhaustive by construction — the last test fails if a
 * label has no case here.
 */

const SG = 'sg-cov';
const SG2 = 'sg-cov-2';
const PUTER = 'Power Puter (rgthree)';
// A session of its own per case. Two widget edits to the same node inside the
// 600ms coalescing window are deliberately ONE step, so cases sharing a session
// would swallow each other's step depending on the order they ran in.
let session = 'undo-toast-coverage';

const key = (nodeId: number) => makeLocationPointer({ type: 'node', nodeId, subgraphId: null });
const groupKey = (groupId: number) =>
  makeLocationPointer({ type: 'group', groupId, subgraphId: null });
const innerKey = (nodeId: number) =>
  makeLocationPointer({ type: 'node', nodeId, subgraphId: SG });

function node(id: number, type: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    itemKey: key(id),
    type,
    pos: [id * 10, id * 10],
    size: [200, 100],
    flags: {},
    order: id,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides,
  } as WorkflowNode;
}

function inner(id: number, type: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return { ...node(id, type, overrides), itemKey: innerKey(id) } as WorkflowNode;
}

const nodeTypes = {
  TestNode: {
    input: { required: { model: ['MODEL'], steps: ['INT', { default: 8 }], text: ['STRING', { default: '' }] } },
    output: ['MODEL'],
    output_name: ['MODEL'],
    name: 'TestNode',
    display_name: 'Test Node',
    description: '',
    python_module: '',
    category: 'test',
  },
  Loader: {
    input: { required: {} },
    output: ['MODEL'],
    output_name: ['MODEL'],
    name: 'Loader',
    display_name: 'Loader',
    description: '',
    python_module: '',
    category: 'test',
  },
  PrimitiveInt: {
    input: { required: { value: ['INT', { default: 0 }] } },
    output: ['INT'],
    output_name: ['INT'],
    name: 'PrimitiveInt',
    display_name: 'Int',
    description: '',
    python_module: '',
    category: 'test',
  },
  PreviewImage: {
    input: { required: { images: ['IMAGE'] } },
    output: [],
    output_name: [],
    name: 'PreviewImage',
    display_name: 'Preview Image',
    description: '',
    python_module: '',
    category: 'test',
  },
  SaveImage: {
    input: { required: { images: ['IMAGE'], filename_prefix: ['STRING', { default: 'ComfyUI' }] } },
    output: [],
    output_name: [],
    name: 'SaveImage',
    display_name: 'Save Image',
    description: '',
    python_module: '',
    category: 'test',
  },
} as unknown as NodeTypes;

/**
 * Root graph: a MODEL chain (1 -> 2), a spare consumer (3), an image output (4),
 * a wired Set/Get relay pair (5/6 -> 7), a Power Puter (8), and a group.
 */
function rootWorkflow(): Workflow {
  return {
    last_node_id: 8,
    last_link_id: 3,
    nodes: [
      node(1, 'Loader', { outputs: [{ name: 'MODEL', type: 'MODEL', links: [1, 2] }] }),
      node(2, 'TestNode', {
        inputs: [{ name: 'model', type: 'MODEL', link: 1 }],
        widgets_values: [8, ''],
      }),
      node(3, 'TestNode', {
        inputs: [{ name: 'model', type: 'MODEL', link: null }],
        widgets_values: [8, ''],
      }),
      node(4, 'PreviewImage', { inputs: [{ name: 'images', type: 'IMAGE', link: null }] }),
      node(5, 'SetNode', {
        widgets_values: ['relay'],
        inputs: [{ name: 'value', type: 'MODEL', link: 2 }],
      }),
      node(6, 'GetNode', {
        widgets_values: ['relay'],
        outputs: [{ name: '*', type: 'MODEL', links: [3] }],
      }),
      node(7, 'TestNode', { inputs: [{ name: 'model', type: 'MODEL', link: 3 }] }),
      node(8, PUTER, {
        widgets_values: [{ outputs: ['STRING'] }, 'a + b'],
        outputs: [{ name: 'STRING', type: 'STRING', links: null }],
      }),
    ],
    links: [
      [1, 1, 0, 2, 0, 'MODEL'],
      [2, 1, 0, 5, 0, 'MODEL'],
      [3, 6, 0, 7, 0, 'MODEL'],
    ],
    groups: [{
      id: 10,
      itemKey: groupKey(10),
      title: 'Group',
      color: '#fff',
      bounding: [0, 0, 900, 900],
    }],
    config: {},
    version: 1,
  } as unknown as Workflow;
}

/**
 * A subgraph type with a STRING boundary input and an IMAGE boundary output,
 * two instances of it at root, a second type to replace one with, and — inside
 * — a source terminal (102) for the pop-out.
 */
function subgraphWorkflow(): Workflow {
  const def: WorkflowSubgraphDefinition = {
    id: SG,
    name: 'Layer {n}',
    inputNode: { id: -10, bounding: [-400, 0, 120, 60] },
    outputNode: { id: -20, bounding: [400, 0, 120, 60] },
    version: 1,
    revision: 0,
    state: { lastGroupId: 0, lastNodeId: 102, lastLinkId: 30, lastRerouteId: 0 },
    inputs: [{ id: 'i1', name: 'prompt', type: 'STRING', linkIds: [20] }],
    outputs: [{ id: 'o1', name: 'image', type: 'IMAGE', linkIds: [21] }],
    nodes: [
      inner(100, 'TestNode', {
        inputs: [{ name: 'prompt', type: 'STRING', widget: { name: 'prompt' }, link: 20 }],
        outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [21] }],
        widgets_values: ['hi', 20],
      }),
      inner(101, 'TestNode', {
        inputs: [{ name: 'model', type: 'MODEL', link: null }],
        outputs: [{ name: 'IMAGE', type: 'IMAGE', links: null }],
        widgets_values: [12],
      }),
      inner(102, 'Loader', { outputs: [{ name: 'MODEL', type: 'MODEL', links: [22] }] }),
      inner(103, 'TestNode', { inputs: [{ name: 'model', type: 'MODEL', link: 22 }] }),
    ],
    links: [
      { id: 20, origin_id: -10, origin_slot: 0, target_id: 100, target_slot: 0, type: 'STRING' },
      { id: 21, origin_id: 100, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
      { id: 22, origin_id: 102, origin_slot: 0, target_id: 103, target_slot: 0, type: 'MODEL' },
    ],
    groups: [],
  };
  const other: WorkflowSubgraphDefinition = {
    ...def,
    id: SG2,
    name: 'Other',
    nodes: [],
    links: [],
    inputs: [{ id: 'i1', name: 'prompt', type: 'STRING', linkIds: [] }],
    outputs: [{ id: 'o1', name: 'image', type: 'IMAGE', linkIds: [] }],
  };
  const instance = (id: number) => node(id, SG, {
    inputs: [{ name: 'prompt', type: 'STRING', widget: { name: 'prompt' }, link: null }],
    outputs: [{ name: 'image', type: 'IMAGE', links: null }],
    widgets_values: ['hello'],
    properties: { mobileInstanceNumber: id - 19 },
  });
  return {
    last_node_id: 103,
    last_link_id: 0,
    nodes: [
      node(1, 'Loader', { outputs: [{ name: 'MODEL', type: 'MODEL', links: null }] }),
      instance(20),
      instance(21),
    ],
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: { subgraphs: [def, other] },
  } as unknown as Workflow;
}

function load(workflow: Workflow, scope: 'root' | 'subgraph' = 'root') {
  useWorkflowStore.setState({
    workflow,
    activeSessionId: session,
    parkedSessions: {},
    workflowLoadedAt: 777,
    nodeTypes,
    mobileLayout: buildLayoutForWorkflow(workflow, {}),
    hiddenItems: {},
    collapsedItems: {},
    connectionHighlightModes: {},
    itemKeyByPointer: {},
    pointerByHierarchicalKey: {},
    scopeStack: scope === 'root'
      ? [{ type: 'root' }]
      : [{ type: 'root' }, { type: 'subgraph', id: SG, placeholderNodeId: 20 }],
  });
}

const store = () => useWorkflowStore.getState();

interface Case {
  setup: () => void;
  run: () => void;
}

/** One entry per key in UNDO_ACTION_LABELS. */
const CASES: Record<string, Case> = {
  // ── Nodes ────────────────────────────────────────────────────────────────
  addNode: { setup: () => load(rootWorkflow()), run: () => store().addNode('TestNode') },
  addNodeAndConnect: {
    setup: () => load(rootWorkflow()),
    run: () => store().addNodeAndConnect('Loader', key(3), 0),
  },
  deleteNode: { setup: () => load(rootWorkflow()), run: () => store().deleteNode(key(3), false) },
  duplicateNode: { setup: () => load(rootWorkflow()), run: () => store().duplicateNode(key(2)) },
  updateNodeTitle: {
    setup: () => load(rootWorkflow()),
    run: () => store().updateNodeTitle(key(2), 'Renamed'),
  },
  updateNodeProperties: {
    setup: () => load(rootWorkflow()),
    run: () => store().updateNodeProperties(key(2), { matchTitle: 'x' }),
  },
  convertImageOutputNode: {
    setup: () => load(rootWorkflow()),
    run: () => store().convertImageOutputNode(key(4), 'SaveImage'),
  },
  toggleBypass: { setup: () => load(rootWorkflow()), run: () => store().toggleBypass(key(2)) },
  bypassAllInContainer: {
    setup: () => load(rootWorkflow()),
    run: () => store().bypassAllInContainer(groupKey(10), true),
  },
  renameSetGetNode: {
    setup: () => load(rootWorkflow()),
    run: () => store().renameSetGetNode(key(5), 'renamed-relay'),
  },
  collapseSetGetNodes: {
    setup: () => load(rootWorkflow()),
    run: () => store().collapseSetGetNodes(),
  },

  // ── Widget values ────────────────────────────────────────────────────────
  updateNodeWidget: {
    setup: () => load(rootWorkflow()),
    run: () => store().updateNodeWidget(key(2), 0, 15, 'steps'),
  },
  updateNodeWidgets: {
    setup: () => load(rootWorkflow()),
    run: () => store().updateNodeWidgets(key(2), { 0: 16 }),
  },
  updateSubgraphInnerNodeWidget: {
    setup: () => load(subgraphWorkflow()),
    run: () => store().updateSubgraphInnerNodeWidget(SG, 101, 0, 33),
  },
  setPowerPuterOutputs: {
    setup: () => load(rootWorkflow()),
    run: () => store().setPowerPuterOutputs(key(8), 0, ['STRING', 'INT']),
  },
  setWidgetLabel: {
    setup: () => load(rootWorkflow()),
    run: () => store().setWidgetLabel(key(2), 'model', 'Model'),
  },
  popWidgetToPrimitive: {
    setup: () => load(rootWorkflow()),
    run: () => store().popWidgetToPrimitive(key(2), 'steps', 8),
  },
  ensureWidgetInputSlot: {
    setup: () => load(rootWorkflow()),
    run: () => store().ensureWidgetInputSlot(key(2), 'text', 'STRING'),
  },

  // ── Wiring ───────────────────────────────────────────────────────────────
  connectNodes: {
    setup: () => load(rootWorkflow()),
    run: () => store().connectNodes(key(1), 0, key(3), 0, 'MODEL'),
  },
  disconnectInput: {
    setup: () => load(rootWorkflow()),
    run: () => store().disconnectInput(key(2), 0),
  },

  // ── Clipboard and selection ──────────────────────────────────────────────
  pasteClipboard: {
    setup: () => {
      load(rootWorkflow());
      store().copySelectedItems([key(2)]);
    },
    run: () => store().pasteClipboard(),
  },
  pasteIntoContainer: {
    setup: () => {
      load(rootWorkflow());
      store().copySelectedItems([key(2)]);
    },
    run: () => store().pasteIntoContainer(groupKey(10)),
  },
  deleteSelectedItems: {
    setup: () => load(rootWorkflow()),
    run: () => store().deleteSelectedItems([key(2), key(3)]),
  },

  // ── Groups and containers ────────────────────────────────────────────────
  addGroupNearNode: {
    setup: () => load(rootWorkflow()),
    run: () => store().addGroupNearNode(key(1), null),
  },
  createGroupFromItems: {
    setup: () => load(rootWorkflow()),
    run: () => store().createGroupFromItems([key(2), key(3)]),
  },
  duplicateContainer: {
    setup: () => load(rootWorkflow()),
    run: () => store().duplicateContainer(groupKey(10)),
  },
  deleteContainer: {
    setup: () => load(rootWorkflow()),
    run: () => store().deleteContainer(groupKey(10), { deleteNodes: false }),
  },
  updateContainerTitle: {
    setup: () => load(rootWorkflow()),
    run: () => store().updateContainerTitle(groupKey(10), 'Renamed group'),
  },
  updateWorkflowItemColor: {
    setup: () => load(rootWorkflow()),
    run: () => store().updateWorkflowItemColor(key(2), '#123456'),
  },

  // ── Layout ───────────────────────────────────────────────────────────────
  commitRepositionLayout: {
    setup: () => load(rootWorkflow()),
    run: () => {
      const layout = store().mobileLayout;
      store().commitRepositionLayout({ ...layout, root: [...layout.root].reverse() });
    },
  },

  // ── Subgraphs ────────────────────────────────────────────────────────────
  createSubgraphFromItems: {
    setup: () => load(rootWorkflow()),
    run: () => store().createSubgraphFromItems([key(2)], 'Made'),
  },
  moveItemsIntoSubgraph: {
    setup: () => load(subgraphWorkflow()),
    run: () => store().moveItemsIntoSubgraph([key(1)], key(20)),
  },
  popNodeOutToRoot: {
    setup: () => load(subgraphWorkflow(), 'subgraph'),
    run: () => store().popNodeOutToRoot(innerKey(102)),
  },
  removeHarvestedNodes: {
    // Node 3 sits at root feeding nothing, which is the shape this action is
    // offered for: a node a move already carried the value of.
    setup: () => load(rootWorkflow()),
    run: () => store().removeHarvestedNodes([3]),
  },
  forkSubgraphType: {
    setup: () => load(subgraphWorkflow()),
    run: () => store().forkSubgraphType(SG, [21], 'Forked'),
  },
  replaceSubgraphInstance: {
    setup: () => load(subgraphWorkflow()),
    run: () => store().replaceSubgraphInstance(key(20), SG2),
  },
  renameSubgraphType: {
    setup: () => load(subgraphWorkflow()),
    run: () => store().renameSubgraphType(SG, 'Renamed type'),
  },
  deleteSubgraphType: {
    setup: () => load(subgraphWorkflow()),
    run: () => store().deleteSubgraphType(SG, 'delete'),
  },

  // ── Subgraph boundary (from inside the subgraph) ──────────────────────────
  addBoundaryInput: {
    setup: () => load(subgraphWorkflow(), 'subgraph'),
    run: () => store().addBoundaryInput({ nodeKey: innerKey(101), inputSlot: 0 }),
  },
  addBoundaryOutput: {
    setup: () => load(subgraphWorkflow(), 'subgraph'),
    run: () => store().addBoundaryOutput({ nodeKey: innerKey(101), outputSlot: 0 }),
  },
  connectBoundaryInput: {
    setup: () => load(subgraphWorkflow(), 'subgraph'),
    run: () => store().connectBoundaryInput(0, [{ nodeKey: innerKey(100), inputSlot: 0 }, { nodeKey: innerKey(101), inputSlot: 0 }]),
  },
  connectBoundaryOutput: {
    setup: () => load(subgraphWorkflow(), 'subgraph'),
    run: () => store().connectBoundaryOutput(0, { nodeKey: innerKey(101), outputSlot: 0 }),
  },
  disconnectBoundaryLink: {
    setup: () => load(subgraphWorkflow(), 'subgraph'),
    run: () => store().disconnectBoundaryLink('input', 0, 100, 0),
  },
  moveBoundarySlot: {
    setup: () => {
      load(subgraphWorkflow(), 'subgraph');
      store().addBoundaryInput({ nodeKey: innerKey(101), inputSlot: 0 });
    },
    run: () => store().moveBoundarySlot('input', 0, 1),
  },
  removeBoundarySlot: {
    setup: () => load(subgraphWorkflow(), 'subgraph'),
    run: () => store().removeBoundarySlot('input', 0),
  },
  setBoundarySlotLabel: {
    setup: () => load(subgraphWorkflow(), 'subgraph'),
    run: () => store().setBoundarySlotLabel('input', 0, 'Prompt', 'definition'),
  },
  promoteWidget: {
    setup: () => load(subgraphWorkflow(), 'subgraph'),
    run: () => store().promoteWidget({
      nodeKey: innerKey(101), inputName: 'steps', inputType: 'INT', value: 12,
    }),
  },
  demoteWidget: {
    setup: () => {
      load(subgraphWorkflow(), 'subgraph');
      store().promoteWidget({
        nodeKey: innerKey(101), inputName: 'steps', inputType: 'INT', value: 12,
      });
    },
    run: () => store().demoteWidget({ nodeKey: innerKey(101), inputName: 'steps' }),
  },
  setPromotedWidgetForm: {
    setup: () => {
      load(subgraphWorkflow(), 'subgraph');
      store().promoteWidget({
        nodeKey: innerKey(101), inputName: 'steps', inputType: 'INT', value: 12,
      });
    },
    run: () => store().setPromotedWidgetForm(
      { nodeKey: innerKey(101), inputName: 'steps' },
      'input',
    ),
  },
  setPromotedWidgetLabel: {
    setup: () => load(subgraphWorkflow()),
    run: () => store().setPromotedWidgetLabel(SG, { kind: 'slot', slotName: 'prompt' }, 'Prompt {n}'),
  },
  setInstanceWidgetLabel: {
    setup: () => load(subgraphWorkflow()),
    run: () => store().setInstanceWidgetLabel(
      key(20),
      { kind: 'slot', direction: 'input', slotName: 'prompt' },
      'Just this one',
    ),
  },
};

describe('every undoable action announces itself', () => {
  beforeEach(() => {
    useWorkflowUndoStore.setState({ histories: {}, feedback: null });
    useWorkflowClipboardStore.setState({ payload: null });
  });

  it.each(Object.keys(CASES))('%s', (name) => {
    const expected = UNDO_ACTION_LABELS[name];
    const { setup, run } = CASES[name];
    session = `undo-toast-${name}`;
    setup();
    // Only what `run` does is under test — a setup step may record its own.
    useWorkflowUndoStore.setState({ histories: {}, feedback: null });

    run();

    const recorded = useWorkflowUndoStore.getState().histories[session]?.undo ?? [];
    expect(recorded.length, `${name} recorded no undo step`).toBeGreaterThan(0);
    expect(recorded.at(-1)?.actionLabel, `${name} recorded the wrong name`).toBe(expected);

    useWorkflowUndoStore.getState().undo();
    expect(useWorkflowUndoStore.getState().feedback).toMatchObject({
      direction: 'undo',
      actionLabel: expected,
    });

    useWorkflowUndoStore.getState().redo();
    expect(useWorkflowUndoStore.getState().feedback).toMatchObject({
      direction: 'redo',
      actionLabel: expected,
    });
  });

  it('covers every label in the table', () => {
    const uncovered = Object.keys(UNDO_ACTION_LABELS).filter((name) => !(name in CASES));
    expect(
      uncovered,
      `${uncovered.length} undoable action(s) have a name but nothing that proves it `
        + 'reaches the toast. Add a case above:\n' + uncovered.join('\n'),
    ).toEqual([]);
  });
});

/**
 * The four edits that do not run through a store action, and so cannot be named
 * by the label table. Each names itself at its own call site, and each is
 * checked here the closest way it can be reached.
 */
describe('edits made outside the workflow store announce themselves too', () => {
  beforeEach(() => {
    useWorkflowUndoStore.setState({ histories: {}, feedback: null });
    session = 'undo-toast-outside';
  });

  it('a LoRA applied from the LoRA panel is "Edit LoRAs"', () => {
    const workflow = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [node(1, 'Lora Loader (LoraManager)', { widgets_values: ['', []] })],
      links: [],
      groups: [],
      config: {},
      version: 1,
    } as unknown as Workflow;
    load(workflow);
    useWorkflowStore.setState({
      nodeTypes: {
        'Lora Loader (LoraManager)': {
          input: { required: { text: ['STRING', { default: '' }] } },
          output: ['MODEL'],
          output_name: ['MODEL'],
          name: 'Lora Loader (LoraManager)',
          display_name: 'Lora Loader (LoraManager)',
          description: '',
          python_module: '',
          category: 'loaders',
        },
      } as unknown as NodeTypes,
    });
    useWorkflowUndoStore.setState({ histories: {}, feedback: null });

    useLoraManagerStore.getState().applyLoraCodeUpdate({
      node_id: 1,
      lora_code: '<lora:style:0.8>',
      mode: 'append',
    });

    const recorded = useWorkflowUndoStore.getState().histories[session]?.undo ?? [];
    expect(recorded.at(-1)?.actionLabel).toBe('Edit LoRAs');
    useWorkflowUndoStore.getState().undo();
    expect(useWorkflowUndoStore.getState().feedback).toMatchObject({ actionLabel: 'Edit LoRAs' });
  });

  /**
   * These two edit through the store from a React modal and from the websocket,
   * where reaching the write means standing up the whole component or the whole
   * socket. What can go wrong is the label being dropped from the transaction,
   * so that is what is checked — the label reaching the toast from there is the
   * same mechanism proven fifty times over above.
   */
  it.each([
    ['src/components/modals/ConnectionModal.tsx', 'Edit connections'],
    ['src/hooks/useWebSocket.ts', 'Apply node feedback'],
  ])('%s still names its transaction %s', (file, label) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    const labelled = new RegExp(`runUndoTransaction\\([\\s\\S]{0,4000}?'${label}'`);
    expect(labelled.test(source), `${file} no longer names its undo transaction`).toBe(true);
  });
});

/**
 * The toast's second line: which item the step moved, named the way its card
 * names it, with its id.
 */
describe('the toast names the item a step changed', () => {
  // A session per test, for the same coalescing reason as above.
  let caseIndex = 0;
  beforeEach(() => {
    useWorkflowUndoStore.setState({ histories: {}, feedback: null });
    caseIndex += 1;
    session = `undo-toast-target-${caseIndex}`;
  });

  const feedbackTarget = () => useWorkflowUndoStore.getState().feedback?.target ?? null;

  it('falls back to the node type\'s display name when it has no title', () => {
    load(rootWorkflow());
    store().updateNodeWidget(key(2), 0, 15, 'steps');

    useWorkflowUndoStore.getState().undo();

    expect(feedbackTarget()).toEqual({
      name: 'Test Node',
      id: 2,
      // One widget changed, so the toast names it as well as the node.
      widgetLabel: 'steps',
      extraCount: 0,
    });
  });

  it('names the title the state being restored has, not the one being left', () => {
    load(rootWorkflow());
    store().updateNodeTitle(key(2), 'My sampler');

    // Undo puts back the untitled node, so that is what the toast names...
    useWorkflowUndoStore.getState().undo();
    expect(feedbackTarget()).toMatchObject({ name: 'Test Node', id: 2 });

    // ...and redo puts the title back on.
    useWorkflowUndoStore.getState().redo();
    expect(feedbackTarget()).toMatchObject({ name: 'My sampler', id: 2 });
  });

  it('still names a node the step deleted, which the restored state does not have', () => {
    load(rootWorkflow());
    store().deleteNode(key(3), false);

    useWorkflowUndoStore.getState().undo();
    expect(feedbackTarget()).toMatchObject({ name: 'Test Node', id: 3 });

    // Redone, node 3 is gone again: the name comes from the state left behind
    // rather than the toast going quiet about what it just removed.
    useWorkflowUndoStore.getState().redo();
    expect(feedbackTarget()).toMatchObject({ name: 'Test Node', id: 3 });
  });

  it('names a group by its title and id', () => {
    load(rootWorkflow());
    store().updateContainerTitle(groupKey(10), 'Renamed group');

    useWorkflowUndoStore.getState().undo();
    expect(feedbackTarget()).toMatchObject({ name: 'Group', id: 10 });

    useWorkflowUndoStore.getState().redo();
    expect(feedbackTarget()).toMatchObject({ name: 'Renamed group', id: 10 });
  });

  it('names a subgraph instance the way its card does, {n} and all', () => {
    load(subgraphWorkflow(), 'subgraph');
    store().setBoundarySlotLabel('input', 0, 'Prompt', 'definition');

    useWorkflowUndoStore.getState().undo();

    // The definition changed, so the instance it was entered through is what
    // there is to name — "Layer {n}" rendered for instance 1.
    expect(feedbackTarget()).toMatchObject({ name: 'Layer 1', id: 20 });
  });

  it('counts the rest when a step changed more than one item', () => {
    load(rootWorkflow());
    store().deleteSelectedItems([key(2), key(3)]);

    useWorkflowUndoStore.getState().undo();

    const target = feedbackTarget();
    expect(target?.id).toBe(2);
    expect(target?.extraCount).toBeGreaterThanOrEqual(1);
  });

  it('leaves the line off when the step changed nothing with a card of its own', () => {
    load(rootWorkflow());
    // A pure link-table edit: no node, group or subgraph is named by it.
    useWorkflowStore.setState({
      workflow: {
        ...useWorkflowStore.getState().workflow!,
        links: [],
      } as Workflow,
    });

    useWorkflowUndoStore.getState().undo();

    expect(feedbackTarget()).toBeNull();
  });
});

/**
 * Widget-level reveal: an undo of a single widget edit goes to the row that
 * changed, not just to the card holding it.
 */
describe('undo reveals the widget row a step changed', () => {
  // A session per test: two widget edits to the same node inside the coalescing
  // window are deliberately ONE step, so a shared session would let one test's
  // edit swallow the next one's.
  let caseIndex = 0;
  beforeEach(() => {
    useWorkflowUndoStore.setState({ histories: {}, feedback: null });
    caseIndex += 1;
    session = `undo-widget-reveal-${caseIndex}`;
  });

  const jumped = () => {
    const jump = vi.fn();
    useWorkflowStore.setState({ jumpToWorkflowItem: jump as never });
    return jump;
  };

  it('jumps to the row, naming the card and the widget index in its id', async () => {
    load(rootWorkflow());
    const jump = jumped();

    store().updateNodeWidget(key(2), 0, 15, 'steps');
    useWorkflowUndoStore.getState().undo();
    await new Promise((done) => setTimeout(done, 0));

    expect(jump).toHaveBeenCalledWith(
      { kind: 'widget', itemKey: key(2), nodeId: 2, domId: 'widget-row-2-0' },
      expect.objectContaining({ label: 'Undo' }),
    );
  });

  it('stays at node level when a step wrote several widgets at once', async () => {
    load(rootWorkflow());
    const jump = jumped();

    // Two rows changed, so no single row is what the edit was about.
    store().updateNodeWidgets(key(2), { 0: 16, 1: 'hello' });
    useWorkflowUndoStore.getState().undo();
    await new Promise((done) => setTimeout(done, 0));

    expect(jump).toHaveBeenCalledWith(
      { kind: 'node', itemKey: key(2) },
      expect.objectContaining({ label: 'Undo' }),
    );
  });

  it('stays at node level for a change that is not a widget value at all', async () => {
    load(rootWorkflow());
    const jump = jumped();

    store().updateNodeTitle(key(2), 'Renamed');
    useWorkflowUndoStore.getState().undo();
    await new Promise((done) => setTimeout(done, 0));

    expect(jump).toHaveBeenCalledWith(
      { kind: 'node', itemKey: key(2) },
      expect.objectContaining({ label: 'Undo' }),
    );
  });

  it('stays at node level when the index names no row the card draws', async () => {
    // A trailing serialized value the node type declares no input for — the
    // shape a `control_after_generate` slot leaves behind. The card draws no
    // row for it, so there is nothing to scroll to and nothing to name.
    // (An index past the end of the array is a different path: the length
    // changes, and the diff reports no index at all.)
    //
    // Built into the fixture rather than edited in: an edit made during setup
    // is itself a step, and the one under test would coalesce into it.
    const withTrailing = rootWorkflow();
    withTrailing.nodes = withTrailing.nodes.map((n) =>
      n.id === 2 ? { ...n, widgets_values: [8, '', 'trailing'] } : n,
    );
    load(withTrailing);
    const jump = jumped();

    store().updateNodeWidget(key(2), 2, 'changed');
    useWorkflowUndoStore.getState().undo();
    await new Promise((done) => setTimeout(done, 0));

    expect(jump).toHaveBeenCalledWith(
      { kind: 'node', itemKey: key(2) },
      expect.objectContaining({ label: 'Undo' }),
    );
    expect(useWorkflowUndoStore.getState().feedback?.target?.widgetLabel).toBeUndefined();
  });

  it('stays at node level when the widget list itself changed length', async () => {
    load(rootWorkflow());
    const jump = jumped();

    store().updateNodeWidgets(key(2), { 7: 'grown' });
    useWorkflowUndoStore.getState().undo();
    await new Promise((done) => setTimeout(done, 0));

    expect(jump).toHaveBeenCalledWith(
      { kind: 'node', itemKey: key(2) },
      expect.objectContaining({ label: 'Undo' }),
    );
  });

  it('falls back to the node when the recorded position now holds another widget', async () => {
    // What a boundary-slot reorder does: `widgets_values` is positional, so the
    // value at index 0 becomes a different widget. A step recorded before that
    // must not light up whatever now sits at its index.
    load(rootWorkflow());
    const jump = jumped();

    store().updateNodeWidget(key(2), 0, 15, 'steps');
    const history = useWorkflowUndoStore.getState().histories[session]!;
    const recorded = history.undo[0];
    const widgetTarget = recorded.changedTargets[0];
    expect(widgetTarget).toMatchObject({ kind: 'node', widgetIndex: 0, widgetName: 'steps' });
    if (widgetTarget.kind !== 'node') throw new Error('expected a node target');

    // Rewrite the snapshot so index 0 is a different widget than the one the
    // step recorded, exactly as a reorder between record and undo would.
    useWorkflowUndoStore.setState({
      histories: {
        [session]: {
          ...history,
          undo: [{
            ...recorded,
            changedTargets: [{ ...widgetTarget, widgetName: 'cfg' }],
          }],
        },
      },
    });

    useWorkflowUndoStore.getState().undo();
    await new Promise((done) => setTimeout(done, 0));

    expect(jump).toHaveBeenCalledWith(
      { kind: 'node', itemKey: key(2) },
      expect.objectContaining({ label: 'Undo' }),
    );
    expect(useWorkflowUndoStore.getState().feedback?.target?.widgetLabel).toBeUndefined();
  });

  it('names a renamed widget the way its row is labelled', () => {
    load(rootWorkflow());
    useWorkflowStore.setState({ jumpToWorkflowItem: (() => {}) as never });
    // A per-node widget rename lives on the input slot, the way desktop stores it.
    store().setWidgetLabel(key(2), 'steps', 'Sampling steps');
    useWorkflowUndoStore.setState({ histories: {}, feedback: null });

    store().updateNodeWidget(key(2), 0, 15, 'steps');
    useWorkflowUndoStore.getState().undo();

    expect(useWorkflowUndoStore.getState().feedback?.target).toMatchObject({
      name: 'Test Node',
      id: 2,
      widgetLabel: 'Sampling steps',
    });
  });
});

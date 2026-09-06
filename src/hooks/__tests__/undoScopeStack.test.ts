import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowUndoStore } from '../useWorkflowUndo';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, queuePrompt: vi.fn(async () => ({ prompt_id: 'p' })) };
});

function nodeKey(nodeId: number): string {
  return makeLocationPointer({ type: 'node', nodeId, subgraphId: null });
}

function makeWorkflow(withSubgraph: boolean): Workflow {
  const placeholder = {
    id: 5,
    itemKey: nodeKey(5),
    type: 'sg-1',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
  };
  return {
    last_node_id: 5,
    last_link_id: 0,
    nodes: withSubgraph ? [placeholder] : [],
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: withSubgraph
      ? { subgraphs: [{ id: 'sg-1', name: 'Sub', nodes: [], links: [] }] }
      : { subgraphs: [] },
  } as unknown as Workflow;
}

// Undo restores the graph but not the browsing scope, so a scope whose
// definition the restored graph no longer has must not be left standing.
describe('undo/redo scope stack', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: makeWorkflow(true),
      mobileLayout: createEmptyMobileLayout(),
      scopeStack: [{ type: 'root' }],
      activeSessionId: 'session-A',
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
    });
    useWorkflowUndoStore.setState({ histories: {} });
  });

  function pushUndoStep(targetWorkflow: Workflow) {
    useWorkflowUndoStore.setState({
      histories: {
        'session-A': {
          undo: [
            {
              workflow: targetWorkflow,
              mobileLayout: createEmptyMobileLayout(),
              itemKeyByPointer: {},
              pointerByHierarchicalKey: {},
              changedNodeIds: [],
            },
          ],
          redo: [],
        },
      },
    } as never);
  }

  it('surfaces to root when undo removes the subgraph being viewed', () => {
    useWorkflowStore.setState({
      scopeStack: [{ type: 'root' }, { type: 'subgraph', id: 'sg-1', placeholderNodeId: 5 }],
    });
    pushUndoStep(makeWorkflow(false));

    useWorkflowUndoStore.getState().undo();

    expect(useWorkflowStore.getState().scopeStack).toEqual([{ type: 'root' }]);
  });

  it('lands on a surviving instance when undo removes the one being read through', () => {
    // Undoing the duplicate you walked into: the type stays, its other
    // instances still use it, and the placeholder you came in by is gone.
    const workflow = makeWorkflow(true);
    workflow.nodes = workflow.nodes.filter((n) => n.id !== 5);
    workflow.nodes.push({ ...(makeWorkflow(true).nodes.find((n) => n.id === 5)!), id: 6 });
    useWorkflowStore.setState({
      scopeStack: [{ type: 'root' }, { type: 'subgraph', id: 'sg-1', placeholderNodeId: 5 }],
    });
    pushUndoStep(workflow);

    useWorkflowUndoStore.getState().undo();

    // Still inside the type, read through the instance that is actually there.
    expect(useWorkflowStore.getState().scopeStack).toEqual([
      { type: 'root' },
      { type: 'subgraph', id: 'sg-1', placeholderNodeId: 6, enteredPlaceholderNodeId: undefined },
    ]);
  });

  it('surfaces to root when the type survives with no instances at all', () => {
    const workflow = makeWorkflow(true);
    workflow.nodes = workflow.nodes.filter((n) => n.id !== 5);
    useWorkflowStore.setState({
      scopeStack: [{ type: 'root' }, { type: 'subgraph', id: 'sg-1', placeholderNodeId: 5 }],
    });
    pushUndoStep(workflow);

    useWorkflowUndoStore.getState().undo();

    expect(useWorkflowStore.getState().scopeStack).toEqual([{ type: 'root' }]);
  });

  it('keeps the user where they are when the subgraph survives', () => {
    const scopeStack = [
      { type: 'root' as const },
      { type: 'subgraph' as const, id: 'sg-1', placeholderNodeId: 5 },
    ];
    useWorkflowStore.setState({ scopeStack });
    pushUndoStep(makeWorkflow(true));

    useWorkflowUndoStore.getState().undo();

    expect(useWorkflowStore.getState().scopeStack).toEqual(scopeStack);
  });
});

/**
 * Undoing an edit made INSIDE a subgraph must leave you inside it.
 *
 * The restore itself never moved the scope — `reconcileScopeStack` keeps a
 * frame whose definition and placeholder still exist. What moved it was the
 * reveal: a boundary edit changes the inner node AND every placeholder instance
 * of the type, the placeholders live in the parent scope, and root nodes are
 * walked first, so the reveal picked a placeholder — and `jumpToWorkflowItem`
 * travels to its target's scope, walking the user out of the subgraph they were
 * editing in. Redo did it again, so there was no way back.
 *
 * The guard is on which target the reveal picks, which is where the defect was;
 * that jumping to a root placeholder from inside a subgraph does travel to root
 * is jumpToWorkflowItem's own documented behaviour.
 */
describe('undo inside a subgraph stays inside it', () => {
  const SG = 'sg-promote';
  const innerKey = (nodeId: number) =>
    makeLocationPointer({ type: 'node', nodeId, subgraphId: SG });
  const rootKey = (nodeId: number) =>
    makeLocationPointer({ type: 'node', nodeId, subgraphId: null });

  function node(id: number, type: string, itemKey: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      itemKey,
      type,
      pos: [0, 0],
      size: [200, 100],
      flags: {},
      order: id,
      mode: 0,
      inputs: [],
      outputs: [],
      properties: {},
      widgets_values: [],
      ...overrides,
    };
  }

  function promotableWorkflow(): Workflow {
    return {
      last_node_id: 100,
      last_link_id: 0,
      nodes: [
        node(20, SG, rootKey(20), {
          properties: { mobileInstanceNumber: 1 },
          inputs: [],
          outputs: [],
        }),
      ],
      links: [],
      groups: [],
      config: {},
      version: 1,
      definitions: {
        subgraphs: [{
          id: SG,
          name: 'Layer',
          inputNode: { id: -10, bounding: [-400, 0, 120, 60] },
          outputNode: { id: -20, bounding: [400, 0, 120, 60] },
          version: 1,
          revision: 0,
          state: { lastGroupId: 0, lastNodeId: 100, lastLinkId: 0, lastRerouteId: 0 },
          inputs: [],
          outputs: [],
          nodes: [node(100, 'TestNode', innerKey(100), { widgets_values: [12] })],
          links: [],
          groups: [],
        }],
      },
    } as unknown as Workflow;
  }

  const nodeTypes = {
    TestNode: {
      input: { required: { steps: ['INT', { default: 12 }] } },
      output: [],
      output_name: [],
      name: 'TestNode',
      display_name: 'Test Node',
      description: '',
      python_module: '',
      category: 'test',
    },
  } as never;

  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: promotableWorkflow(),
      nodeTypes,
      mobileLayout: createEmptyMobileLayout(),
      scopeStack: [{ type: 'root' }, { type: 'subgraph', id: SG, placeholderNodeId: 20 }],
      activeSessionId: 'session-scope',
      workflowLoadedAt: 31337,
      hiddenItems: {},
      collapsedItems: {},
      itemKeyByPointer: {
        [rootKey(20)]: rootKey(20),
        [innerKey(100)]: innerKey(100),
      },
      pointerByHierarchicalKey: {
        [rootKey(20)]: rootKey(20),
        [innerKey(100)]: innerKey(100),
      },
    });
    useWorkflowUndoStore.setState({ histories: {}, feedback: null });
  });

  it('reveals the inner node the edit was about, not the placeholder outside', async () => {
    const jumpToWorkflowItem = vi.fn();
    useWorkflowStore.setState({ jumpToWorkflowItem: jumpToWorkflowItem as never });

    useWorkflowStore.getState().promoteWidget({
      nodeKey: innerKey(100), inputName: 'steps', inputType: 'INT', value: 12,
    });
    useWorkflowUndoStore.getState().undo();
    await new Promise((done) => setTimeout(done, 0));

    expect(jumpToWorkflowItem).toHaveBeenCalledWith(
      { kind: 'node', itemKey: innerKey(100) },
      expect.objectContaining({ label: 'Undo' }),
    );
  });

  it('names the inner node in the toast too, so it agrees with where it took you', () => {
    useWorkflowStore.setState({ jumpToWorkflowItem: (() => {}) as never });

    useWorkflowStore.getState().promoteWidget({
      nodeKey: innerKey(100), inputName: 'steps', inputType: 'INT', value: 12,
    });
    useWorkflowUndoStore.getState().undo();

    expect(useWorkflowUndoStore.getState().feedback?.target).toMatchObject({
      name: 'Test Node',
      id: 100,
    });
  });

  /**
   * The mirror case: a PROXY widget keeps its value on the inner node, so
   * editing it on the placeholder card at root records a change only against
   * the inner node — in the subgraph's scope. The reveal must not read that as
   * "nothing changed here" and travel into a subgraph the user never opened:
   * the placeholder's proxy row IS that widget, and it is where they stand.
   */
  it('undoing a proxy edit made at root reveals the placeholder row, not the subgraph', async () => {
    const jumpToWorkflowItem = vi.fn();
    const workflow = promotableWorkflow();
    workflow.nodes[0].properties = {
      ...(workflow.nodes[0].properties ?? {}),
      proxyWidgets: [['100', 'steps']],
    };
    useWorkflowStore.setState({
      workflow,
      scopeStack: [{ type: 'root' }],
      jumpToWorkflowItem: jumpToWorkflowItem as never,
    });

    useWorkflowStore.getState().updateSubgraphInnerNodeWidget(SG, 100, 0, 99, 'steps');
    useWorkflowUndoStore.getState().undo();
    await new Promise((done) => setTimeout(done, 0));

    expect(jumpToWorkflowItem).toHaveBeenCalledWith(
      {
        kind: 'widget',
        itemKey: rootKey(20),
        nodeId: 20,
        domId: 'widget-row-20-10000',
      },
      expect.objectContaining({ label: 'Undo' }),
    );
    // The user was at root; the reveal must have left them there.
    expect(useWorkflowStore.getState().scopeStack).toEqual([{ type: 'root' }]);
  });
});

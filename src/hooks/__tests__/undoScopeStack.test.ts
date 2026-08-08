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

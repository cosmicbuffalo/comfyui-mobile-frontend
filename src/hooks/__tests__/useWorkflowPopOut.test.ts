import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { createEmptyMobileLayout } from '@/utils/mobileLayout';

const SUBGRAPH_ID = 'pop-out-subgraph';

function node(id: number, type: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type,
    itemKey: type === SUBGRAPH_ID ? `root/node:${id}` : `${SUBGRAPH_ID}/node:${id}`,
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
  };
}

function makeWorkflow(): Workflow {
  return {
    last_node_id: 10,
    last_link_id: 0,
    nodes: [node(1, SUBGRAPH_ID)],
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: {
      subgraphs: [{
        id: SUBGRAPH_ID,
        name: 'Inner',
        inputs: [],
        outputs: [],
        nodes: [
          node(10, 'Loader', {
            outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }],
          }),
          node(11, 'Consumer', {
            inputs: [{ name: 'image', type: 'IMAGE', link: 1 }],
          }),
        ],
        links: [
          { id: 1, origin_id: 10, origin_slot: 0, target_id: 11, target_slot: 0, type: 'IMAGE' },
        ],
      }],
    },
  };
}

describe('popNodeOutToRoot', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: makeWorkflow(),
      scopeStack: [
        { type: 'root' },
        { type: 'subgraph', id: SUBGRAPH_ID, placeholderNodeId: 1 },
      ],
      hiddenItems: {},
      connectionHighlightModes: {},
      mobileLayout: createEmptyMobileLayout(),
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
      scrollToNode: vi.fn(),
    });
  });

  it('commits the extraction, rebuilds root layout keys, and returns to root scope', () => {
    const result = useWorkflowStore.getState().popNodeOutToRoot(`${SUBGRAPH_ID}/node:10`)!;
    const state = useWorkflowStore.getState();

    expect(result.kind).toBe('source');
    expect(result.rootNodeIds).toHaveLength(1);
    expect(state.scopeStack).toEqual([{ type: 'root' }]);
    const rootNode = state.workflow!.nodes.find((entry) => entry.id === result.rootNodeIds[0]);
    expect(rootNode?.type).toBe('Loader');
    expect(rootNode?.itemKey).toBeTruthy();
    expect(state.workflow!.definitions!.subgraphs![0].nodes.some((entry) => entry.id === 10)).toBe(false);
  });
});

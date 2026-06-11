import { describe, expect, it } from 'vitest';
import { expandWorkflowSubgraphs } from '../expandWorkflowSubgraphs';
import type { NodeTypes, Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';

function makeNode(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    type,
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

function makeSubgraphDef(
  id: string,
  name: string,
  nodes: WorkflowNode[],
): WorkflowSubgraphDefinition {
  return {
    id,
    name,
    nodes,
    links: [],
    inputs: [],
    outputs: [],
  } as unknown as WorkflowSubgraphDefinition;
}

function makeWorkflow(
  rootNodes: WorkflowNode[],
  subgraphs: WorkflowSubgraphDefinition[] = [],
): Workflow {
  return {
    nodes: rootNodes,
    links: [],
    groups: [],
    last_node_id: Math.max(0, ...rootNodes.map((n) => n.id)),
    last_link_id: 0,
    version: 1,
    config: {},
    extra: {},
    ...(subgraphs.length > 0
      ? { definitions: { subgraphs } }
      : {}),
  } as unknown as Workflow;
}

describe('expandWorkflowSubgraphs', () => {
  it('returns the workflow unchanged when there are no subgraphs', () => {
    const wf = makeWorkflow([makeNode(1, 'KSampler'), makeNode(2, 'VAEDecode')]);
    const result = expandWorkflowSubgraphs(wf);
    expect(result.workflow.nodes).toHaveLength(2);
    expect(result.promptKeyMap.size).toBe(0);
  });

  it('expands a single-level subgraph and creates correct promptKeyMap', () => {
    const sgId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const innerNode1 = makeNode(10, 'KSampler');
    const innerNode2 = makeNode(20, 'VAEDecode');
    const sgDef = makeSubgraphDef(sgId, 'MySubgraph', [innerNode1, innerNode2]);

    // Root: one placeholder node whose type matches the subgraph UUID
    const placeholder = makeNode(5, sgId);
    const wf = makeWorkflow([placeholder], [sgDef]);

    const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(wf);

    // Placeholder is replaced by the 2 inner nodes
    expect(expanded.nodes).toHaveLength(2);

    // Both expanded nodes should have prompt keys of the form "5:innerNodeId"
    const keys = [...promptKeyMap.values()];
    expect(keys).toContain('5:10');
    expect(keys).toContain('5:20');

    // Expanded node IDs should differ from original inner node IDs
    const expandedIds = expanded.nodes.map((n) => n.id);
    for (const id of expandedIds) {
      const key = promptKeyMap.get(id);
      expect(key).toBeDefined();
      expect(key).toMatch(/^5:\d+$/);
    }
  });

  it('preserves root nodes that are not placeholders', () => {
    const sgId = 'aaaaaaaa-1111-2222-3333-444444444444';
    const sgDef = makeSubgraphDef(sgId, 'Sub', [makeNode(100, 'InnerNode')]);
    const rootRegular = makeNode(1, 'SaveImage');
    const placeholder = makeNode(2, sgId);
    const wf = makeWorkflow([rootRegular, placeholder], [sgDef]);

    const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(wf);

    // 1 regular root + 1 expanded inner = 2
    expect(expanded.nodes).toHaveLength(2);

    // The regular root node should have its own ID as its prompt key
    expect(promptKeyMap.get(1)).toBe('1');
  });

  it('assigns unique expanded IDs starting above the max existing ID', () => {
    const sgId = 'ff000000-0000-0000-0000-000000000000';
    const sgDef = makeSubgraphDef(sgId, 'Sub', [
      makeNode(10, 'NodeA'),
      makeNode(20, 'NodeB'),
    ]);
    const placeholder = makeNode(50, sgId);
    const wf = makeWorkflow([placeholder], [sgDef]);

    const { workflow: expanded } = expandWorkflowSubgraphs(wf);

    // All expanded IDs should be > 50 (the max root node ID)
    for (const node of expanded.nodes) {
      expect(node.id).toBeGreaterThan(50);
    }
  });

  describe('promoted widget values', () => {
    const promotedNodeTypes: NodeTypes = {
      TestNode: {
        input: {
          required: {
            text: ['STRING', {}],
            strength: ['FLOAT', { default: 1 }],
          },
        },
        output: ['STRING'],
        output_name: ['STRING'],
        name: 'TestNode',
        display_name: 'Test Node',
        description: '',
        python_module: '',
        category: 'test',
      },
    };

    function makePromotedFixture(sgId: string) {
      const inner = makeNode(10, 'TestNode', {
        inputs: [{ name: 'text', type: 'STRING', link: 1, widget: { name: 'text' } }],
        widgets_values: ['stale inner value', 0.5],
      });
      const sgDef: WorkflowSubgraphDefinition = {
        ...makeSubgraphDef(sgId, 'Sub', [inner]),
        inputs: [{ name: 'text', type: 'STRING' }],
        links: [
          { id: 1, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'STRING' },
        ],
      };
      return sgDef;
    }

    it('pushes the placeholder promoted value into the expanded inner node', () => {
      const sgId = 'ff222222-2222-2222-2222-222222222222';
      const sgDef = makePromotedFixture(sgId);
      const placeholder = makeNode(5, sgId, {
        inputs: [{ name: 'text', type: 'STRING', link: null, widget: { name: 'text' } }],
        widgets_values: ['fresh placeholder value'],
      });
      const wf = makeWorkflow([placeholder], [sgDef]);

      const { workflow: expanded } = expandWorkflowSubgraphs(wf, promotedNodeTypes);

      expect(expanded.nodes).toHaveLength(1);
      expect(expanded.nodes[0]?.widgets_values).toEqual(['fresh placeholder value', 0.5]);
      // The canonical definition must not be mutated.
      expect(sgDef.nodes[0]?.widgets_values).toEqual(['stale inner value', 0.5]);
    });

    it('keeps per-instance promoted values for multiple placeholders of one definition', () => {
      const sgId = 'ff333333-3333-3333-3333-333333333333';
      const sgDef = makePromotedFixture(sgId);
      const placeholderA = makeNode(5, sgId, {
        inputs: [{ name: 'text', type: 'STRING', link: null, widget: { name: 'text' } }],
        widgets_values: ['value A'],
      });
      const placeholderB = makeNode(6, sgId, {
        inputs: [{ name: 'text', type: 'STRING', link: null, widget: { name: 'text' } }],
        widgets_values: ['value B'],
      });
      const wf = makeWorkflow([placeholderA, placeholderB], [sgDef]);

      const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(wf, promotedNodeTypes);

      const valueByPromptKey = new Map(
        expanded.nodes.map((node) => [
          promptKeyMap.get(node.id),
          (node.widgets_values as unknown[])[0],
        ]),
      );
      expect(valueByPromptKey.get('5:10')).toBe('value A');
      expect(valueByPromptKey.get('6:10')).toBe('value B');
    });

    it('does not override the inner value when the promoted input is connected', () => {
      const sgId = 'ff444444-4444-4444-4444-444444444444';
      const sgDef = makePromotedFixture(sgId);
      const placeholder = makeNode(5, sgId, {
        inputs: [{ name: 'text', type: 'STRING', link: 9, widget: { name: 'text' } }],
        widgets_values: ['linked-over value'],
      });
      const wf = makeWorkflow([placeholder], [sgDef]);

      const { workflow: expanded } = expandWorkflowSubgraphs(wf, promotedNodeTypes);

      expect(expanded.nodes[0]?.widgets_values).toEqual(['stale inner value', 0.5]);
    });
  });

  it('marks descendants of a bypassed subgraph placeholder as bypassed', () => {
    const sgId = 'ff111111-1111-1111-1111-111111111111';
    const sgDef = makeSubgraphDef(sgId, 'Sub', [
      makeNode(10, 'ActiveInnerNode'),
      makeNode(20, 'BypassedInnerNode', { mode: 4 }),
    ]);
    const placeholder = makeNode(50, sgId, { mode: 4 });
    const wf = makeWorkflow([placeholder], [sgDef]);

    const { workflow: expanded } = expandWorkflowSubgraphs(wf);

    expect(expanded.nodes).toHaveLength(2);
    expect(expanded.nodes.every((node) => node.mode === 4)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { buildSlotMap, expandWorkflowSubgraphs } from '../expandWorkflowSubgraphs';
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

    // A placeholder holds one value per promoted widget, positionally, so every
    // write path pads the slots beneath the one being written — the index IS
    // the widget's identity and appending would retarget the write. A template
    // ships `widgets_values: []` and keeps the real values on its inner nodes,
    // so editing any promoted widget above index 0 leaves nulls below it.
    // Those pads are not values: pushing them into the inner nodes overwrote
    // real ones, and ComfyUI rejected the branch ("Failed to convert an input
    // value to a INT value: seed, None").
    describe('null pads left by a positional write', () => {
      const samplerNodeTypes: NodeTypes = {
        TestSampler: {
          input: {
            required: {
              seed: ['INT', { default: 0 }],
              steps: ['INT', { default: 20 }],
            },
          },
          output: ['LATENT'],
          output_name: ['LATENT'],
          name: 'TestSampler',
          display_name: 'Test Sampler',
          description: '',
          python_module: '',
          category: 'test',
        },
      };

      function makeSamplerFixture(sgId: string) {
        const inner = makeNode(10, 'TestSampler', {
          inputs: [
            { name: 'seed', type: 'INT', link: 1, widget: { name: 'seed' } },
            { name: 'steps', type: 'INT', link: 2, widget: { name: 'steps' } },
          ],
          widgets_values: [12345, 8],
        });
        return {
          ...makeSubgraphDef(sgId, 'Sampler', [inner]),
          inputs: [
            { name: 'seed', type: 'INT' },
            { name: 'steps', type: 'INT' },
          ],
          links: [
            { id: 1, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'INT' },
            { id: 2, origin_id: -10, origin_slot: 1, target_id: 10, target_slot: 1, type: 'INT' },
          ],
        } as unknown as WorkflowSubgraphDefinition;
      }

      function makeSamplerPlaceholder(sgId: string, values: unknown[]) {
        return makeNode(5, sgId, {
          inputs: [
            { name: 'seed', type: 'INT', link: null, widget: { name: 'seed' } },
            { name: 'steps', type: 'INT', link: null, widget: { name: 'steps' } },
          ],
          widgets_values: values,
        });
      }

      it('leaves the inner value alone where the placeholder holds a null pad', () => {
        const sgId = 'ff555555-5555-5555-5555-555555555555';
        const sgDef = makeSamplerFixture(sgId);
        // Only `steps` was ever edited on the card; index 0 is the pad below it.
        const wf = makeWorkflow([makeSamplerPlaceholder(sgId, [null, 30])], [sgDef]);

        const { workflow: expanded } = expandWorkflowSubgraphs(wf, samplerNodeTypes);

        expect(expanded.nodes[0]?.widgets_values).toEqual([12345, 30]);
      });

      it('still applies a promoted value that is legitimately falsy', () => {
        const sgId = 'ff666666-6666-6666-6666-666666666666';
        const sgDef = makeSamplerFixture(sgId);
        // 0 is a real seed, and losing it is the failure the null check guards.
        const wf = makeWorkflow([makeSamplerPlaceholder(sgId, [0, 30])], [sgDef]);

        const { workflow: expanded } = expandWorkflowSubgraphs(wf, samplerNodeTypes);

        expect(expanded.nodes[0]?.widgets_values).toEqual([0, 30]);
      });
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

    it('uses full boundary widget order when hidden inputs precede visible inputs', () => {
      const sgId = 'ff555555-5555-5555-5555-555555555555';
      const promptNode = makeNode(11, 'PromptNode', {
        inputs: [{ name: 'prompt', type: 'STRING', link: 1, widget: { name: 'prompt' } }],
        widgets_values: ['stale prompt'],
      });
      const loraNode = makeNode(15, 'LoraNode', {
        inputs: [
          { name: 'lora_name', type: 'COMBO', link: 2, widget: { name: 'lora_name' } },
          { name: 'strength_model', type: 'FLOAT', link: 3, widget: { name: 'strength_model' } },
        ],
        widgets_values: ['stale.safetensors', 0.5],
      });
      const sgDef: WorkflowSubgraphDefinition = {
        ...makeSubgraphDef(sgId, 'Krea-like subgraph', [promptNode, loraNode]),
        inputs: [
          { name: 'prompt', type: 'STRING' },
          { name: 'lora_name', type: 'COMBO' },
          { name: 'strength_model', type: 'FLOAT' },
        ],
        links: [
          { id: 1, origin_id: -10, origin_slot: 0, target_id: 11, target_slot: 0, type: 'STRING' },
          { id: 2, origin_id: -10, origin_slot: 1, target_id: 15, target_slot: 0, type: 'COMBO' },
          { id: 3, origin_id: -10, origin_slot: 2, target_id: 15, target_slot: 1, type: 'FLOAT' },
        ],
      };
      const placeholder = makeNode(30, sgId, {
        // The prompt exists only on the boundary. The visible inputs[] starts
        // at lora_name, matching the shipped Krea-2 template's shape.
        inputs: [
          { name: 'lora_name', type: 'COMBO', link: null, widget: { name: 'lora_name' } },
          { name: 'strength_model', type: 'FLOAT', link: null, widget: { name: 'strength_model' } },
        ],
        widgets_values: ['fresh prompt', 'krea2_darkbrush.safetensors', 0.8],
      });
      const nodeTypes = {
        PromptNode: {
          input: { required: { prompt: ['STRING', {}] } },
          output: [], output_name: [], name: 'PromptNode', display_name: 'PromptNode',
          description: '', python_module: '', category: 'test',
        },
        LoraNode: {
          input: {
            required: {
              lora_name: [['krea2_darkbrush.safetensors'], {}],
              strength_model: ['FLOAT', { default: 1 }],
            },
          },
          output: [], output_name: [], name: 'LoraNode', display_name: 'LoraNode',
          description: '', python_module: '', category: 'test',
        },
      } as unknown as NodeTypes;

      const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(
        makeWorkflow([placeholder], [sgDef]),
        nodeTypes,
      );
      const byPromptKey = new Map(
        expanded.nodes.map((node) => [promptKeyMap.get(node.id), node]),
      );

      expect(byPromptKey.get('30:11')?.widgets_values).toEqual(['fresh prompt']);
      expect(byPromptKey.get('30:15')?.widgets_values).toEqual([
        'krea2_darkbrush.safetensors',
        0.8,
      ]);
    });
  });

  it('leaves a bypassed subgraph placeholder unexpanded', () => {
    // ComfyUI skips a bypassed subgraph node in graphToPrompt before
    // getInnerNodes() runs, so none of its inner nodes reach the prompt; the
    // placeholder itself passes values through at its own boundary.
    const sgId = 'ff111111-1111-1111-1111-111111111111';
    const sgDef = makeSubgraphDef(sgId, 'Sub', [
      makeNode(10, 'ActiveInnerNode'),
      makeNode(20, 'BypassedInnerNode', { mode: 4 }),
    ]);
    const placeholder = makeNode(50, sgId, { mode: 4 });
    const wf = makeWorkflow([placeholder], [sgDef]);

    const { workflow: expanded } = expandWorkflowSubgraphs(wf);

    expect(expanded.nodes).toHaveLength(1);
    expect(expanded.nodes[0]).toMatchObject({ id: 50, type: sgId, mode: 4 });
  });

  it('leaves a muted subgraph placeholder unexpanded', () => {
    const sgId = 'ff222222-2222-2222-2222-222222222222';
    const sgDef = makeSubgraphDef(sgId, 'Sub', [makeNode(10, 'InnerNode')]);
    const placeholder = makeNode(50, sgId, { mode: 2 });
    const wf = makeWorkflow([placeholder], [sgDef]);

    const { workflow: expanded } = expandWorkflowSubgraphs(wf);

    expect(expanded.nodes).toHaveLength(1);
    expect(expanded.nodes[0]).toMatchObject({ id: 50, mode: 2 });
  });

  it('still expands active placeholders alongside an inert one', () => {
    const activeId = 'ff333333-3333-3333-3333-333333333333';
    const mutedId = 'ff444444-4444-4444-4444-444444444444';
    const wf = makeWorkflow(
      [makeNode(50, activeId), makeNode(51, mutedId, { mode: 2 })],
      [
        makeSubgraphDef(activeId, 'Active', [makeNode(10, 'InnerNode')]),
        makeSubgraphDef(mutedId, 'Muted', [makeNode(11, 'InnerNode')]),
      ],
    );

    const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(wf);

    const keys = expanded.nodes.map((node) => promptKeyMap.get(node.id));
    expect(keys).toContain('50:10');
    expect(keys).toContain('51');
    expect(keys).not.toContain('51:11');
  });
});

describe('buildSlotMap', () => {
  // ComfyUI reconciles a placeholder's serialized slots against the definition's
  // boundary list by name:type signature, then name, claiming each boundary slot
  // at most once (SubgraphNode._rebindInputSubgraphSlots).
  it('matches by name even when the placeholder list is a shorter subset', () => {
    // The Krea-2 shape: the placeholder omits boundary slot 0 entirely.
    const map = buildSlotMap(
      [
        { name: 'value_1', type: 'BOOLEAN' },
        { name: 'width_1', type: 'INT' },
      ],
      [
        { name: 'value', type: 'STRING' },
        { name: 'value_1', type: 'BOOLEAN' },
        { name: 'width_1', type: 'INT' },
      ],
    );

    expect(map.get(0)).toBe(1);
    expect(map.get(1)).toBe(2);
  });

  it('prefers the name:type signature when two boundary slots share a name', () => {
    const map = buildSlotMap(
      [{ name: 'value', type: 'INT' }],
      [
        { name: 'value', type: 'STRING' },
        { name: 'value', type: 'INT' },
      ],
    );

    expect(map.get(0)).toBe(1);
  });

  it('never maps two placeholder slots onto the same boundary slot', () => {
    // Slot 0 matches 'seed' by name; slot 1 has no match and must not fall back
    // onto a boundary slot another placeholder slot already claimed.
    const map = buildSlotMap(
      [
        { name: 'seed', type: 'INT' },
        { name: 'unknown_name', type: 'INT' },
      ],
      [
        { name: 'steps', type: 'INT' },
        { name: 'seed', type: 'INT' },
      ],
    );

    expect(map.get(0)).toBe(1);
    expect(map.get(1)).not.toBe(1);
    expect(new Set([...map.values()]).size).toBe(map.size);
  });

  it('falls back to the positional slot only when it is still unclaimed', () => {
    const map = buildSlotMap(
      [{ name: 'renamed', type: 'INT' }],
      [{ name: 'original', type: 'INT' }],
    );

    expect(map.get(0)).toBe(0);
  });
});

describe('expandWorkflowSubgraphs — nested promotion', () => {
  it('pushes an outer boundary value through a nested placeholder that has no widgets_values', () => {
    const outerId = 'aa111111-1111-1111-1111-111111111111';
    const innerId = 'aa222222-2222-2222-2222-222222222222';

    const leaf = makeNode(70, 'LeafNode', {
      inputs: [{ name: 'steps', type: 'INT', link: 1, widget: { name: 'steps' } }],
      widgets_values: [20],
    });
    const innerDef: WorkflowSubgraphDefinition = {
      ...makeSubgraphDef(innerId, 'Inner', [leaf]),
      inputs: [{ name: 'steps', type: 'INT', linkIds: [1] }],
      links: [
        { id: 1, origin_id: -10, origin_slot: 0, target_id: 70, target_slot: 0, type: 'INT' },
      ],
    };

    // The nested placeholder carries no widgets_values of its own — the common
    // case, since its values normally live on the inner nodes.
    const nestedPlaceholder = makeNode(60, innerId, {
      inputs: [{ name: 'steps', type: 'INT', link: 2, widget: { name: 'steps' } }],
      widgets_values: [],
    });
    const outerDef: WorkflowSubgraphDefinition = {
      ...makeSubgraphDef(outerId, 'Outer', [nestedPlaceholder]),
      inputs: [{ name: 'steps', type: 'INT', linkIds: [2] }],
      links: [
        { id: 2, origin_id: -10, origin_slot: 0, target_id: 60, target_slot: 0, type: 'INT' },
      ],
    };

    const placeholder = makeNode(50, outerId, {
      inputs: [{ name: 'steps', type: 'INT', link: null, widget: { name: 'steps' } }],
      widgets_values: [8],
    });
    const nodeTypes = {
      LeafNode: {
        input: { required: { steps: ['INT', { default: 20 }] } },
        output: [], output_name: [], name: 'LeafNode', display_name: 'LeafNode',
        description: '', python_module: '', category: 'test',
      },
    } as unknown as NodeTypes;

    const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(
      makeWorkflow([placeholder], [outerDef, innerDef]),
      nodeTypes,
    );
    const leafNode = expanded.nodes.find(
      (node) => promptKeyMap.get(node.id) === '50:60:70',
    );

    expect(leafNode?.widgets_values).toEqual([8]);
  });
});

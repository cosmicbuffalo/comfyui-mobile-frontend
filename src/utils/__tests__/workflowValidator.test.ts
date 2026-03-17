import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition, WorkflowLink } from '@/api/types';
import { validateAndNormalizeWorkflow } from '@/utils/workflowValidator';

function loadFixture(): Workflow {
  const path = resolve(
    process.cwd(),
    'src/hooks/__tests__/fixtures/complex_i2v_example_workflow.json',
  );
  return JSON.parse(readFileSync(path, 'utf-8')) as Workflow;
}

function makeNode(id: number, inputs = 0, outputs = 0): WorkflowNode {
  return {
    id,
    itemKey: `sk-${id}`,
    type: 'TestNode',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: Array.from({ length: inputs }, (_, i) => ({
      name: `input_${i}`,
      type: 'INT',
      link: null,
    })),
    outputs: Array.from({ length: outputs }, (_, i) => ({
      name: `output_${i}`,
      type: 'INT',
      links: [],
    })),
    properties: {},
    widgets_values: [],
  };
}

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    last_node_id: 0,
    last_link_id: 0,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    version: 0.4,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateAndNormalizeWorkflow — fixture round-trip
// ---------------------------------------------------------------------------

describe('validateAndNormalizeWorkflow — fixture round-trip', () => {
  it('returns the workflow unchanged when it is already valid', () => {
    const wf = loadFixture();
    const result = validateAndNormalizeWorkflow(wf);
    // SubgraphIO.linkIds must be unchanged since the fixture is already correct
    const sg4123 = result.definitions?.subgraphs?.find((s) =>
      s.id.startsWith('4123daa5'),
    );
    expect(sg4123).toBeDefined();
    // input[0] linkIds = [2408] from fixture
    expect(sg4123!.inputs?.[0]?.linkIds).toEqual([2408]);
    // input[4] linkIds = [2153, 2333, 2334] — multiple boundary links
    const input4LinkIds = (sg4123!.inputs?.[4]?.linkIds ?? []).slice().sort((a, b) => a - b);
    expect(input4LinkIds).toEqual([2153, 2333, 2334]);
    // output[0] linkIds = [2163]
    expect(sg4123!.outputs?.[0]?.linkIds).toEqual([2163]);
  });

  it('does not modify the original workflow object reference', () => {
    const wf = loadFixture();
    const result = validateAndNormalizeWorkflow(wf);
    // When no corrections needed, the same object is returned
    expect(result).toBe(wf);
  });
});

// ---------------------------------------------------------------------------
// validateAndNormalizeWorkflow — SubgraphIO.linkIds repair
// ---------------------------------------------------------------------------

describe('validateAndNormalizeWorkflow — SubgraphIO.linkIds repair', () => {
  function makeSubgraphWorkflow(): Workflow {
    const innerNode = makeNode(10, 1, 0);
    const subgraph: WorkflowSubgraphDefinition = {
      id: 'sg-test-uuid',
      nodes: [innerNode],
      links: [
        { id: 101, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'INT' },
        { id: 102, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'INT' },
      ],
      inputs: [
        { id: 'slot-0', name: 'x', type: 'INT', linkIds: [] }, // intentionally empty (corrupt)
      ],
      outputs: [],
      groups: [],
      config: {},
    };
    const placeholder = makeNode(5, 1, 0);
    placeholder.type = 'sg-test-uuid';
    return makeWorkflow({
      nodes: [placeholder],
      definitions: { subgraphs: [subgraph] },
    });
  }

  it('repairs empty linkIds to match actual boundary links', () => {
    const wf = makeSubgraphWorkflow();
    const result = validateAndNormalizeWorkflow(wf);
    const sg = result.definitions?.subgraphs?.[0];
    expect(sg?.inputs?.[0]?.linkIds).toEqual([101, 102]);
  });

  it('repairs stale linkIds that do not match actual boundary links', () => {
    const wf = makeSubgraphWorkflow();
    // Corrupt: set wrong link ID
    wf.definitions!.subgraphs![0]!.inputs![0]!.linkIds = [999];
    const result = validateAndNormalizeWorkflow(wf);
    const sg = result.definitions?.subgraphs?.[0];
    expect(sg?.inputs?.[0]?.linkIds).toEqual([101, 102]);
  });

  it('repairs output linkIds', () => {
    const innerNode = makeNode(10, 0, 1);
    const subgraph: WorkflowSubgraphDefinition = {
      id: 'sg-out-test',
      nodes: [innerNode],
      links: [
        { id: 201, origin_id: 10, origin_slot: 0, target_id: -20, target_slot: 0, type: 'FLOAT' },
      ],
      inputs: [],
      outputs: [
        { id: 'out-slot-0', name: 'value', type: 'FLOAT', linkIds: [] }, // corrupt
      ],
      groups: [],
      config: {},
    };
    const placeholder = makeNode(5, 0, 1);
    placeholder.type = 'sg-out-test';
    const wf = makeWorkflow({
      nodes: [placeholder],
      definitions: { subgraphs: [subgraph] },
    });
    const result = validateAndNormalizeWorkflow(wf);
    const sg = result.definitions?.subgraphs?.[0];
    expect(sg?.outputs?.[0]?.linkIds).toEqual([201]);
  });

  it('sets linkIds to [] when there are no boundary links for that slot', () => {
    const subgraph: WorkflowSubgraphDefinition = {
      id: 'sg-empty-links',
      nodes: [],
      links: [],
      inputs: [
        { id: 'slot-0', name: 'x', type: 'INT', linkIds: [999] }, // stale
      ],
      outputs: [],
      groups: [],
      config: {},
    };
    const wf = makeWorkflow({ definitions: { subgraphs: [subgraph] } });
    const result = validateAndNormalizeWorkflow(wf);
    const sg = result.definitions?.subgraphs?.[0];
    expect(sg?.inputs?.[0]?.linkIds).toEqual([]);
  });

  it('returns same reference when no subgraph corrections needed', () => {
    const subgraph: WorkflowSubgraphDefinition = {
      id: 'sg-already-valid',
      nodes: [],
      links: [
        { id: 301, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'INT' },
      ],
      inputs: [{ id: 'slot-0', name: 'x', type: 'INT', linkIds: [301] }],
      outputs: [],
      groups: [],
      config: {},
    };
    const wf = makeWorkflow({ definitions: { subgraphs: [subgraph] } });
    const result = validateAndNormalizeWorkflow(wf);
    expect(result).toBe(wf);
    expect(result.definitions?.subgraphs?.[0]).toBe(subgraph);
  });

  it('does not modify subgraphs that have no links', () => {
    const subgraph: WorkflowSubgraphDefinition = {
      id: 'sg-no-links',
      nodes: [],
      links: [],
      inputs: [{ id: 'slot-0', name: 'x', type: 'INT' }],
      outputs: [],
      groups: [],
      config: {},
    };
    const wf = makeWorkflow({ definitions: { subgraphs: [subgraph] } });
    const result = validateAndNormalizeWorkflow(wf);
    // No boundary links → linkIds stays undefined (no modification since there's nothing to correct)
    expect(result).toBe(wf);
  });
});

// ---------------------------------------------------------------------------
// validateAndNormalizeWorkflow — root link slot repair
// ---------------------------------------------------------------------------

describe('validateAndNormalizeWorkflow — root link slot repair', () => {
  it('adds missing link ID to output.links', () => {
    const src = makeNode(1, 0, 1);
    const dst = makeNode(2, 1, 0);
    dst.inputs[0]!.link = 10;
    // src.outputs[0].links is empty — missing link 10
    const link: WorkflowLink = [10, 1, 0, 2, 0, 'INT'];
    const wf = makeWorkflow({ nodes: [src, dst], links: [link] });
    const result = validateAndNormalizeWorkflow(wf);
    const srcNode = result.nodes.find((n) => n.id === 1)!;
    expect(srcNode.outputs[0]!.links).toContain(10);
  });

  it('repairs stale input.link', () => {
    const src = makeNode(1, 0, 1);
    src.outputs[0]!.links = [10];
    const dst = makeNode(2, 1, 0);
    dst.inputs[0]!.link = 999; // stale: should be 10
    const link: WorkflowLink = [10, 1, 0, 2, 0, 'INT'];
    const wf = makeWorkflow({ nodes: [src, dst], links: [link] });
    const result = validateAndNormalizeWorkflow(wf);
    const dstNode = result.nodes.find((n) => n.id === 2)!;
    expect(dstNode.inputs[0]!.link).toBe(10);
  });

  it('returns same workflow reference when root links are already valid', () => {
    const src = makeNode(1, 0, 1);
    src.outputs[0]!.links = [10];
    const dst = makeNode(2, 1, 0);
    dst.inputs[0]!.link = 10;
    const link: WorkflowLink = [10, 1, 0, 2, 0, 'INT'];
    const wf = makeWorkflow({ nodes: [src, dst], links: [link] });
    const result = validateAndNormalizeWorkflow(wf);
    expect(result).toBe(wf);
  });

  it('skips missing nodes gracefully', () => {
    // Link references node 99 which does not exist
    const link: WorkflowLink = [10, 99, 0, 98, 0, 'INT'];
    const wf = makeWorkflow({ links: [link] });
    expect(() => validateAndNormalizeWorkflow(wf)).not.toThrow();
    const result = validateAndNormalizeWorkflow(wf);
    expect(result).toBe(wf);
  });
});

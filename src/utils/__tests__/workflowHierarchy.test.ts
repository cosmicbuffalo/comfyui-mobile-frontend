import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import { collectBypassGroupTargetNodes } from '@/utils/workflowHierarchy';

function node(partial: Partial<WorkflowNode> & { id: number; type: string }): WorkflowNode {
  return {
    pos: [10, 40],
    size: [100, 50],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    ...partial,
  };
}

function baseWorkflow(partial: Partial<Workflow>): Workflow {
  return {
    last_node_id: 0,
    last_link_id: 0,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    version: 0.4,
    ...partial,
  };
}

describe('collectBypassGroupTargetNodes', () => {
  const nestedDef: WorkflowSubgraphDefinition = {
    id: 'NESTED00-0000-4000-8000-000000000000',
    nodes: [node({ id: 300, type: 'InnerNested' })],
    links: [],
    groups: [],
  } as WorkflowSubgraphDefinition;
  const outerDef: WorkflowSubgraphDefinition = {
    id: 'OUTER000-0000-4000-8000-000000000000',
    nodes: [
      // Both inside the group box below.
      node({ id: 100, type: 'InnerPlain', pos: [10, 40] }),
      node({ id: 101, type: nestedDef.id, pos: [10, 140] }), // nested placeholder
      // Outside the group box.
      node({ id: 102, type: 'InnerOutside', pos: [900, 900] }),
    ],
    links: [],
    groups: [{ id: 1, title: 'G', color: '#444', bounding: [0, 0, 300, 300] }],
  } as WorkflowSubgraphDefinition;

  const workflow = baseWorkflow({
    last_node_id: 7,
    nodes: [node({ id: 7, type: outerDef.id })],
    definitions: { subgraphs: [outerDef, nestedDef] },
  });

  it('includes a nested subgraph placeholder as a direct target in subgraph scope', () => {
    const targets = collectBypassGroupTargetNodes(workflow, 1, outerDef.id);
    const inScope = targets.filter((t) => t.subgraphId === outerDef.id).map((t) => t.nodeId);
    // Plain member AND the placeholder itself — mirrors the root-scope branch.
    expect(inScope.sort()).toEqual([100, 101]);
    expect(inScope).not.toContain(102);
  });

  it('still descends into the nested definition for its inner nodes', () => {
    const targets = collectBypassGroupTargetNodes(workflow, 1, outerDef.id);
    expect(targets).toContainEqual({ nodeId: 300, subgraphId: nestedDef.id });
  });

  it('root scope includes placeholders among group members (unchanged)', () => {
    const rootDef: WorkflowSubgraphDefinition = {
      id: 'ROOTSG00-0000-4000-8000-000000000000',
      nodes: [node({ id: 400, type: 'InnerRootSg' })],
      links: [],
      groups: [],
    } as WorkflowSubgraphDefinition;
    const wf = baseWorkflow({
      nodes: [
        node({ id: 1, type: 'KSampler', pos: [10, 40] }),
        node({ id: 2, type: rootDef.id, pos: [10, 140] }),
      ],
      groups: [{ id: 5, title: 'RG', color: '#444', bounding: [0, 0, 300, 300] }],
      definitions: { subgraphs: [rootDef] },
    });
    const targets = collectBypassGroupTargetNodes(wf, 5, null);
    const rootIds = targets.filter((t) => t.subgraphId == null).map((t) => t.nodeId);
    expect(rootIds.sort()).toEqual([1, 2]);
    expect(targets).toContainEqual({ nodeId: 400, subgraphId: rootDef.id });
  });
});

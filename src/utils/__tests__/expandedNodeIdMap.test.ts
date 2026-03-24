import { describe, expect, it } from 'vitest';
import { expandWorkflowSubgraphs } from '../expandWorkflowSubgraphs';
import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';

/**
 * Tests for the expandedNodeIdMap derivation logic used in useWorkflow.ts
 * when queuing prompts.  The map must resolve every expanded node ID back to
 * a canonical hierarchical key — even for subgraph inner nodes whose
 * definitions lack an itemKey (e.g. user never navigated into that scope).
 *
 * The derivation algorithm:
 * 1. For nodes with itemKey set → use it directly.
 * 2. For nodes without itemKey whose promptKey is "placeholderId:innerNodeId" →
 *    derive "root/subgraph:{sgUUID}/node:{innerNodeId}" using the placeholder's
 *    type (which is the subgraph definition UUID).
 */

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

/**
 * Replicates the idMap-building logic from useWorkflow.ts queuePrompt action.
 * Kept in sync manually — if the queue code changes, update this too.
 */
function buildExpandedNodeIdMap(
  currentWorkflow: Workflow,
  expandedNodes: WorkflowNode[],
  promptKeyMap: Map<number, string>,
): Record<string, string> {
  const idMap: Record<string, string> = {};

  const placeholderToSgId = new Map<string, string>();
  const subgraphDefs = currentWorkflow.definitions?.subgraphs ?? [];
  const sgIdSet = new Set(subgraphDefs.map((sg) => sg.id));
  for (const node of currentWorkflow.nodes) {
    if (sgIdSet.has(node.type)) {
      placeholderToSgId.set(String(node.id), node.type);
    }
  }

  for (const node of expandedNodes) {
    const promptKey = promptKeyMap.get(node.id);
    let resolvedKey = node.itemKey ?? null;

    if (!resolvedKey && promptKey) {
      const colonIdx = promptKey.indexOf(':');
      if (colonIdx !== -1) {
        const placeholderId = promptKey.substring(0, colonIdx);
        const innerNodeId = promptKey.substring(colonIdx + 1);
        const sgId = placeholderToSgId.get(placeholderId);
        if (sgId && !innerNodeId.includes(':')) {
          resolvedKey = `root/subgraph:${sgId}/node:${innerNodeId}`;
        }
      }
    }

    if (!resolvedKey) continue;
    idMap[String(node.id)] = resolvedKey;
    if (promptKey) idMap[promptKey] = resolvedKey;
  }

  return idMap;
}

describe('expandedNodeIdMap derivation', () => {
  const sgId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  it('maps expanded IDs to derived hierarchical keys for inner nodes without itemKey', () => {
    const innerKSampler = makeNode(961, 'KSamplerAdvanced');
    const innerVAE = makeNode(962, 'VAEDecode');
    const sgDef = makeSubgraphDef(sgId, 'Backend', [innerKSampler, innerVAE]);
    const placeholder = makeNode(5, sgId);
    const wf = makeWorkflow([placeholder], [sgDef]);

    const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(wf);
    const idMap = buildExpandedNodeIdMap(wf, expanded.nodes, promptKeyMap);

    // Both expanded nodes should be in the map
    for (const node of expanded.nodes) {
      const key = idMap[String(node.id)];
      expect(key).toBeDefined();
      expect(key).toMatch(/^root\/subgraph:aaaaaaaa-.*\/node:\d+$/);
    }

    // Prompt keys should also be in the map
    for (const [expandedId, promptKey] of promptKeyMap) {
      if (promptKey.includes(':')) {
        expect(idMap[promptKey]).toBeDefined();
        expect(idMap[promptKey]).toBe(idMap[String(expandedId)]);
      }
    }
  });

  it('prefers existing itemKey over derived key', () => {
    const innerNode = makeNode(100, 'KSampler', {
      itemKey: 'root/subgraph:custom-key/node:100',
    });
    const sgDef = makeSubgraphDef(sgId, 'Sub', [innerNode]);
    const placeholder = makeNode(5, sgId);
    const wf = makeWorkflow([placeholder], [sgDef]);

    const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(wf);
    const idMap = buildExpandedNodeIdMap(wf, expanded.nodes, promptKeyMap);

    // Should use the explicit itemKey, not derive one
    const expandedNode = expanded.nodes[0];
    expect(idMap[String(expandedNode.id)]).toBe('root/subgraph:custom-key/node:100');
  });

  it('maps root nodes by their itemKey', () => {
    const rootNode = makeNode(1, 'SaveImage', { itemKey: 'root/node:1' });
    const wf = makeWorkflow([rootNode]);

    const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(wf);
    const idMap = buildExpandedNodeIdMap(wf, expanded.nodes, promptKeyMap);

    expect(idMap['1']).toBe('root/node:1');
  });

  it('skips root nodes without itemKey', () => {
    const rootNode = makeNode(1, 'SaveImage'); // no itemKey
    const wf = makeWorkflow([rootNode]);

    const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(wf);
    const idMap = buildExpandedNodeIdMap(wf, expanded.nodes, promptKeyMap);

    expect(idMap['1']).toBeUndefined();
  });

  it('handles multiple subgraphs with independent inner nodes', () => {
    const sg1Id = '11111111-1111-1111-1111-111111111111';
    const sg2Id = '22222222-2222-2222-2222-222222222222';
    const sg1Def = makeSubgraphDef(sg1Id, 'Sub1', [makeNode(10, 'NodeA')]);
    const sg2Def = makeSubgraphDef(sg2Id, 'Sub2', [makeNode(20, 'NodeB')]);
    const placeholder1 = makeNode(1, sg1Id);
    const placeholder2 = makeNode(2, sg2Id);
    const wf = makeWorkflow([placeholder1, placeholder2], [sg1Def, sg2Def]);

    const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(wf);
    const idMap = buildExpandedNodeIdMap(wf, expanded.nodes, promptKeyMap);

    const keys = Object.values(idMap);
    expect(keys).toContain(`root/subgraph:${sg1Id}/node:10`);
    expect(keys).toContain(`root/subgraph:${sg2Id}/node:20`);
  });
});

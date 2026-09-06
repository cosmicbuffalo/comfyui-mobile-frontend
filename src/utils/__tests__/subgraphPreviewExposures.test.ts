import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import { resolvePreviewExposureHostKeys } from '@/utils/subgraphPreviewExposures';

function makeNode(
  id: number,
  type: string,
  overrides: Partial<WorkflowNode> = {},
): WorkflowNode {
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
  } as unknown as WorkflowNode;
}

function makeDef(id: string, nodes: WorkflowNode[]): WorkflowSubgraphDefinition {
  return { id, name: id, nodes, links: [], inputs: [], outputs: [] } as unknown as WorkflowSubgraphDefinition;
}

function makeWorkflow(
  nodes: WorkflowNode[],
  subgraphs: WorkflowSubgraphDefinition[],
): Workflow {
  return {
    last_node_id: 0,
    last_link_id: 0,
    nodes,
    links: [],
    groups: [],
    definitions: { subgraphs },
    version: 0.4,
  } as unknown as Workflow;
}

const OUTER = 'aaaaaaaa-0000-0000-0000-000000000001';
const INNER = 'aaaaaaaa-0000-0000-0000-000000000002';

describe('resolvePreviewExposureHostKeys', () => {
  it('mirrors an inner node onto the placeholder that exposes it', () => {
    const wf = makeWorkflow(
      [
        makeNode(30, OUTER, {
          itemKey: 'root/node:30',
          properties: {
            previewExposures: [
              {
                name: '$$canvas-image-preview',
                sourceNodeId: '3',
                sourcePreviewName: '$$canvas-image-preview',
              },
            ],
          },
        }),
      ],
      [makeDef(OUTER, [makeNode(3, 'SaveImage')])],
    );

    expect(resolvePreviewExposureHostKeys(wf, '30:3')).toEqual(['root/node:30']);
  });

  it('ignores an inner node the placeholder did not expose', () => {
    const wf = makeWorkflow(
      [
        makeNode(30, OUTER, {
          itemKey: 'root/node:30',
          properties: { previewExposures: [{ sourceNodeId: '3' }] },
        }),
      ],
      [makeDef(OUTER, [makeNode(3, 'SaveImage'), makeNode(4, 'PreviewImage')])],
    );

    expect(resolvePreviewExposureHostKeys(wf, '30:4')).toEqual([]);
  });

  it('returns nothing for a plain root node', () => {
    const wf = makeWorkflow([makeNode(3, 'SaveImage', { itemKey: 'root/node:3' })], []);
    expect(resolvePreviewExposureHostKeys(wf, '3')).toEqual([]);
  });

  it('chains the exposure up through a nested subgraph', () => {
    const nestedPlaceholder = makeNode(60, INNER, {
      properties: { previewExposures: [{ sourceNodeId: '3' }] },
    });
    const wf = makeWorkflow(
      [
        makeNode(30, OUTER, {
          itemKey: 'root/node:30',
          properties: { previewExposures: [{ sourceNodeId: '60' }] },
        }),
      ],
      [makeDef(OUTER, [nestedPlaceholder]), makeDef(INNER, [makeNode(3, 'SaveImage')])],
    );

    // Innermost host first; the nested placeholder has no itemKey of its own
    // (its scope was never opened), so its key is derived from the definition.
    expect(resolvePreviewExposureHostKeys(wf, '30:60:3')).toEqual([
      `root/subgraph:${OUTER}/node:60`,
      'root/node:30',
    ]);
  });

  it('stops at the first level that does not chain the exposure', () => {
    const nestedPlaceholder = makeNode(60, INNER, {
      properties: { previewExposures: [{ sourceNodeId: '3' }] },
    });
    const wf = makeWorkflow(
      [
        // Exposes a different child, so the chain stops below it.
        makeNode(30, OUTER, {
          itemKey: 'root/node:30',
          properties: { previewExposures: [{ sourceNodeId: '99' }] },
        }),
      ],
      [makeDef(OUTER, [nestedPlaceholder]), makeDef(INNER, [makeNode(3, 'SaveImage')])],
    );

    expect(resolvePreviewExposureHostKeys(wf, '30:60:3')).toEqual([
      `root/subgraph:${OUTER}/node:60`,
    ]);
  });

  it('tolerates a workflow with no subgraph definitions', () => {
    const wf = makeWorkflow([makeNode(30, 'SaveImage')], []);
    expect(resolvePreviewExposureHostKeys(wf, '30:3')).toEqual([]);
    expect(resolvePreviewExposureHostKeys(null, '30:3')).toEqual([]);
  });
});

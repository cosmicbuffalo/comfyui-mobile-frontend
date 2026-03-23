import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowLink, WorkflowNode } from '@/api/types';
import {
  areTypesCompatible,
  isWildcardOnlyMatch,
  findCompatibleNodeTypesForInput,
  findCompatibleNodeTypesForOutput,
  findCompatibleSourceNodes,
  findCompatibleTargetNodesForOutput
} from '../connectionUtils';

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
    ...overrides
  };
}

function makeWorkflow(nodes: WorkflowNode[], links: WorkflowLink[]): Workflow {
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: Math.max(0, ...links.map((l) => l[0])),
    nodes,
    links,
    groups: [],
    config: {},
    version: 1
  };
}

describe('areTypesCompatible', () => {
  it('matches exact types case-insensitively', () => {
    expect(areTypesCompatible('model', 'MODEL')).toBe(true);
  });

  it('supports comma-separated multi-types', () => {
    expect(areTypesCompatible('FLOAT,INT', 'INT')).toBe(true);
    expect(areTypesCompatible('STRING,BOOLEAN', 'INT')).toBe(false);
  });

  it('treats "*" as wildcard', () => {
    expect(areTypesCompatible('*', 'IMAGE')).toBe(true);
    expect(areTypesCompatible('LATENT', '*')).toBe(true);
  });

  it('handles non-string values safely', () => {
    expect(areTypesCompatible(null, 'IMAGE')).toBe(false);
    expect(areTypesCompatible(undefined, 'IMAGE')).toBe(false);
    expect(areTypesCompatible(['IMAGE'], 'IMAGE')).toBe(true);
    expect(areTypesCompatible(['A', 'B'], 'B')).toBe(true);
  });
});

describe('findCompatibleSourceNodes', () => {
  it('returns nodes with compatible outputs excluding target/self', () => {
    const sourceA = makeNode(1, 'LoaderA', {
      outputs: [{ name: 'out', type: 'MODEL', links: null }]
    });
    const sourceB = makeNode(2, 'LoaderB', {
      outputs: [{ name: 'out', type: 'IMAGE', links: null }]
    });
    const target = makeNode(3, 'Consumer', {
      inputs: [{ name: 'model', type: 'MODEL', link: null }]
    });
    const wf = makeWorkflow([sourceA, sourceB, target], []);
    const result = findCompatibleSourceNodes(wf, 3, 0);
    expect(result.map((r) => r.node.id)).toEqual([1]);
    expect(result[0].outputIndex).toBe(0);
  });

  it('includes wildcard-like outputs for picker compatibility', () => {
    const wildcardNode = makeNode(1, 'Wildcard', {
      outputs: [{ name: 'out', type: '*', links: null }]
    });
    const optConnectionNode = makeNode(2, 'Opt', {
      outputs: [{ name: 'out', type: 'OPT_CONNECTION', links: null }]
    });
    const imageNode = makeNode(3, 'ImageNode', {
      outputs: [{ name: 'image', type: 'IMAGE', links: null }]
    });
    const target = makeNode(4, 'PreviewImage', {
      inputs: [{ name: 'images', type: 'IMAGE', link: null }]
    });

    const wf = makeWorkflow([wildcardNode, optConnectionNode, imageNode, target], []);
    const result = findCompatibleSourceNodes(wf, 4, 0);
    expect(result.map((r) => r.node.id)).toEqual([1, 3]);
  });

  it('excludes downstream nodes that would create circular connections', () => {
    const target = makeNode(1, 'Target', {
      inputs: [{ name: 'in', type: 'MODEL', link: null }],
      outputs: [{ name: 'out', type: 'MODEL', links: [1] }]
    });
    const downstreamA = makeNode(2, 'DownstreamA', {
      inputs: [{ name: 'in', type: 'MODEL', link: 1 }],
      outputs: [{ name: 'out', type: 'MODEL', links: [2] }]
    });
    const downstreamB = makeNode(3, 'DownstreamB', {
      inputs: [{ name: 'in', type: 'MODEL', link: 2 }],
      outputs: [{ name: 'out', type: 'MODEL', links: null }]
    });
    const upstream = makeNode(4, 'Upstream', {
      outputs: [{ name: 'out', type: 'MODEL', links: null }]
    });
    const wf = makeWorkflow([
      target,
      downstreamA,
      downstreamB,
      upstream
    ], [
      [1, 1, 0, 2, 0, 'MODEL'],
      [2, 2, 0, 3, 0, 'MODEL']
    ]);

    const result = findCompatibleSourceNodes(wf, 1, 0);
    expect(result.map((r) => r.node.id)).toEqual([4]);
  });

  it('excludes bypassed candidate source nodes', () => {
    const bypassed = makeNode(1, 'Bypassed', {
      mode: 4,
      outputs: [{ name: 'out', type: 'MODEL', links: null }]
    });
    const active = makeNode(2, 'Active', {
      outputs: [{ name: 'out', type: 'MODEL', links: null }]
    });
    const target = makeNode(3, 'Target', {
      inputs: [{ name: 'in', type: 'MODEL', link: null }]
    });
    const wf = makeWorkflow([bypassed, active, target], []);
    const result = findCompatibleSourceNodes(wf, 3, 0);
    expect(result.map((r) => r.node.id)).toEqual([2]);
  });
});

describe('findCompatibleTargetNodesForOutput', () => {
  it('excludes upstream targets that would create circular connections', () => {
    const source = makeNode(1, 'Source', {
      inputs: [{ name: 'in', type: 'MODEL', link: 1 }],
      outputs: [{ name: 'out', type: 'MODEL', links: null }]
    });
    const upstream = makeNode(2, 'Upstream', {
      inputs: [{ name: 'in', type: 'MODEL', link: null }],
      outputs: [{ name: 'out', type: 'MODEL', links: [1] }]
    });
    const validTarget = makeNode(3, 'ValidTarget', {
      inputs: [{ name: 'in', type: 'MODEL', link: null }],
      outputs: []
    });
    const wf = makeWorkflow([
      source,
      upstream,
      validTarget
    ], [
      [1, 2, 0, 1, 0, 'MODEL']
    ]);

    const result = findCompatibleTargetNodesForOutput(wf, 1, 0);
    expect(result.map((r) => r.node.id)).toEqual([3]);
  });

  it('returns all compatible inputs for a single target node', () => {
    const source = makeNode(1, 'Source', {
      outputs: [{ name: 'out', type: 'MODEL', links: null }]
    });
    const multiInputTarget = makeNode(2, 'MultiInputTarget', {
      inputs: [
        { name: 'a', type: 'MODEL', link: null },
        { name: 'b', type: 'MODEL', link: null }
      ],
      outputs: []
    });
    const wf = makeWorkflow([source, multiInputTarget], []);

    const result = findCompatibleTargetNodesForOutput(wf, 1, 0);
    expect(result.filter((r) => r.node.id === 2)).toHaveLength(2);
    expect(result.map((r) => r.inputIndex)).toEqual([0, 1]);
  });

  it('includes wildcard-like target inputs for picker compatibility', () => {
    const source = makeNode(1, 'Source', {
      outputs: [{ name: 'out', type: 'IMAGE', links: null }]
    });
    const wildcardTarget = makeNode(2, 'WildcardTarget', {
      inputs: [{ name: 'in', type: '*', link: null }],
      outputs: []
    });
    const imageTarget = makeNode(3, 'ImageTarget', {
      inputs: [{ name: 'in', type: 'IMAGE', link: null }],
      outputs: []
    });

    const wf = makeWorkflow([source, wildcardTarget, imageTarget], []);
    const result = findCompatibleTargetNodesForOutput(wf, 1, 0);
    expect(result.map((r) => r.node.id)).toEqual([2, 3]);
  });
});

describe('findCompatibleNodeTypesForInput', () => {
  it('returns matching node types with first compatible output index', () => {
    const nodeTypes: NodeTypes = {
      TypeA: {
        input: {},
        output: ['MODEL'],
        name: 'TypeA',
        display_name: 'TypeA',
        description: '',
        python_module: '',
        category: 'test'
      },
      TypeB: {
        input: {},
        output: ['IMAGE', 'MODEL'],
        name: 'TypeB',
        display_name: 'TypeB',
        description: '',
        python_module: '',
        category: 'test'
      }
    };

    const result = findCompatibleNodeTypesForInput(nodeTypes, 'MODEL');
    expect(result.map((r) => r.typeName).sort()).toEqual(['TypeA', 'TypeB']);
    const typeB = result.find((r) => r.typeName === 'TypeB');
    expect(typeB?.outputIndex).toBe(1);
  });

  it('includes wildcard-like node outputs for picker compatibility', () => {
    const nodeTypes: NodeTypes = {
      Wildcard: {
        input: {},
        output: ['*'],
        name: 'Wildcard',
        display_name: 'Wildcard',
        description: '',
        python_module: '',
        category: 'test'
      },
      OptConnection: {
        input: {},
        output: ['OPT_CONNECTION'],
        name: 'OptConnection',
        display_name: 'OptConnection',
        description: '',
        python_module: '',
        category: 'test'
      },
      ImageSource: {
        input: {},
        output: ['IMAGE'],
        name: 'ImageSource',
        display_name: 'ImageSource',
        description: '',
        python_module: '',
        category: 'test'
      }
    };

    const result = findCompatibleNodeTypesForInput(nodeTypes, 'IMAGE');
    expect(result.map((r) => r.typeName)).toEqual(['Wildcard', 'ImageSource']);
  });
});

describe('findCompatibleNodeTypesForOutput', () => {
  it('includes wildcard-like node inputs for picker compatibility', () => {
    const nodeTypes: NodeTypes = {
      WildcardSink: {
        input: {
          required: {
            any_input: ['*']
          }
        },
        output: [],
        name: 'WildcardSink',
        display_name: 'WildcardSink',
        description: '',
        python_module: '',
        category: 'test'
      },
      ImageSink: {
        input: {
          required: {
            image: ['IMAGE']
          }
        },
        output: [],
        name: 'ImageSink',
        display_name: 'ImageSink',
        description: '',
        python_module: '',
        category: 'test'
      },
      StringWidgetOnly: {
        input: {
          required: {
            text: ['STRING']
          }
        },
        output: [],
        name: 'StringWidgetOnly',
        display_name: 'StringWidgetOnly',
        description: '',
        python_module: '',
        category: 'test'
      }
    };

    const result = findCompatibleNodeTypesForOutput(nodeTypes, 'IMAGE');
    expect(result.map((r) => r.typeName)).toEqual(['WildcardSink', 'ImageSink']);
    expect(result.find((r) => r.typeName === 'WildcardSink')?.inputIndex).toBe(0);
  });
});

describe('isWildcardOnlyMatch', () => {
  it('returns true when match is only via wildcard', () => {
    expect(isWildcardOnlyMatch('*', 'IMAGE')).toBe(true);
    expect(isWildcardOnlyMatch('IMAGE', '*')).toBe(true);
    expect(isWildcardOnlyMatch('*', '*')).toBe(true);
  });

  it('returns false when concrete types overlap', () => {
    expect(isWildcardOnlyMatch('IMAGE', 'IMAGE')).toBe(false);
    expect(isWildcardOnlyMatch('IMAGE,*', 'IMAGE')).toBe(false);
  });

  it('returns false when types are incompatible', () => {
    expect(isWildcardOnlyMatch('IMAGE', 'MODEL')).toBe(false);
  });

  it('handles multi-type with wildcard and no concrete overlap', () => {
    expect(isWildcardOnlyMatch('*,MODEL', 'IMAGE')).toBe(true);
  });

  it('treats OPT_CONNECTION as non-wildcard', () => {
    expect(isWildcardOnlyMatch('OPT_CONNECTION', 'IMAGE')).toBe(false);
  });
});

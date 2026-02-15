import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowLink, WorkflowNode } from '@/api/types';
import {
  areTypesCompatible,
  areTypesCompatibleStrict,
  findCompatibleNodeTypesForInput,
  findCompatibleSourceNodes
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
    const nodeTypes = {} as NodeTypes;

    const result = findCompatibleSourceNodes(wf, nodeTypes, 3, 0);
    expect(result.map((r) => r.node.id)).toEqual([1]);
    expect(result[0].outputIndex).toBe(0);
  });

  it('does not include wildcard-like outputs for strict picker compatibility', () => {
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
    const result = findCompatibleSourceNodes(wf, {} as NodeTypes, 4, 0);
    expect(result.map((r) => r.node.id)).toEqual([3]);
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

  it('excludes wildcard-like node outputs for strict picker compatibility', () => {
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
    expect(result.map((r) => r.typeName)).toEqual(['ImageSource']);
  });
});

describe('areTypesCompatibleStrict', () => {
  it('requires concrete type intersection and rejects wildcard-like tokens', () => {
    expect(areTypesCompatibleStrict('IMAGE', 'IMAGE')).toBe(true);
    expect(areTypesCompatibleStrict('*', 'IMAGE')).toBe(false);
    expect(areTypesCompatibleStrict('OPT_CONNECTION', 'IMAGE')).toBe(false);
  });
});

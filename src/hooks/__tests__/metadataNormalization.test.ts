import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '@/api/types';
import {
  findWorkflowShapeProblem,
  normalizeWorkflowNodes,
} from '@/hooks/useWorkflow/metadataNormalization';

describe('findWorkflowShapeProblem', () => {
  const validNode = { id: 1, type: 'KSampler' };

  it('accepts a minimal valid workflow', () => {
    expect(findWorkflowShapeProblem({ nodes: [validNode] })).toBeNull();
    expect(findWorkflowShapeProblem({ nodes: [] })).toBeNull();
  });

  it('accepts valid subgraph definitions', () => {
    expect(
      findWorkflowShapeProblem({
        nodes: [validNode],
        definitions: { subgraphs: [{ id: 'sg-1', nodes: [{ id: 2, type: 'Inner' }] }] },
      }),
    ).toBeNull();
  });

  it('rejects non-objects and missing nodes', () => {
    expect(findWorkflowShapeProblem(null)).not.toBeNull();
    expect(findWorkflowShapeProblem('{}')).not.toBeNull();
    expect(findWorkflowShapeProblem([])).not.toBeNull();
    expect(findWorkflowShapeProblem({})).not.toBeNull();
    expect(findWorkflowShapeProblem({ nodes: 'nope' })).not.toBeNull();
  });

  it('rejects junk node entries that would crash normalization mid-load', () => {
    expect(findWorkflowShapeProblem({ nodes: [null] })).not.toBeNull();
    expect(findWorkflowShapeProblem({ nodes: [42] })).not.toBeNull();
    expect(findWorkflowShapeProblem({ nodes: [{ type: 'NoId' }] })).not.toBeNull();
    expect(findWorkflowShapeProblem({ nodes: [{ id: 1 }] })).not.toBeNull();
  });

  it('rejects malformed subgraph definitions', () => {
    expect(
      findWorkflowShapeProblem({ nodes: [validNode], definitions: { subgraphs: [null] } }),
    ).not.toBeNull();
    expect(
      findWorkflowShapeProblem({
        nodes: [validNode],
        definitions: { subgraphs: [{ id: 'sg', nodes: [null] }] },
      }),
    ).not.toBeNull();
    expect(
      findWorkflowShapeProblem({
        nodes: [validNode],
        definitions: { subgraphs: [{ nodes: [] }] },
      }),
    ).not.toBeNull();
  });
});

describe('normalizeWorkflowNodes defaults', () => {
  it('fills missing pos/size so downstream indexing cannot crash', () => {
    const [normalized] = normalizeWorkflowNodes([
      { id: 1, type: 'KSampler' } as unknown as WorkflowNode,
    ]);
    expect(normalized.pos).toEqual([0, 0]);
    expect(normalized.size).toEqual([200, 100]);
  });

  it('keeps LiteGraph object-serialized pos untouched', () => {
    const objPos = { 0: 12, 1: 34 } as unknown as [number, number];
    const [normalized] = normalizeWorkflowNodes([
      { id: 1, type: 'KSampler', pos: objPos } as unknown as WorkflowNode,
    ]);
    expect(normalized.pos).toBe(objPos);
  });
});

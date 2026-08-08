import { describe, expect, it } from 'vitest';
import {
  collectSetNodeNames,
  getSetGetName,
  isGetNode,
  isSetGetNode,
  isSetNode,
} from '@/utils/setGetNodes';
import { resolveSetGetConnectionLabel } from '@/utils/setGetLabels';
import type { Workflow, WorkflowNode } from '@/api/types';

function mkNode(id: number, type: string, extra: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type,
    pos: [0, 0],
    size: [100, 60],
    flags: {},
    order: id,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    ...extra,
  };
}

describe('setGetNodes util', () => {
  it('detects Set/Get node types', () => {
    expect(isSetNode(mkNode(1, 'SetNode'))).toBe(true);
    expect(isGetNode(mkNode(2, 'GetNode'))).toBe(true);
    expect(isSetGetNode(mkNode(3, 'KSampler'))).toBe(false);
  });

  it('reads the relay name from array or record widget values', () => {
    expect(getSetGetName(mkNode(1, 'SetNode', { widgets_values: ['model'] }))).toBe('model');
    expect(getSetGetName(mkNode(1, 'GetNode', { widgets_values: { value: 'vae' } as never }))).toBe('vae');
    expect(getSetGetName(mkNode(1, 'SetNode', { widgets_values: [''] }))).toBeNull();
    expect(getSetGetName(mkNode(1, 'SetNode'))).toBeNull();
  });

  it('collects distinct SetNode names in document order', () => {
    const wf = {
      nodes: [
        mkNode(1, 'SetNode', { widgets_values: ['a'] }),
        mkNode(2, 'GetNode', { widgets_values: ['a'] }),
        mkNode(3, 'SetNode', { widgets_values: ['b'] }),
        mkNode(4, 'SetNode', { widgets_values: ['a'] }), // dup
      ],
    } as unknown as Workflow;
    expect(collectSetNodeNames(wf)).toEqual(['a', 'b']);
  });
});

describe('resolveSetGetConnectionLabel', () => {
  // source(1).MODEL -> SetNode(2, name "m"); GetNode(3, name "m") -> consumer
  const workflow = {
    nodes: [
      mkNode(1, 'CheckpointLoader', { outputs: [{ name: 'MODEL', type: 'MODEL', links: [10] }] }),
      mkNode(2, 'SetNode', {
        widgets_values: ['m'],
        inputs: [{ name: 'MODEL', type: 'MODEL', link: 10 }],
      }),
      mkNode(3, 'GetNode', {
        widgets_values: ['m'],
        outputs: [{ name: 'MODEL', type: 'MODEL', links: [11] }],
      }),
    ],
    links: [[10, 1, 0, 2, 0, 'MODEL']],
  } as unknown as Workflow;

  it("resolves a GetNode label through its matching SetNode's source", () => {
    expect(resolveSetGetConnectionLabel(workflow, 3, 'output', 'fallback')).toBe('MODEL');
  });

  it("resolves a SetNode's incoming label to its own source", () => {
    expect(resolveSetGetConnectionLabel(workflow, 2, 'input', 'fallback')).toBe('MODEL');
  });

  it("resolves a SetNode's outgoing label to the relay name", () => {
    expect(resolveSetGetConnectionLabel(workflow, 2, 'output', 'fallback')).toBe('m');
  });

  it('falls back when the GetNode name matches no SetNode', () => {
    const orphan = {
      ...workflow,
      nodes: [mkNode(3, 'GetNode', { widgets_values: ['missing'] })],
    } as unknown as Workflow;
    expect(resolveSetGetConnectionLabel(orphan, 3, 'output', 'fallback')).toBe('fallback');
  });

  it('returns fallback for non-Set/Get nodes', () => {
    expect(resolveSetGetConnectionLabel(workflow, 1, 'output', 'fallback')).toBe('fallback');
  });
});

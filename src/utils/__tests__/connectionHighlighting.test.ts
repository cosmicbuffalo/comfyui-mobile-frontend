import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '@/api/types';
import { resolveConnectionHighlightSources } from '@/utils/connectionHighlighting';

function makeNode(id: number, itemKey: string): WorkflowNode {
  return {
    id,
    itemKey,
    type: 'Example',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
  };
}

describe('resolveConnectionHighlightSources', () => {
  it('resolves current hierarchical item keys', () => {
    const node = makeNode(12, 'root/node:12');

    expect(resolveConnectionHighlightSources([node], {
      'root/node:12': 'outputs',
    })).toEqual([{ node, mode: 'outputs' }]);
  });

  it('continues to resolve legacy numeric keys', () => {
    const node = makeNode(12, 'root/node:12');

    expect(resolveConnectionHighlightSources([node], {
      '12': 'inputs',
    })).toEqual([{ node, mode: 'inputs' }]);
  });

  it('ignores off and unknown entries', () => {
    const node = makeNode(12, 'root/node:12');

    expect(resolveConnectionHighlightSources([node], {
      'root/node:12': 'off',
      'root/node:99': 'both',
    })).toEqual([]);
  });
});

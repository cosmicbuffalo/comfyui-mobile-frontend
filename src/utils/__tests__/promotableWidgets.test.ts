import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '@/api/types';
import {
  collectPromotableWidgets,
  type WidgetPromotionDescriptor,
} from '@/utils/promotableWidgets';

function node(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: 1,
    type: 'Sampler',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [12, 7],
    ...overrides,
  };
}

function descriptor(overrides: Partial<WidgetPromotionDescriptor> = {}): WidgetPromotionDescriptor {
  return {
    widgetIndex: 0,
    name: 'steps',
    inputName: 'steps',
    type: 'INT',
    value: 12,
    connected: false,
    inputIndex: -1,
    ...overrides,
  };
}

describe('collectPromotableWidgets', () => {
  it('offers an unmaterialized schema widget only inside a subgraph', () => {
    const target = node();
    expect(collectPromotableWidgets({
      node: target,
      descriptors: [descriptor()],
      isPlaceholder: false,
      inSubgraphScope: false,
    })).toEqual([]);

    expect(collectPromotableWidgets({
      node: target,
      descriptors: [descriptor()],
      isPlaceholder: false,
      inSubgraphScope: true,
    })).toEqual([{ widgetIndex: 0, name: 'steps', inputName: 'steps', type: 'INT', value: 12 }]);
  });

  it('drops connected or already-promoted widgets', () => {
    const target = node({
      inputs: [{ name: 'steps', type: 'INT', link: 9, widget: { name: 'steps' } }],
    });
    expect(collectPromotableWidgets({
      node: target,
      descriptors: [descriptor({ inputIndex: 0 })],
      isPlaceholder: false,
      inSubgraphScope: true,
    })).toEqual([]);
  });

  it('offers boundary-backed placeholder widgets but not direct proxy widgets', () => {
    const placeholder = node({
      type: 'nested-subgraph',
      inputs: [{ name: 'strength', type: 'FLOAT', link: null, widget: { name: 'strength' } }],
    });
    const descriptors = [
      descriptor({ widgetIndex: 0, name: 'Strength', inputName: undefined, type: 'FLOAT', value: 0.8, inputIndex: 0 }),
      descriptor({ widgetIndex: 10001, name: 'Inner: seed', inputName: 'seed', value: 5, inputIndex: -1 }),
    ];
    expect(collectPromotableWidgets({
      node: placeholder,
      descriptors,
      isPlaceholder: true,
      inSubgraphScope: true,
    })).toEqual([
      { widgetIndex: 0, name: 'Strength', inputName: 'strength', type: 'FLOAT', value: 0.8 },
    ]);
  });
});

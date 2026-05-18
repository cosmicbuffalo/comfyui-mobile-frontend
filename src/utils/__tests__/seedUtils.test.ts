import { describe, it, expect } from 'vitest';
import {
  findSeedWidgetIndex,
  hasSeedControlWidget,
  isSpecialSeedValue,
  getSpecialSeedMode,
  getSpecialSeedValueForMode,
  getSeedRandomBounds,
  RGTHREE_SEED_NODE_TYPE,
  SPECIAL_SEED_RANDOM,
  SPECIAL_SEED_INCREMENT,
  SPECIAL_SEED_DECREMENT,
  DEFAULT_SPECIAL_SEED_RANGE
} from '../seedUtils';
import type { WorkflowNode } from '@/api/types';

function makeSeedNode(type: string, widgetsValues: unknown[]): WorkflowNode {
  return {
    id: 1,
    type,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: widgetsValues,
  } as unknown as WorkflowNode;
}

describe('isSpecialSeedValue', () => {
  it('returns true for -1, -2, -3', () => {
    expect(isSpecialSeedValue(-1)).toBe(true);
    expect(isSpecialSeedValue(-2)).toBe(true);
    expect(isSpecialSeedValue(-3)).toBe(true);
  });

  it('returns false for other values', () => {
    expect(isSpecialSeedValue(0)).toBe(false);
    expect(isSpecialSeedValue(1)).toBe(false);
    expect(isSpecialSeedValue(-4)).toBe(false);
    expect(isSpecialSeedValue(42)).toBe(false);
  });
});

describe('getSpecialSeedMode', () => {
  it('maps special seed values to modes', () => {
    expect(getSpecialSeedMode(SPECIAL_SEED_RANDOM)).toBe('randomize');
    expect(getSpecialSeedMode(SPECIAL_SEED_INCREMENT)).toBe('increment');
    expect(getSpecialSeedMode(SPECIAL_SEED_DECREMENT)).toBe('decrement');
  });

  it('returns null for non-special values', () => {
    expect(getSpecialSeedMode(0)).toBeNull();
    expect(getSpecialSeedMode(42)).toBeNull();
  });
});

describe('getSpecialSeedValueForMode', () => {
  it('maps modes to special seed values', () => {
    expect(getSpecialSeedValueForMode('randomize')).toBe(SPECIAL_SEED_RANDOM);
    expect(getSpecialSeedValueForMode('increment')).toBe(SPECIAL_SEED_INCREMENT);
    expect(getSpecialSeedValueForMode('decrement')).toBe(SPECIAL_SEED_DECREMENT);
  });

  it('returns null for fixed mode', () => {
    expect(getSpecialSeedValueForMode('fixed')).toBeNull();
  });

  it('round-trips with getSpecialSeedMode', () => {
    for (const mode of ['randomize', 'increment', 'decrement'] as const) {
      const value = getSpecialSeedValueForMode(mode);
      expect(value).not.toBeNull();
      expect(getSpecialSeedMode(value!)).toBe(mode);
    }
  });
});

describe('getSeedRandomBounds', () => {
  const makeNode = (props?: Record<string, unknown>) =>
    ({ properties: props } as Parameters<typeof getSeedRandomBounds>[0]);

  it('uses defaults when no properties set', () => {
    const result = getSeedRandomBounds(makeNode());
    expect(result).toEqual({ min: 0, max: DEFAULT_SPECIAL_SEED_RANGE });
  });

  it('uses custom min/max from properties', () => {
    const result = getSeedRandomBounds(makeNode({ randomMin: 10, randomMax: 100 }));
    expect(result).toEqual({ min: 10, max: 100 });
  });

  it('clamps to DEFAULT_SPECIAL_SEED_RANGE bounds', () => {
    const result = getSeedRandomBounds(makeNode({
      randomMin: -DEFAULT_SPECIAL_SEED_RANGE * 2,
      randomMax: DEFAULT_SPECIAL_SEED_RANGE * 2
    }));
    expect(result.min).toBe(-DEFAULT_SPECIAL_SEED_RANGE);
    expect(result.max).toBe(DEFAULT_SPECIAL_SEED_RANGE);
  });

  it('swaps min and max when min > max', () => {
    const result = getSeedRandomBounds(makeNode({ randomMin: 100, randomMax: 10 }));
    expect(result).toEqual({ min: 10, max: 100 });
  });

  it('handles non-finite values gracefully', () => {
    const result = getSeedRandomBounds(makeNode({ randomMin: NaN, randomMax: Infinity }));
    expect(result).toEqual({ min: 0, max: DEFAULT_SPECIAL_SEED_RANGE });
  });
});

describe('hasSeedControlWidget', () => {
  it('returns false for rgthree Seed regardless of widget value', () => {
    const node = makeSeedNode(RGTHREE_SEED_NODE_TYPE, [-1]);
    expect(hasSeedControlWidget(node, undefined)).toBe(false);
    expect(hasSeedControlWidget(node, '')).toBe(false);
    expect(hasSeedControlWidget(node, 'randomize')).toBe(false);
  });

  it('returns false for blank/missing values on other node types', () => {
    const node = makeSeedNode('KSampler', [123]);
    expect(hasSeedControlWidget(node, undefined)).toBe(false);
    expect(hasSeedControlWidget(node, null)).toBe(false);
    expect(hasSeedControlWidget(node, '')).toBe(false);
  });

  it('returns true when a non-empty control mode string is present', () => {
    const node = makeSeedNode('KSampler', [123, 'fixed']);
    expect(hasSeedControlWidget(node, 'fixed')).toBe(true);
    expect(hasSeedControlWidget(node, 'randomize')).toBe(true);
    expect(hasSeedControlWidget(node, 'anything-non-empty')).toBe(true);
  });

  it('returns false for non-string control values', () => {
    const node = makeSeedNode('KSampler', [123, 0]);
    expect(hasSeedControlWidget(node, 0)).toBe(false);
    expect(hasSeedControlWidget(node, 42)).toBe(false);
    expect(hasSeedControlWidget(node, true)).toBe(false);
  });
});

describe('findSeedWidgetIndex', () => {
  it('resolves seed index from provided widget descriptors when node type metadata is unavailable', () => {
    const workflow = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [{
        id: 1,
        type: 'subgraph-placeholder',
        pos: [0, 0] as [number, number],
        size: [200, 100] as [number, number],
        flags: {},
        order: 0,
        mode: 0,
        inputs: [],
        outputs: [],
        properties: {},
        widgets_values: [123, 'fixed'],
      }],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    const node = workflow.nodes[0];

    const seedIndex = findSeedWidgetIndex(
      workflow,
      null,
      node,
      {
        widgetDescriptors: [
          { name: 'steps', type: 'INT', widgetIndex: 0 },
          { name: 'seed', type: 'INT', widgetIndex: 3 },
        ],
      }
    );

    expect(seedIndex).toBe(3);
  });
});

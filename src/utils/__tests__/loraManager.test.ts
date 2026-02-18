import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '@/api/types';
import {
  applyLoraValuesToText,
  createDefaultLoraEntry,
  extractLoraList,
  findLoraListIndex,
  isLoraChainProviderNodeType,
  isLoraCyclerNodeType,
  isLoraDirectProviderNodeType,
  isLoraList,
  isLoraLoaderNodeType,
  isLoraManagerNodeType,
  mergeLoras,
  normalizeLoraEntry,
} from '../loraManager';

function makeNode(id: number, type: string, widgetsValues: unknown[]): WorkflowNode {
  return {
    id,
    stableKey: `sk-${id}`,
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
  };
}

describe('loraManager utilities', () => {
  it('detects supported lora manager node types', () => {
    expect(isLoraLoaderNodeType('Lora Loader (LoraManager)')).toBe(true);
    expect(isLoraChainProviderNodeType('Lora Cycler (LoraManager)')).toBe(true);
    expect(isLoraDirectProviderNodeType('WanVideo Lora Select (LoraManager)')).toBe(true);
    expect(isLoraCyclerNodeType('Custom Lora Cycler (LoraManager)')).toBe(true);
    expect(isLoraManagerNodeType('Lora Stacker (LoraManager)')).toBe(true);
    expect(isLoraManagerNodeType('CheckpointLoaderSimple')).toBe(false);
  });

  it('extracts lora lists directly and through __value__ wrappers', () => {
    const list = [{ name: 'foo.safetensors', strength: 0.8 }];
    expect(isLoraList(list)).toBe(true);
    expect(extractLoraList(list)).toEqual(list);
    expect(extractLoraList({ __value__: list })).toEqual(list);
    expect(extractLoraList({ __value__: [{ name: 1 }] })).toBeNull();
  });

  it('finds lora list index from populated arrays and text-index fallback', () => {
    const withList = makeNode(1, 'Lora Loader (LoraManager)', [
      'prompt',
      [{ name: 'bar.safetensors', strength: 1 }],
      'other',
    ]);
    expect(findLoraListIndex(withList, 0)).toBe(1);

    const emptyListAfterText = makeNode(2, 'Lora Loader (LoraManager)', ['prompt', []]);
    expect(findLoraListIndex(emptyListAfterText, 0)).toBe(1);

    const noWidgets = makeNode(3, 'Lora Loader (LoraManager)', []);
    expect(findLoraListIndex(noWidgets, 0)).toBeNull();
  });

  it('normalizes lora entries and creates default entry from choices', () => {
    expect(normalizeLoraEntry({ name: 'foo', strength: '0.5' })).toMatchObject({
      name: 'foo',
      strength: 0.5,
      clipStrength: 0.5,
      active: true,
      expanded: false,
    });

    expect(normalizeLoraEntry({ name: 'foo', strength: 1, clipStrength: 0.6 })).toMatchObject({
      expanded: true,
    });

    expect(createDefaultLoraEntry(['a.safetensors'])).toMatchObject({
      name: 'a.safetensors',
      active: true,
      strength: 1,
      clipStrength: 1,
    });
  });

  it('merges lora syntax text with existing list entries', () => {
    const merged = mergeLoras('<lora:a:0.8> <lora:b:1.2:0.9>', [
      { name: 'a', strength: 0.7, active: false },
    ]);

    expect(merged).toEqual([
      { name: 'a', strength: 0.7, active: false, clipStrength: 0.8, expanded: false },
      { name: 'b', strength: 1.2, clipStrength: 0.9, active: true },
    ]);
  });

  it('applies lora values back into text and appends missing entries', () => {
    const result = applyLoraValuesToText('portrait, <lora:a:1.00>, <lora:b:0.40:0.40>', [
      { name: 'a', strength: 0.55, clipStrength: 0.45, expanded: true },
      { name: 'c', strength: 1.1, active: true },
    ]);

    expect(result).toContain('<lora:a:0.55:0.45>');
    expect(result).toContain('<lora:c:1.10>');
    expect(result).not.toContain('<lora:b:');
  });
});

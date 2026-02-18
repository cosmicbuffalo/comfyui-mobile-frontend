import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '@/api/types';
import {
  buildTriggerWordListFromMessage,
  extractTriggerWordList,
  extractTriggerWordListLoose,
  extractTriggerWordMessage,
  findTriggerWordListIndex,
  findTriggerWordMessageIndex,
  isTriggerWordList,
  isTriggerWordToggleNodeType,
  normalizeTriggerWordEntry,
} from '../triggerWordToggle';

function makeNode(id: number, widgetsValues: unknown[]): WorkflowNode {
  return {
    id,
    stableKey: `sk-${id}`,
    type: 'TriggerWord Toggle (LoraManager)',
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

describe('triggerWordToggle utilities', () => {
  it('detects trigger word toggle node type names', () => {
    expect(isTriggerWordToggleNodeType('TriggerWord Toggle (LoraManager)')).toBe(true);
    expect(isTriggerWordToggleNodeType('triggerword toggler (LoraManager)')).toBe(true);
    expect(isTriggerWordToggleNodeType('Anything Else')).toBe(false);
  });

  it('validates strict vs loose trigger word lists', () => {
    const strictList = [{ text: 'foo', active: true }];
    const looseList = [{ text: 'foo', active: 'yes' }];

    expect(isTriggerWordList(strictList, true)).toBe(true);
    expect(isTriggerWordList(looseList, true)).toBe(false);
    expect(isTriggerWordList(looseList, false)).toBe(true);

    expect(extractTriggerWordList({ __value__: strictList })).toEqual(strictList);
    expect(extractTriggerWordListLoose({ __value__: looseList })).toEqual(looseList);
  });

  it('finds trigger list/message indices with fallback behavior', () => {
    const node = makeNode(1, [
      'prefix',
      [{ text: 'short' }],
      [{ text: 'one', active: true }, { text: 'two', active: false }],
      'message',
    ]);

    expect(findTriggerWordListIndex(node)).toBe(1);
    expect(findTriggerWordMessageIndex(node, 1)).toBe(3);
  });

  it('prefers empty list candidate adjacent to message when no populated list exists', () => {
    const node = makeNode(2, [
      true,
      [],
      false,
      [],
      'foo,bar',
    ]);

    expect(findTriggerWordListIndex(node)).toBe(3);
    expect(findTriggerWordMessageIndex(node, 3)).toBe(4);
  });

  it('extracts message from string or wrapped values', () => {
    expect(extractTriggerWordMessage('hello')).toBe('hello');
    expect(extractTriggerWordMessage({ __value__: 'hello' })).toBe('hello');
    expect(extractTriggerWordMessage(123)).toBeNull();
  });

  it('normalizes entries and respects strength toggle option', () => {
    expect(
      normalizeTriggerWordEntry({ text: 'tag', active: 'yes', strength: '0.4' }, { allowStrengthAdjustment: true })
    ).toEqual({
      text: 'tag',
      active: true,
      strength: 0.4,
      highlighted: undefined,
    });

    expect(
      normalizeTriggerWordEntry({ text: 'tag', strength: 0.4 }, { allowStrengthAdjustment: false })
    ).toMatchObject({ strength: null });
  });

  it('builds trigger word lists from messages and preserves existing state', () => {
    const list = buildTriggerWordListFromMessage('foo, bar', {
      groupMode: false,
      defaultActive: true,
      allowStrengthAdjustment: true,
      existingList: [{ text: 'foo', active: false, strength: 0.25 }],
    });

    expect(list).toEqual([
      { text: 'foo', active: false, strength: 0.25 },
      { text: 'bar', active: true, strength: null },
    ]);

    const grouped = buildTriggerWordListFromMessage('foo,,bar', {
      groupMode: true,
      defaultActive: true,
      allowStrengthAdjustment: false,
    });
    expect(grouped).toEqual([
      { text: 'foo', active: true, strength: null },
      { text: 'bar', active: true, strength: null },
    ]);
  });
});

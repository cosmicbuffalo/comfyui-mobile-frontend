import { describe, expect, it } from 'vitest';
import {
  appendWildcard,
  buildWildcardOptions,
  comboOptionList,
  decorateWildcardPromptWidgets,
  isWildcardSelectWidget,
  isWildcardTargetWidget,
  POPULATED_TEXT_PLACEHOLDER,
  WILDCARD_SELECT_SENTINEL,
  WILDCARD_TEXT_PLACEHOLDER,
} from '@/utils/wildcardWidgets';

describe('wildcard widget detection', () => {
  it('recognizes the picker in either combo option shape', () => {
    expect(isWildcardSelectWidget([WILDCARD_SELECT_SENTINEL])).toBe(true);
    expect(isWildcardSelectWidget({ options: [WILDCARD_SELECT_SENTINEL] })).toBe(true);
    // Easy-Use ships a sample alongside the placeholder.
    expect(isWildcardSelectWidget([WILDCARD_SELECT_SENTINEL, '__example__'])).toBe(true);
  });

  it('leaves ordinary combos alone', () => {
    expect(isWildcardSelectWidget(['fixed', 'randomize'])).toBe(false);
    expect(isWildcardSelectWidget({ options: ['a.safetensors'] })).toBe(false);
    expect(isWildcardSelectWidget(undefined)).toBe(false);
    expect(isWildcardSelectWidget({ multiline: true })).toBe(false);
  });

  it('reads the option list out of both shapes', () => {
    expect(comboOptionList(['a', 'b'])).toEqual(['a', 'b']);
    expect(comboOptionList({ options: ['a'] })).toEqual(['a']);
    expect(comboOptionList({ multiline: true })).toEqual([]);
  });

  it('keeps the placeholder as the first option so the saved value stays valid', () => {
    expect(buildWildcardOptions(['__a__', '__b__'])).toEqual([
      WILDCARD_SELECT_SENTINEL, '__a__', '__b__',
    ]);
    // No pack installed: the dropdown still offers its placeholder, not nothing.
    expect(buildWildcardOptions([])).toEqual([WILDCARD_SELECT_SENTINEL]);
  });
});

describe('wildcard insertion target', () => {
  it('takes multiline strings and nothing else', () => {
    expect(isWildcardTargetWidget({ type: 'STRING', options: { multiline: true } })).toBe(true);
    expect(isWildcardTargetWidget({ type: 'string', options: { multiline: true } })).toBe(true);
    // A single-line string is a filename/label field, not a prompt box.
    expect(isWildcardTargetWidget({ type: 'STRING', options: {} })).toBe(false);
    expect(isWildcardTargetWidget({ type: 'INT', options: { multiline: true } })).toBe(false);
    expect(isWildcardTargetWidget({ type: 'STRING', options: ['a'] })).toBe(false);
    expect(isWildcardTargetWidget({ type: 'STRING' })).toBe(false);
  });
});

describe('wildcard prompt box decoration', () => {
  const textWidgets = () => ([
    { name: 'wildcard_text', type: 'STRING', options: { multiline: true } },
    { name: 'populated_text', type: 'STRING', options: { multiline: true } },
  ]);
  const modeWidget = (value: string) => ([{ name: 'mode', type: 'COMBO', value }]);
  const byName = <T extends { name: string }>(list: T[], name: string): T =>
    list.find((widget) => widget.name === name)!;

  it('gives both boxes the placeholders desktop uses', () => {
    const out = decorateWildcardPromptWidgets(textWidgets(), modeWidget('populate'));
    expect((byName(out, 'wildcard_text').options as Record<string, unknown>).placeholder)
      .toBe(WILDCARD_TEXT_PLACEHOLDER);
    expect((byName(out, 'populated_text').options as Record<string, unknown>).placeholder)
      .toBe(POPULATED_TEXT_PLACEHOLDER);
    // The existing options are preserved, not replaced.
    expect((byName(out, 'populated_text').options as Record<string, unknown>).multiline).toBe(true);
  });

  it('disables populated_text only while the server owns it', () => {
    const populated = (mode: string) =>
      byName(decorateWildcardPromptWidgets(textWidgets(), modeWidget(mode)), 'populated_text');
    // populate: regenerated at queue time, so typing there would be overwritten.
    expect(populated('populate').disabled).toBe(true);
    // fixed/reproduce: the stored text is what runs, so it stays editable.
    expect(populated('fixed').disabled).toBe(false);
    expect(populated('reproduce').disabled).toBe(false);
    // wildcard_text is always the user's to edit.
    expect(byName(decorateWildcardPromptWidgets(textWidgets(), modeWidget('populate')),
      'wildcard_text').disabled).toBeUndefined();
  });

  it('defaults to disabled when the mode widget is missing', () => {
    const out = decorateWildcardPromptWidgets(textWidgets(), []);
    expect(byName(out, 'populated_text').disabled).toBe(true);
  });

  it('leaves unrelated nodes untouched', () => {
    const other = [{ name: 'text', type: 'STRING', options: { multiline: true } }];
    expect(decorateWildcardPromptWidgets(other, [])).toBe(other);
    // A node with only one of the pair is not a wildcard prompt node.
    const half = [{ name: 'wildcard_text', type: 'STRING', options: {} }];
    expect(decorateWildcardPromptWidgets(half, [])).toBe(half);
  });
});

describe('appending a wildcard to prompt text', () => {
  it('comma-separates onto existing text, matching desktop', () => {
    expect(appendWildcard('a sunset', '__color__')).toBe('a sunset, __color__');
  });

  it('does not lead with a separator on an empty box', () => {
    expect(appendWildcard('', '__color__')).toBe('__color__');
    expect(appendWildcard(undefined, '__color__')).toBe('__color__');
    expect(appendWildcard(null, '__color__')).toBe('__color__');
    // A non-string slot (never written yet) must not stringify into the prompt.
    expect(appendWildcard(0, '__color__')).toBe('__color__');
  });
});

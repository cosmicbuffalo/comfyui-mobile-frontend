import { describe, expect, it } from 'vitest';
import {
  addWeightToLora,
  applySuggestion,
  escapeParentheses,
  getActiveToken,
  normalizeTagToInsert,
  parseToken,
  searchNames,
  searchTags,
  type TagEntry,
} from '../autocompleteSearch';

const TAGS: TagEntry[] = [
  { tag: 'blue_eyes', category: 0, count: 1000, aliases: [] },
  { tag: 'blue_hair', category: 0, count: 800, aliases: [] },
  { tag: 'long_hair', category: 0, count: 1200, aliases: ['longhair'] },
  { tag: 'dark_blue_background', category: 0, count: 50, aliases: [] },
];

describe('getActiveToken', () => {
  it('returns the token at the caret, skipping a leading space after a comma', () => {
    const value = 'long_hair, blue';
    const token = getActiveToken(value, value.length);
    expect(token.text).toBe('blue');
    expect(token.start).toBe('long_hair, '.length);
    expect(token.end).toBe(value.length);
  });

  it('splits on newlines as well as commas', () => {
    const value = 'a\nblu';
    const token = getActiveToken(value, value.length);
    expect(token.text).toBe('blu');
  });

  it('handles a caret in the middle of the string', () => {
    const value = 'blue_eyes, smile';
    const token = getActiveToken(value, 4); // "blue"
    expect(token.text).toBe('blue');
    expect(token.start).toBe(0);
  });
});

describe('parseToken', () => {
  it('detects lora and embedding prefixes', () => {
    expect(parseToken('<lora:realism').kind).toBe('lora');
    expect(parseToken('<lora:realism').query).toBe('realism');
    expect(parseToken('embedding:bad').kind).toBe('embedding');
    expect(parseToken('blue').kind).toBe('tag');
  });
});

describe('searchTags', () => {
  it('requires a minimum query length', () => {
    expect(searchTags(TAGS, 'b')).toEqual([]);
  });

  it('ranks prefix matches by count and normalizes spaces to underscores', () => {
    const results = searchTags(TAGS, 'blue h');
    expect(results.map((r) => r.label)).toEqual(['blue_hair']);
  });

  it('falls back to substring matches after prefix matches', () => {
    const results = searchTags(TAGS, 'blue');
    expect(results.map((r) => r.label)).toContain('dark_blue_background');
    // prefix matches come first
    expect(results[0].label).toBe('blue_eyes');
  });

  it('matches aliases when the canonical tag does not match', () => {
    const results = searchTags(TAGS, 'longhair');
    expect(results[0].label).toBe('long_hair');
    expect(results[0].matchedAlias).toBe('longhair');
  });
});

describe('searchNames', () => {
  it('lists everything (capped) for an empty query', () => {
    const results = searchNames(['a', 'b'], '', 'lora');
    expect(results).toHaveLength(2);
    expect(results[0].insertText).toBe('<lora:a>');
  });

  it('builds embedding insert text', () => {
    const results = searchNames(['badhands'], 'bad', 'embedding');
    expect(results[0].insertText).toBe('embedding:badhands');
  });
});

describe('normalizeTagToInsert', () => {
  it('replaces underscores with spaces', () => {
    expect(normalizeTagToInsert('blue_eyes')).toBe('blue eyes');
  });

  it('escapes parentheses for single tags after de-underscoring', () => {
    expect(normalizeTagToInsert('heart_(symbol)')).toBe('heart \\(symbol\\)');
  });

  it('leaves wildcards untouched', () => {
    expect(normalizeTagToInsert('__season__')).toBe('__season__');
  });

  it('keeps underscores in pure-symbol tags (no letters/numbers)', () => {
    expect(normalizeTagToInsert('^_^')).toBe('^_^');
  });
});

describe('escapeParentheses', () => {
  it('escapes unescaped parens', () => {
    expect(escapeParentheses('a(b)c')).toBe('a\\(b\\)c');
  });

  it('does not double-escape already-escaped parens', () => {
    expect(escapeParentheses('a\\(b\\)c')).toBe('a\\(b\\)c');
  });
});

describe('addWeightToLora', () => {
  it('adds a default weight', () => {
    expect(addWeightToLora('<lora:realism>')).toBe('<lora:realism:1.0>');
  });

  it('preserves an existing weight', () => {
    expect(addWeightToLora('<lora:realism:0.5>')).toBe('<lora:realism:0.5>');
  });
});

describe('applySuggestion', () => {
  it('de-underscores the tag and appends ", "', () => {
    const value = 'long_hair, blu';
    const token = getActiveToken(value, value.length);
    const result = applySuggestion(value, token, {
      kind: 'tag',
      label: 'blue_eyes',
      insertText: 'blue_eyes',
    });
    expect(result.value).toBe('long_hair, blue eyes, ');
    expect(result.caret).toBe(result.value.length);
  });

  it('does not double a separator that already follows', () => {
    const value = 'blu, smile';
    const token = getActiveToken(value, 3); // "blu"
    const result = applySuggestion(value, token, {
      kind: 'tag',
      label: 'blue_eyes',
      insertText: 'blue_eyes',
    });
    expect(result.value).toBe('blue eyes, smile');
  });

  it('adds a leading space after a bare comma', () => {
    const value = 'tag1,blu';
    const token = getActiveToken(value, value.length);
    const result = applySuggestion(value, token, {
      kind: 'tag',
      label: 'blue_eyes',
      insertText: 'blue_eyes',
    });
    expect(result.value).toBe('tag1, blue eyes, ');
  });

  it('adds a default weight + comma for a lora insertion', () => {
    const value = '<lora:real';
    const token = getActiveToken(value, value.length);
    const result = applySuggestion(value, token, {
      kind: 'lora',
      label: 'realism',
      insertText: '<lora:realism>',
    });
    expect(result.value).toBe('<lora:realism:1.0>, ');
  });
});

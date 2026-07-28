import { describe, expect, it } from 'vitest';
import { CUSTOM_WORD_CATEGORY, parseCustomWords } from '../customScriptsClient';

describe('parseCustomWords', () => {
  it('parses bare words with zero count and the custom category', () => {
    const entries = parseCustomWords('masterpiece\nbest quality\n');
    expect(entries).toEqual([
      { tag: 'masterpiece', category: CUSTOM_WORD_CATEGORY, count: 0, aliases: [] },
      { tag: 'best quality', category: CUSTOM_WORD_CATEGORY, count: 0, aliases: [] },
    ]);
  });

  it('treats a numeric second column as priority and sorts by it', () => {
    const entries = parseCustomWords('low,5\nhigh,100');
    expect(entries.map((e) => e.tag)).toEqual(['high', 'low']);
    expect(entries[0].count).toBe(100);
  });

  it('treats a non-numeric second column as an alias', () => {
    const entries = parseCustomWords('blue eyes,blaue augen');
    expect(entries).toEqual([
      { tag: 'blue eyes', category: CUSTOM_WORD_CATEGORY, count: 0, aliases: ['blaue augen'] },
    ]);
  });

  it('parses the a1111 four-column csv format with quoted alias lists', () => {
    const entries = parseCustomWords('long_hair,0,1200,"longhair,long hairstyle"');
    expect(entries).toEqual([
      {
        tag: 'long_hair',
        category: CUSTOM_WORD_CATEGORY,
        count: 1200,
        aliases: ['longhair', 'long hairstyle'],
      },
    ]);
  });

  it('skips the literal "null" alias cell seen in common a1111 csv files', () => {
    const entries = parseCustomWords('smile,0,900,null');
    expect(entries[0].aliases).toEqual([]);
  });

  it('parses the word,alias,priority three-column form', () => {
    const entries = parseCustomWords('canonical,typed,42');
    expect(entries).toEqual([
      { tag: 'canonical', category: CUSTOM_WORD_CATEGORY, count: 42, aliases: ['typed'] },
    ]);
  });

  it('skips blank lines and rows without a word', () => {
    const entries = parseCustomWords('\n\n,50\nreal_word\n  \n');
    expect(entries.map((e) => e.tag)).toEqual(['real_word']);
  });

  it('keeps the last duplicate row but unions its aliases', () => {
    const entries = parseCustomWords('word,alias one\nword,7');
    expect(entries).toEqual([
      { tag: 'word', category: CUSTOM_WORD_CATEGORY, count: 7, aliases: ['alias one'] },
    ]);
  });

  it('handles escaped quotes inside quoted fields', () => {
    const entries = parseCustomWords('tag,0,10,"say ""hi"",wave"');
    expect(entries[0].aliases).toEqual(['say "hi"', 'wave']);
  });
});

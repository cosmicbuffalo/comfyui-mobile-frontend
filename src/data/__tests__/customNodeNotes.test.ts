import { describe, expect, it } from 'vitest';
import { CUSTOM_NODE_NOTES, getCustomNodeNote } from '../customNodeNotes';

describe('getCustomNodeNote', () => {
  it('matches the Autocomplete-Plus node by title', () => {
    const note = getCustomNodeNote(['ComfyUI-Autocomplete-Plus', undefined, undefined, undefined]);
    expect(note).toBeDefined();
    expect(note?.unsupported).toContain('Related Tags panel (co-occurrence suggestions)');
  });

  it('matches by repository URL', () => {
    const note = getCustomNodeNote([
      'Some Display Name',
      'pkg-id',
      'pkg-key',
      'https://github.com/newtextdoc1111/ComfyUI-Autocomplete-Plus',
    ]);
    expect(note).toBeDefined();
  });

  it('returns undefined for unknown nodes', () => {
    expect(getCustomNodeNote(['ComfyUI-SomethingElse', 'x', 'y', undefined])).toBeUndefined();
  });

  it('returns undefined when given no identifiers', () => {
    expect(getCustomNodeNote([undefined, undefined])).toBeUndefined();
  });

  it('every entry has at least one match token', () => {
    for (const note of CUSTOM_NODE_NOTES) {
      expect(note.match.length).toBeGreaterThan(0);
    }
  });
});

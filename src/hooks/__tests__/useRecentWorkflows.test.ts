import { describe, it, expect } from 'vitest';
import {
  dedupeKey,
  isValidEntry,
  mergeEntries,
  MAX_RECENT_ENTRIES,
  type RecentWorkflowEntry,
} from '../useRecentWorkflows';
import type { WorkflowSource } from '../useWorkflow';

function makeEntry(
  filename: string,
  source: WorkflowSource | null,
  timestamp = 1000,
): RecentWorkflowEntry {
  return { filename, source, timestamp };
}

describe('dedupeKey', () => {
  it('returns user key for user source', () => {
    expect(dedupeKey({ filename: 'x', source: { type: 'user', filename: 'my/flow.json' } }))
      .toBe('user:my/flow.json');
  });

  it('returns template key for template source', () => {
    expect(dedupeKey({ filename: 'x', source: { type: 'template', moduleName: 'mod', templateName: 'tpl' } }))
      .toBe('template:mod/tpl');
  });

  it('returns history key for history source', () => {
    expect(dedupeKey({ filename: 'x', source: { type: 'history', promptId: 'p-1' } }))
      .toBe('history:p-1');
  });

  it('returns file key for file source', () => {
    expect(dedupeKey({ filename: 'x', source: { type: 'file', filePath: 'sub/img.png', assetSource: 'output' } }))
      .toBe('file:output:sub/img.png');
  });

  it('returns other key for other source', () => {
    expect(dedupeKey({ filename: 'pasted.json', source: { type: 'other' } }))
      .toBe('other:pasted.json');
  });

  it('returns other key for null source', () => {
    expect(dedupeKey({ filename: 'foo.json', source: null }))
      .toBe('other:foo.json');
  });

  it('returns fallback key for unknown source type', () => {
    const bogus = { type: 'bogus' } as unknown as WorkflowSource;
    expect(dedupeKey({ filename: 'bar.json', source: bogus }))
      .toBe('other:bar.json');
  });
});

describe('isValidEntry', () => {
  it('accepts a valid entry', () => {
    expect(isValidEntry({ filename: 'a.json', source: null, timestamp: 100 })).toBe(true);
  });

  it('accepts entry with object source', () => {
    expect(isValidEntry({ filename: 'a.json', source: { type: 'user', filename: 'x' }, timestamp: 100 })).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidEntry(null)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isValidEntry('string')).toBe(false);
  });

  it('rejects missing filename', () => {
    expect(isValidEntry({ source: null, timestamp: 100 })).toBe(false);
  });

  it('rejects missing timestamp', () => {
    expect(isValidEntry({ filename: 'a.json', source: null })).toBe(false);
  });

  it('rejects non-null non-object source', () => {
    expect(isValidEntry({ filename: 'a.json', source: 'bad', timestamp: 100 })).toBe(false);
  });
});

describe('mergeEntries', () => {
  it('merges local and remote with local winning on newer timestamp', () => {
    const local = [makeEntry('a.json', { type: 'user', filename: 'a.json' }, 2000)];
    const remote = [makeEntry('a.json', { type: 'user', filename: 'a.json' }, 1000)];
    const result = mergeEntries(local, remote);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(2000);
  });

  it('keeps remote entry when it is newer', () => {
    const local = [makeEntry('a.json', { type: 'user', filename: 'a.json' }, 1000)];
    const remote = [makeEntry('a.json', { type: 'user', filename: 'a.json' }, 3000)];
    const result = mergeEntries(local, remote);
    expect(result).toHaveLength(1);
    expect(result[0].timestamp).toBe(3000);
  });

  it('combines entries with different keys', () => {
    const local = [makeEntry('a.json', { type: 'user', filename: 'a.json' }, 2000)];
    const remote = [makeEntry('b.json', { type: 'user', filename: 'b.json' }, 1000)];
    const result = mergeEntries(local, remote);
    expect(result).toHaveLength(2);
    expect(result[0].filename).toBe('a.json'); // newer first
    expect(result[1].filename).toBe('b.json');
  });

  it('sorts by most recent first', () => {
    const local = [
      makeEntry('old.json', { type: 'user', filename: 'old.json' }, 100),
      makeEntry('new.json', { type: 'user', filename: 'new.json' }, 5000),
    ];
    const result = mergeEntries(local, []);
    expect(result[0].filename).toBe('new.json');
    expect(result[1].filename).toBe('old.json');
  });

  it('caps at MAX_RECENT', () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      makeEntry(`w${i}.json`, { type: 'user', filename: `w${i}.json` }, i * 100),
    );
    const result = mergeEntries(entries, []);
    expect(result).toHaveLength(MAX_RECENT_ENTRIES);
    // Should keep the 10 most recent (highest timestamps)
    expect(result[0].timestamp).toBe(1400);
    expect(result[result.length - 1].timestamp).toBe(500);
  });

  it('dedupes across different source types correctly', () => {
    const local = [
      makeEntry('img.png', { type: 'file', filePath: 'img.png', assetSource: 'output' }, 2000),
    ];
    const remote = [
      makeEntry('img.png', { type: 'user', filename: 'img.png' }, 3000),
    ];
    // Different dedupe keys, so both should be kept
    const result = mergeEntries(local, remote);
    expect(result).toHaveLength(2);
  });
});

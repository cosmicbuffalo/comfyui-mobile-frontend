import { describe, expect, it } from 'vitest';
import { isWorkflowHidden, isWorkflowSourceHidden } from '../workflowHidden';

describe('isWorkflowSourceHidden', () => {
  it('recognizes user workflows hidden directly, by folder, or by dot path', () => {
    expect(isWorkflowSourceHidden(
      { type: 'user', filename: 'private/flow.json' },
      ['private'],
    )).toBe(true);
    expect(isWorkflowSourceHidden(
      { type: 'user', filename: '.private/flow.json' },
    )).toBe(true);
  });

  it('carries hidden provenance from output and history workflow sources', () => {
    expect(isWorkflowSourceHidden({
      type: 'file',
      filePath: 'image.png',
      assetSource: 'output',
      hidden: true,
    })).toBe(true);
    expect(isWorkflowSourceHidden({
      type: 'history',
      promptId: 'prompt-1',
      hidden: true,
    })).toBe(true);
  });
});

describe('isWorkflowHidden', () => {
  it('recognizes a hidden file by filename even when the source is not a user file', () => {
    // A workflow opened before it was hidden may carry a non-user source, but its
    // currentFilename still matches the hidden path.
    expect(isWorkflowHidden(
      { type: 'other' },
      'private/flow.json',
      ['private'],
    )).toBe(true);
    expect(isWorkflowHidden(null, '.drafts/flow.json', [])).toBe(true);
  });

  it('does not flag a workflow whose filename is not hidden', () => {
    expect(isWorkflowHidden({ type: 'other' }, 'public/flow.json', ['private'])).toBe(false);
    expect(isWorkflowHidden(null, null, ['private'])).toBe(false);
  });

  it('still honors a recognized hidden source regardless of filename', () => {
    expect(isWorkflowHidden(
      { type: 'history', promptId: 'p1', hidden: true },
      null,
      [],
    )).toBe(true);
  });
});

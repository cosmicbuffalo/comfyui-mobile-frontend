import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import {
  computeQueueWorkflowDiff,
  nonSeedWidgetsDiffer,
  selectDiffBase,
  wordDiff,
} from '../workflowDiff';

function mkNode(p: Partial<WorkflowNode> & { id: number; type: string }): WorkflowNode {
  const base = {
    pos: [0, 0] as [number, number],
    size: [0, 0] as [number, number],
    flags: {},
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [] as unknown[],
  };
  return { ...base, ...p, order: p.order ?? p.id } as WorkflowNode;
}

function mkWf(
  nodes: WorkflowNode[],
  widgetIdxMap?: Record<string, Record<string, number>>,
): Workflow {
  return {
    last_node_id: 0,
    last_link_id: 0,
    nodes,
    links: [],
    groups: [],
    config: {},
    version: 0.4,
    widget_idx_map: widgetIdxMap,
  };
}

const WIDGET_MAP = {
  '1': { text: 0 },
  '2': { text: 0 },
  '3': { seed: 0, steps: 1 },
};

function baseWorkflow(): Workflow {
  return mkWf(
    [
      mkNode({ id: 1, type: 'CLIPTextEncode', title: 'Positive', widgets_values: ['a cat'] }),
      mkNode({ id: 2, type: 'CLIPTextEncode', title: 'Negative', widgets_values: ['blurry'] }),
      mkNode({ id: 3, type: 'KSampler', title: 'Sampler', widgets_values: [123, 20] }),
    ],
    WIDGET_MAP,
  );
}

function editedWorkflow(): Workflow {
  return mkWf(
    [
      mkNode({ id: 1, type: 'CLIPTextEncode', title: 'Positive', widgets_values: ['a big cat'] }),
      mkNode({ id: 2, type: 'CLIPTextEncode', title: 'Negative', widgets_values: ['blurry'] }),
      mkNode({ id: 3, type: 'KSampler', title: 'Sampler', widgets_values: [123, 25] }),
    ],
    WIDGET_MAP,
  );
}

describe('wordDiff', () => {
  it('returns a single equal segment for identical text', () => {
    expect(wordDiff('same text', 'same text')).toEqual([{ type: 'equal', text: 'same text' }]);
  });

  it('marks inserted words as added while preserving whitespace', () => {
    const segments = wordDiff('a cat', 'a big cat');
    expect(segments).toEqual([
      { type: 'equal', text: 'a ' },
      { type: 'added', text: 'big ' },
      { type: 'equal', text: 'cat' },
    ]);
    // equal + added reconstruct the full current text.
    const reconstructed = segments
      .filter((s) => s.type !== 'removed')
      .map((s) => s.text)
      .join('');
    expect(reconstructed).toBe('a big cat');
  });

  it('marks removed words', () => {
    const segments = wordDiff('soft warm light', 'warm light');
    expect(segments).toEqual([
      { type: 'removed', text: 'soft ' },
      { type: 'equal', text: 'warm light' },
    ]);
  });

  it('treats a from-empty change as fully added', () => {
    expect(wordDiff('', 'brand new')).toEqual([{ type: 'added', text: 'brand new' }]);
  });

  it('splits trailing punctuation so the word itself stays equal', () => {
    expect(wordDiff('a cat', 'a cat,')).toEqual([
      { type: 'equal', text: 'a cat' },
      { type: 'added', text: ',' },
    ]);
  });

  it('diffs only the changed punctuation, not the attached word', () => {
    expect(wordDiff('a cat.', 'a cat,')).toEqual([
      { type: 'equal', text: 'a cat' },
      { type: 'removed', text: '.' },
      { type: 'added', text: ',' },
    ]);
  });

  it('keeps internal apostrophes and hyphens as part of the word', () => {
    expect(wordDiff("a well-known cat", "a well-known dog")).toEqual([
      { type: 'equal', text: 'a well-known ' },
      { type: 'removed', text: 'cat' },
      { type: 'added', text: 'dog' },
    ]);
  });
});

describe('computeQueueWorkflowDiff', () => {
  it('returns all prompts sorted by label with inline diffs and node-field changes', () => {
    const diff = computeQueueWorkflowDiff(baseWorkflow(), editedWorkflow());

    // Prompts: every text node, sorted by label (Negative before Positive).
    expect(diff.prompts.map((p) => p.label)).toEqual(['Negative', 'Positive']);
    const negative = diff.prompts.find((p) => p.label === 'Negative')!;
    const positive = diff.prompts.find((p) => p.label === 'Positive')!;
    expect(negative.changed).toBe(false);
    expect(positive.changed).toBe(true);
    expect(positive.segments).toEqual([
      { type: 'equal', text: 'a ' },
      { type: 'added', text: 'big ' },
      { type: 'equal', text: 'cat' },
    ]);

    // Non-prompt node field change rendered as old -> new.
    expect(diff.nodeChanges).toHaveLength(1);
    expect(diff.nodeChanges[0]).toMatchObject({
      label: 'Sampler',
      changes: [{ field: 'steps', before: '20', after: '25' }],
    });
  });

  it('uses the node label (title) for prompt grouping', () => {
    const diff = computeQueueWorkflowDiff(baseWorkflow(), editedWorkflow());
    expect(diff.prompts.every((p) => p.label === 'Positive' || p.label === 'Negative')).toBe(true);
  });

  it('shows full prompt text with no highlights and no node changes when base is null', () => {
    const diff = computeQueueWorkflowDiff(null, editedWorkflow());
    expect(diff.nodeChanges).toHaveLength(0);
    const positive = diff.prompts.find((p) => p.label === 'Positive')!;
    expect(positive.changed).toBe(false);
    expect(positive.segments).toEqual([{ type: 'equal', text: 'a big cat' }]);
  });
});

// widget_idx_map marks node 3's widget 0 as 'seed', so it is ignored by the
// non-seed change detection.
function wf(text: string, steps: number, seed: number): Workflow {
  return mkWf(
    [
      mkNode({ id: 1, type: 'CLIPTextEncode', title: 'Positive', widgets_values: [text] }),
      mkNode({ id: 2, type: 'CLIPTextEncode', title: 'Negative', widgets_values: ['blurry'] }),
      mkNode({ id: 3, type: 'KSampler', title: 'Sampler', widgets_values: [seed, steps] }),
    ],
    WIDGET_MAP,
  );
}

describe('nonSeedWidgetsDiffer', () => {
  it('ignores seed-only differences', () => {
    expect(nonSeedWidgetsDiffer(wf('a cat', 20, 111), wf('a cat', 20, 222))).toBe(false);
  });

  it('detects prompt text changes', () => {
    expect(nonSeedWidgetsDiffer(wf('a cat', 20, 111), wf('a dog', 20, 111))).toBe(true);
  });

  it('detects non-seed widget (steps) changes', () => {
    expect(nonSeedWidgetsDiffer(wf('a cat', 20, 111), wf('a cat', 25, 111))).toBe(true);
  });
});

describe('selectDiffBase (enqueue-time base rule)', () => {
  const original = wf('a cat', 20, 1);

  it('diffs the first enqueue against the original/persisted workflow', () => {
    const { base, nextDiffBase } = selectDiffBase(wf('a big cat', 20, 111), null, null, original);
    expect(base).toBe(original);
    expect(nextDiffBase).toBeNull();
  });

  it('keeps the original base across repeated enqueues that only change the seed', () => {
    // First enqueue recorded "a big cat" with seed 111; re-enqueue with seed 222.
    const first = wf('a big cat', 20, 111);
    const second = wf('a big cat', 20, 222);
    const { base, nextDiffBase } = selectDiffBase(second, first, null, original);
    expect(base).toBe(original); // still diffs the text change against the original
    expect(nextDiffBase).toBeNull(); // base did not advance
  });

  it('advances the base to the last enqueued snapshot after a non-seed change', () => {
    const lastEnqueued = wf('a big cat', 20, 222);
    const current = wf('a big cat', 30, 333); // steps changed (non-seed)
    const { base, nextDiffBase } = selectDiffBase(current, lastEnqueued, null, original);
    expect(base).toBe(lastEnqueued);
    expect(nextDiffBase).toBe(lastEnqueued);
  });

  it('keeps the advanced base across later seed-only re-enqueues', () => {
    const advancedBase = wf('a big cat', 20, 222);
    const lastEnqueued = wf('a big cat', 30, 333);
    const current = wf('a big cat', 30, 444); // only seed changed since last enqueue
    const { base } = selectDiffBase(current, lastEnqueued, advancedBase, original);
    expect(base).toBe(advancedBase);
  });
});

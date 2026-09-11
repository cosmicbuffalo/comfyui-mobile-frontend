import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import {
  collectQueueSeeds,
  computeQueueWorkflowDiff,
  nonSeedWidgetsDiffer,
  selectDiffBase,
  withoutSeedFieldChanges,
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

describe('subgraph placeholder labels', () => {
  // A placeholder's `type` is its definition's UUID. Untitled instances used to
  // read as that raw UUID in the preview, which names nothing to a reader.
  function placeholderWorkflow(
    seed: number,
    title?: string,
    instanceNumber?: number,
  ): Workflow {
    return {
      ...mkWf([
        mkNode({
          id: 814,
          type: 'a-subgraph-uuid',
          title,
          properties: instanceNumber === undefined
            ? {}
            : { mobileInstanceNumber: instanceNumber },
          widgets_values: [seed],
        }),
      ]),
      definitions: {
        subgraphs: [{
          id: 'a-subgraph-uuid',
          name: 'Section {n}',
          nodes: [],
          links: [],
        }],
      },
    } as Workflow;
  }

  it('names an untitled instance after its definition, {n} resolved', () => {
    const diff = computeQueueWorkflowDiff(
      placeholderWorkflow(1, undefined, 3),
      placeholderWorkflow(2, undefined, 3),
    );
    expect(diff.nodeChanges.map((change) => change.label)).toEqual(['Section 3']);
  });

  it('drops the {n} token when the instance carries no number', () => {
    const diff = computeQueueWorkflowDiff(
      placeholderWorkflow(1),
      placeholderWorkflow(2),
    );
    expect(diff.nodeChanges.map((change) => change.label)).toEqual(['Section']);
  });

  it('still prefers a title the user set on the instance', () => {
    const diff = computeQueueWorkflowDiff(
      placeholderWorkflow(1, 'Opening shot', 3),
      placeholderWorkflow(2, 'Opening shot', 3),
    );
    expect(diff.nodeChanges.map((change) => change.label)).toEqual(['Opening shot']);
  });
});

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

describe('collectQueueSeeds', () => {
  // The canonical workflow the prompt was built from: a top-level sampler and a
  // subgraph placeholder (node 50) whose definition holds an inner sampler.
  const workflow: Workflow = {
    ...mkWf([
      mkNode({ id: 3, type: 'KSampler', title: 'Sampler' }),
      mkNode({ id: 50, type: 'a-subgraph-uuid', title: 'Video model' }),
    ]),
    definitions: {
      subgraphs: [{
        id: 'a-subgraph-uuid',
        name: 'Video model',
        nodes: [mkNode({ id: 7, type: 'KSampler', title: 'High noise' })],
        links: [],
      }],
    },
  } as Workflow;

  it('reads the seed each node actually ran with off the built prompt', () => {
    const seeds = collectQueueSeeds(
      {
        '3': { class_type: 'KSampler', inputs: { seed: 987, steps: 20 } },
        '50:7': { class_type: 'KSampler', inputs: { noise_seed: 4242 } },
      },
      workflow,
    );

    expect(seeds).toEqual([
      { nodeId: '3', label: 'Sampler', field: 'seed', value: 987 },
      // Named after the placeholder as well, so two samplers inside the same
      // subgraph stay tellable apart.
      { nodeId: '50:7', label: 'Video model / High noise', field: 'noise_seed', value: 4242 },
    ]);
  });

  it('names an untitled placeholder in a seed label by its instance name', () => {
    const untitled = {
      ...mkWf([mkNode({ id: 50, type: 'a-subgraph-uuid', properties: { mobileInstanceNumber: 2 } })]),
      definitions: {
        subgraphs: [{
          id: 'a-subgraph-uuid',
          name: 'Section {n}',
          nodes: [mkNode({ id: 7, type: 'KSampler', title: 'High noise' })],
          links: [],
        }],
      },
    } as Workflow;

    const seeds = collectQueueSeeds(
      { '50:7': { class_type: 'KSampler', inputs: { noise_seed: 4242 } } },
      untitled,
    );
    expect(seeds.map((seed) => seed.label)).toEqual(['Section 2 / High noise']);
  });

  it('falls back to the class type when no workflow came with the item', () => {
    // History from another client can arrive without an embedded workflow; the
    // seed is still in the prompt, so the row is still worth showing.
    const seeds = collectQueueSeeds(
      { '3': { class_type: 'KSampler', inputs: { seed: 987 } } },
    );
    expect(seeds).toEqual([
      { nodeId: '3', label: 'KSampler', field: 'seed', value: 987 },
    ]);
  });

  it('ignores a connected seed and fields that merely mention seed', () => {
    const seeds = collectQueueSeeds(
      {
        '3': {
          class_type: 'KSampler',
          // A linked seed is [sourceNodeId, slot] — not a value this run owns.
          inputs: { seed: [9, 0], seed_mode: 'randomize', seed_offset: 5 },
        },
      },
      workflow,
    );

    expect(seeds).toEqual([]);
  });
});

describe('withoutSeedFieldChanges', () => {
  const seeds = [{ nodeId: '3', label: 'Sampler', field: 'seed', value: 987 }];

  it('drops the widget change the seeds list already reports', () => {
    const changes = withoutSeedFieldChanges(
      [
        {
          nodeId: '3',
          label: 'Sampler',
          order: 3,
          changes: [
            { field: 'seed', before: '123', after: '987' },
            { field: 'steps', before: '20', after: '30' },
          ],
        },
      ],
      seeds,
    );

    expect(changes).toEqual([
      {
        nodeId: '3',
        label: 'Sampler',
        order: 3,
        changes: [{ field: 'steps', before: '20', after: '30' }],
      },
    ]);
  });

  it('drops a node whose only change was its seed', () => {
    const changes = withoutSeedFieldChanges(
      [
        {
          nodeId: '3',
          label: 'Sampler',
          order: 3,
          changes: [{ field: 'seed', before: '123', after: '987' }],
        },
      ],
      seeds,
    );

    expect(changes).toEqual([]);
  });

  it('drops a placeholder seed change reported under a hierarchical execution id', () => {
    // The executed seed reports under "30:3" (the inner node that ran), but
    // the widget its write-back changed sits on placeholder 30 — whose slot
    // has no resolvable name, so the diff labels it "widget 6".
    const changes = withoutSeedFieldChanges(
      [
        {
          nodeId: '30',
          label: 'Text to Image',
          order: 0,
          changes: [{ field: 'widget 6', before: '594361197674106', after: '976226005' }],
        },
      ],
      [{ nodeId: '30:3', label: 'Text to Image / KSampler', field: 'seed', value: 976226005 }],
    );

    expect(changes).toEqual([]);
  });

  it('keeps a non-seed edit on the seed node that collides with the seed value', () => {
    const nodeChanges = [
      {
        nodeId: '3',
        label: 'Sampler',
        order: 3,
        changes: [{ field: 'steps', before: '20', after: '987' }],
      },
    ];
    expect(withoutSeedFieldChanges(nodeChanges, seeds)).toEqual(nodeChanges);
  });

  it('keeps the same value on a different node', () => {
    const nodeChanges = [
      {
        nodeId: '4',
        label: 'Other sampler',
        order: 4,
        changes: [{ field: 'seed', before: '1', after: '987' }],
      },
    ];
    expect(withoutSeedFieldChanges(nodeChanges, seeds)).toEqual(nodeChanges);
  });
});

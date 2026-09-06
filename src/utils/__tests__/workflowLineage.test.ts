import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import {
  buildStructuralFingerprint,
  collectNodeIdentities,
  countSharedIdentities,
  findLineageMatch,
  identityOverlap,
  normalizeRegistry,
  readLineageStamp,
  withLineageStamp,
  type LineageRegistry,
} from '../workflowLineage';

function makeNode(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    type,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides,
  };
}

function makeWorkflow(
  nodes: WorkflowNode[],
  links: Workflow['links'] = [],
  extra?: Partial<Workflow>,
): Workflow {
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: 0,
    nodes,
    links,
    groups: [],
    config: {},
    version: 1,
    ...extra,
  };
}

const baseNodes = () => [
  makeNode(1, 'CheckpointLoaderSimple'),
  makeNode(3, 'KSampler'),
  makeNode(8, 'VAEDecode'),
];

describe('buildStructuralFingerprint', () => {
  it('ignores position, size, widget values, collapsed flags and mode', () => {
    const before = makeWorkflow(baseNodes());
    const after = makeWorkflow([
      makeNode(1, 'CheckpointLoaderSimple', { pos: [900, 400], widgets_values: ['x.safetensors'] }),
      makeNode(3, 'KSampler', { mode: 4, size: [640, 480] }),
      makeNode(8, 'VAEDecode', { flags: { collapsed: true } }),
    ]);
    expect(buildStructuralFingerprint(after)).toBe(buildStructuralFingerprint(before));
  });

  it('ignores link ids, which the load-time validator renumbers', () => {
    const before = makeWorkflow(baseNodes(), [[1, 1, 0, 3, 0, 'MODEL']]);
    const after = makeWorkflow(baseNodes(), [[97, 1, 0, 3, 0, 'MODEL']]);
    expect(buildStructuralFingerprint(after)).toBe(buildStructuralFingerprint(before));
  });

  it('changes when a node is added, removed, retyped or rewired', () => {
    const base = buildStructuralFingerprint(makeWorkflow(baseNodes()));
    expect(
      buildStructuralFingerprint(makeWorkflow([...baseNodes(), makeNode(9, 'LoraLoader')])),
    ).not.toBe(base);
    expect(buildStructuralFingerprint(makeWorkflow(baseNodes().slice(0, 2)))).not.toBe(base);
    expect(
      buildStructuralFingerprint(
        makeWorkflow([makeNode(1, 'CheckpointLoaderSimple'), makeNode(3, 'KSamplerAdvanced'), makeNode(8, 'VAEDecode')]),
      ),
    ).not.toBe(base);
    expect(
      buildStructuralFingerprint(makeWorkflow(baseNodes(), [[1, 1, 0, 8, 0, 'MODEL']])),
    ).not.toBe(buildStructuralFingerprint(makeWorkflow(baseNodes(), [[1, 1, 0, 3, 0, 'MODEL']])));
  });

  it('covers subgraph interiors and ignores definition ordering', () => {
    const sub = (id: string, nodes: WorkflowNode[]) => ({
      id,
      nodes,
      groups: [],
      links: [],
      config: {},
    });
    const withInner = makeWorkflow(baseNodes(), [], {
      definitions: { subgraphs: [sub('sg-a', [makeNode(20, 'InnerA')])] },
    });
    const innerChanged = makeWorkflow(baseNodes(), [], {
      definitions: { subgraphs: [sub('sg-a', [makeNode(20, 'InnerB')])] },
    });
    expect(buildStructuralFingerprint(innerChanged)).not.toBe(
      buildStructuralFingerprint(withInner),
    );

    const orderA = makeWorkflow(baseNodes(), [], {
      definitions: {
        subgraphs: [sub('sg-a', [makeNode(20, 'InnerA')]), sub('sg-b', [makeNode(21, 'InnerB')])],
      },
    });
    const orderB = makeWorkflow(baseNodes(), [], {
      definitions: {
        subgraphs: [sub('sg-b', [makeNode(21, 'InnerB')]), sub('sg-a', [makeNode(20, 'InnerA')])],
      },
    });
    expect(buildStructuralFingerprint(orderB)).toBe(buildStructuralFingerprint(orderA));
  });
});

describe('identity matching', () => {
  it('measures overlap against the smaller set so a workflow matches what it grew into', () => {
    const small = ['1:A', '2:B', '3:C', '4:D'];
    const grown = [...small, '5:E', '6:F', '7:G', '8:H', '9:I', '10:J'];
    expect(identityOverlap(small, grown)).toBe(1);
    expect(countSharedIdentities(small, grown)).toBe(4);
  });

  it('attaches to the closest member rather than the lineage root', () => {
    const registry: LineageRegistry = {
      version: 1,
      lineages: [
        {
          id: 'lin-1',
          members: [
            { id: 'root', parent: null, fingerprint: 'f0', identity: ['1:A', '2:B', '3:C', '4:D'], createdAt: 0 },
            {
              id: 'later',
              parent: 'root',
              fingerprint: 'f1',
              identity: ['1:A', '2:B', '3:C', '4:D', '5:E', '6:F'],
              createdAt: 1,
            },
          ],
          bookmarks: [],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    };
    const match = findLineageMatch(registry, ['1:A', '2:B', '3:C', '4:D', '5:E', '6:F']);
    expect(match?.lineageId).toBe('lin-1');
    expect(match?.memberId).toBe('later');
  });

  it('refuses a match that clears the ratio on too few shared nodes', () => {
    const registry: LineageRegistry = {
      version: 1,
      lineages: [
        {
          id: 'lin-1',
          members: [
            {
              id: 'root',
              parent: null,
              fingerprint: 'f0',
              identity: ['1:CheckpointLoaderSimple', '8:VAEDecode', '9:SaveImage', '20:Reroute', '21:Note'],
              createdAt: 0,
            },
          ],
          bookmarks: [],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    };
    // Three shared entries out of three — a perfect ratio on a tiny workflow,
    // which is exactly the coincidence the absolute floor exists to reject.
    expect(
      findLineageMatch(registry, ['1:CheckpointLoaderSimple', '8:VAEDecode', '9:SaveImage']),
    ).toBeNull();
  });
});

describe('stamps', () => {
  it('round-trips and leaves an already-correct workflow untouched', () => {
    const workflow = makeWorkflow(baseNodes());
    expect(readLineageStamp(workflow)).toBeNull();
    const stamped = withLineageStamp(workflow, { lineage: 'lin-1', member: 'mem-1' });
    expect(readLineageStamp(stamped)).toEqual({ lineage: 'lin-1', member: 'mem-1' });
    expect(withLineageStamp(stamped, { lineage: 'lin-1', member: 'mem-1' })).toBe(stamped);
  });

  it('preserves other extra keys', () => {
    const workflow = makeWorkflow(baseNodes(), [], { extra: { ds: { scale: 1 } } });
    const stamped = withLineageStamp(workflow, { lineage: 'lin-1', member: 'mem-1' });
    expect(stamped.extra?.ds).toEqual({ scale: 1 });
  });

  it('rejects a malformed stamp rather than trusting it', () => {
    expect(readLineageStamp(makeWorkflow([], [], { extra: { mobile_lineage: 'nope' } }))).toBeNull();
    expect(
      readLineageStamp(makeWorkflow([], [], { extra: { mobile_lineage: { lineage: 'a' } } })),
    ).toBeNull();
  });
});

describe('normalizeRegistry', () => {
  it('drops unusable entries and re-roots orphaned parent pointers', () => {
    const normalized = normalizeRegistry({
      lineages: [
        { id: 'ok', members: [{ id: 'm1', fingerprint: 'f', parent: 'ghost' }], bookmarks: ['a', 'a'] },
        { id: 'no-members', members: [], bookmarks: [] },
        { members: [{ id: 'm', fingerprint: 'f' }] },
        'garbage',
      ],
    });
    expect(normalized.lineages).toHaveLength(1);
    expect(normalized.lineages[0].id).toBe('ok');
    expect(normalized.lineages[0].members[0].parent).toBeNull();
    expect(normalized.lineages[0].bookmarks).toEqual(['a']);
  });

  it('returns an empty registry for junk input', () => {
    expect(normalizeRegistry(null).lineages).toEqual([]);
    expect(normalizeRegistry({ lineages: 'nope' }).lineages).toEqual([]);
  });
});

describe('collectNodeIdentities', () => {
  it('scopes subgraph nodes so inner ids cannot collide with root ids', () => {
    const workflow = makeWorkflow([makeNode(1, 'A')], [], {
      definitions: { subgraphs: [{ id: 'sg', nodes: [makeNode(1, 'A')], groups: [], links: [], config: {} }] },
    });
    expect(collectNodeIdentities(workflow)).toEqual(['1:A', 'sg/1:A']);
  });
});

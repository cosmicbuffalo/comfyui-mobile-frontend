import { beforeEach, describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useWorkflowLineageStore } from '../useWorkflowLineage';
import {
  createEmptyRegistry,
  readLineageStamp,
  withLineageStamp,
} from '@/utils/workflowLineage';

function makeNode(id: number, type: string): WorkflowNode {
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
  };
}

function makeWorkflow(nodes: WorkflowNode[]): Workflow {
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: 0,
    nodes,
    links: [],
    groups: [],
    config: {},
    version: 1,
  };
}

const BASE = () => [
  makeNode(1, 'CheckpointLoaderSimple'),
  makeNode(3, 'KSampler'),
  makeNode(5, 'EmptyLatentImage'),
  makeNode(8, 'VAEDecode'),
  makeNode(9, 'SaveImage'),
];

beforeEach(() => {
  useWorkflowLineageStore.setState({
    registry: createEmptyRegistry(),
    serverSynced: false,
    serverDirty: false,
    registryReady: true,
  });
});

describe('resolveLineage', () => {
  it('founds a lineage for an unstamped workflow and reports it as new', () => {
    const stamp = useWorkflowLineageStore.getState().resolveLineage(makeWorkflow(BASE()));
    expect(stamp?.createdLineage).toBe(true);
    expect(useWorkflowLineageStore.getState().registry.lineages).toHaveLength(1);
  });

  it('dedupes a repeat open of the same structure onto one member', () => {
    const store = useWorkflowLineageStore.getState();
    const first = store.resolveLineage(makeWorkflow(BASE()));
    const second = useWorkflowLineageStore
      .getState()
      .resolveLineage(withLineageStamp(makeWorkflow(BASE()), first!));
    expect(second?.lineage).toBe(first?.lineage);
    expect(second?.member).toBe(first?.member);
    expect(useWorkflowLineageStore.getState().registry.lineages[0].members).toHaveLength(1);
  });

  it('mints a child member when a stamped workflow has a new structure', () => {
    const first = useWorkflowLineageStore.getState().resolveLineage(makeWorkflow(BASE()));
    const grown = withLineageStamp(
      makeWorkflow([...BASE(), makeNode(12, 'LoraLoader')]),
      first!,
    );
    const second = useWorkflowLineageStore.getState().resolveLineage(grown);
    expect(second?.lineage).toBe(first?.lineage);
    expect(second?.member).not.toBe(first?.member);
    expect(second?.createdLineage).toBe(false);

    const members = useWorkflowLineageStore.getState().registry.lineages[0].members;
    expect(members).toHaveLength(2);
    expect(members[1].parent).toBe(first?.member);
  });

  it('fuzzy-matches an unstamped variant into the existing family', () => {
    const first = useWorkflowLineageStore.getState().resolveLineage(makeWorkflow(BASE()));
    // No stamp: what a workflow re-authored on desktop, or downloaded, looks
    // like. Two nodes differ out of six.
    const cousin = makeWorkflow([...BASE().slice(0, 4), makeNode(30, 'SaveImageWebsocket')]);
    const second = useWorkflowLineageStore.getState().resolveLineage(cousin);
    expect(second?.lineage).toBe(first?.lineage);
    expect(second?.createdLineage).toBe(false);
  });

  it('founds a separate lineage for a workflow that shares too little', () => {
    const first = useWorkflowLineageStore.getState().resolveLineage(makeWorkflow(BASE()));
    const unrelated = makeWorkflow([
      makeNode(40, 'LoadAudio'),
      makeNode(41, 'AudioEncode'),
      makeNode(42, 'AudioSave'),
    ]);
    const second = useWorkflowLineageStore.getState().resolveLineage(unrelated);
    expect(second?.lineage).not.toBe(first?.lineage);
    expect(second?.createdLineage).toBe(true);
    expect(useWorkflowLineageStore.getState().registry.lineages).toHaveLength(2);
  });

  it('adopts the ids of a workflow stamped for an unknown lineage', () => {
    const foreign = withLineageStamp(makeWorkflow(BASE()), {
      lineage: 'someone-elses-lineage',
      member: 'someone-elses-member',
    });
    const stamp = useWorkflowLineageStore.getState().resolveLineage(foreign);
    expect(stamp?.lineage).toBe('someone-elses-lineage');
    expect(stamp?.member).toBe('someone-elses-member');
    // Adopted, not founded — the real family may still arrive from the server,
    // and its bookmarks must not be overwritten by this device's local set.
    expect(stamp?.createdLineage).toBe(false);
  });

  it('leaves the registry alone when minting is off', () => {
    useWorkflowLineageStore.getState().resolveLineage(makeWorkflow(BASE()), { mint: false });
    expect(useWorkflowLineageStore.getState().registry.lineages).toHaveLength(0);
  });

  it('will not found a family before the registry has arrived', () => {
    // The window between page load and the registry GET completing: founding
    // here would create a second family for one the server already has, and
    // the stamp written into the workflow would pin it there.
    useWorkflowLineageStore.setState({ registryReady: false });
    expect(useWorkflowLineageStore.getState().resolveLineage(makeWorkflow(BASE()))).toBeNull();
    expect(useWorkflowLineageStore.getState().registry.lineages).toHaveLength(0);
  });

  it('still records a new member inside a known family before the registry arrives', () => {
    const first = useWorkflowLineageStore.getState().resolveLineage(makeWorkflow(BASE()))!;
    useWorkflowLineageStore.setState({ registryReady: false });
    const grown = withLineageStamp(
      makeWorkflow([...BASE(), makeNode(12, 'LoraLoader')]),
      first,
    );
    const second = useWorkflowLineageStore.getState().resolveLineage(grown);
    expect(second?.lineage).toBe(first.lineage);
    expect(second?.member).not.toBe(first.member);
  });
});

describe('registry merge', () => {
  it('keeps families from both sides and takes bookmarks from the newer copy', async () => {
    const { mergeRegistries } = await import('@/utils/workflowLineage');
    const local = {
      version: 1 as const,
      lineages: [
        {
          id: 'shared',
          members: [{ id: 'm1', parent: null, fingerprint: 'f1', identity: [], createdAt: 1 }],
          bookmarks: ['local'],
          createdAt: 1,
          updatedAt: 20,
        },
        {
          id: 'local-only',
          members: [{ id: 'm2', parent: null, fingerprint: 'f2', identity: [], createdAt: 1 }],
          bookmarks: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    const remote = {
      version: 1 as const,
      lineages: [
        {
          id: 'shared',
          members: [{ id: 'm3', parent: null, fingerprint: 'f3', identity: [], createdAt: 1 }],
          bookmarks: ['remote'],
          createdAt: 1,
          updatedAt: 10,
        },
        {
          id: 'remote-only',
          members: [{ id: 'm4', parent: null, fingerprint: 'f4', identity: [], createdAt: 1 }],
          bookmarks: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    const merged = mergeRegistries(local, remote);
    expect(merged.lineages.map((l) => l.id).sort()).toEqual([
      'local-only',
      'remote-only',
      'shared',
    ]);
    const shared = merged.lineages.find((l) => l.id === 'shared')!;
    // Members union; bookmarks come from the side touched last (local here).
    expect(shared.members.map((m) => m.id).sort()).toEqual(['m1', 'm3']);
    expect(shared.bookmarks).toEqual(['local']);
  });
});

describe('lineage bookmarks', () => {
  it('stores and reads back a bookmark set', () => {
    const stamp = useWorkflowLineageStore.getState().resolveLineage(makeWorkflow(BASE()))!;
    useWorkflowLineageStore.getState().setBookmarks(stamp.lineage, ['root/node:3', 'root/node:3']);
    expect(useWorkflowLineageStore.getState().getBookmarks(stamp.lineage)).toEqual([
      'root/node:3',
    ]);
  });

  it('marks the registry dirty so it flushes to the server', () => {
    const stamp = useWorkflowLineageStore.getState().resolveLineage(makeWorkflow(BASE()))!;
    useWorkflowLineageStore.setState({ serverDirty: false });
    useWorkflowLineageStore.getState().setBookmarks(stamp.lineage, ['root/node:3']);
    expect(useWorkflowLineageStore.getState().serverDirty).toBe(true);
  });
});

describe('stamp carried on the workflow', () => {
  it('survives a save-shaped round trip through extra', () => {
    const stamp = useWorkflowLineageStore.getState().resolveLineage(makeWorkflow(BASE()))!;
    const stamped = withLineageStamp(makeWorkflow(BASE()), stamp);
    const roundTripped = JSON.parse(JSON.stringify(stamped)) as Workflow;
    expect(readLineageStamp(roundTripped)).toEqual({
      lineage: stamp.lineage,
      member: stamp.member,
    });
  });
});

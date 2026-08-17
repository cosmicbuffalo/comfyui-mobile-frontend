import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowLink, WorkflowNode } from '@/api/types';
import { resolveUseEverywhereConnectionLabel } from '@/utils/useEverywhereLabels';

function node(partial: Partial<WorkflowNode> & { type: string; id: number }): WorkflowNode {
  return {
    pos: [0, 0],
    size: [100, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    ...partial,
  };
}

function workflow(nodes: WorkflowNode[], links: WorkflowLink[] = []): Workflow {
  return {
    nodes,
    links,
    groups: [],
    last_node_id: 99,
    last_link_id: 99,
    config: {},
    version: 0.4,
  };
}

const FALLBACK = 'anything';

describe('resolveUseEverywhereConnectionLabel', () => {
  it('names the broadcast type from the link feeding the controller', () => {
    const source = node({ id: 1, type: 'CheckpointLoader', outputs: [{ name: 'MODEL', type: 'MODEL', links: [10] }] });
    const controller = node({
      id: 2,
      type: 'Anything Everywhere',
      // The slot itself stays the wildcard no matter what is plugged in, which is
      // exactly why the label cannot come from it.
      inputs: [{ name: 'anything', type: '*', link: 10 }],
    });
    const wf = workflow([source, controller], [[10, 1, 0, 2, 0, 'MODEL']]);
    expect(resolveUseEverywhereConnectionLabel(wf, 2, 0, FALLBACK)).toBe('MODEL');
  });

  it('gives the same answer for the synthesized output side', () => {
    // Both halves of the card describe one broadcast and resolve through the same
    // controller slot, so `MODEL` in must read as `MODEL` out.
    const source = node({ id: 1, type: 'VAELoader', outputs: [{ name: 'VAE', type: 'VAE', links: [10] }] });
    const controller = node({ id: 2, type: 'Anything Everywhere', inputs: [{ name: 'anything', type: '*', link: 10 }] });
    const wf = workflow([source, controller], [[10, 1, 0, 2, 0, 'VAE']]);
    expect(resolveUseEverywhereConnectionLabel(wf, 2, 0, FALLBACK)).toBe('VAE');
  });

  it('labels each slot of a triplet independently', () => {
    const ckpt = node({
      id: 1,
      type: 'CheckpointLoader',
      outputs: [
        { name: 'MODEL', type: 'MODEL', links: [10] },
        { name: 'CLIP', type: 'CLIP', links: [11] },
      ],
    });
    const triplet = node({
      id: 2,
      type: 'Anything Everywhere3',
      inputs: [
        { name: 'anything', type: '*', link: 10 },
        { name: 'anything2', type: '*', link: 11 },
      ],
    });
    const wf = workflow(
      [ckpt, triplet],
      [
        [10, 1, 0, 2, 0, 'MODEL'],
        [11, 1, 1, 2, 1, 'CLIP'],
      ],
    );
    expect(resolveUseEverywhereConnectionLabel(wf, 2, 0, FALLBACK)).toBe('MODEL');
    expect(resolveUseEverywhereConnectionLabel(wf, 2, 1, FALLBACK)).toBe('CLIP');
  });

  it('falls back to the slot label when the controller input is unconnected', () => {
    const controller = node({ id: 2, type: 'Anything Everywhere3', inputs: [{ name: 'anything', type: '*', link: null }] });
    expect(resolveUseEverywhereConnectionLabel(workflow([controller]), 2, 0, FALLBACK)).toBe(FALLBACK);
  });

  it('prefers an explicit slot label when the link has no usable type', () => {
    const source = node({ id: 1, type: 'Loader', outputs: [{ name: 'out', type: '', links: [10] }] });
    const controller = node({
      id: 2,
      type: 'Anything Everywhere',
      inputs: [{ name: 'anything', label: 'MODEL', type: '*', link: 10 }],
    });
    const wf = workflow([source, controller], [[10, 1, 0, 2, 0, '']]);
    expect(resolveUseEverywhereConnectionLabel(wf, 2, 0, FALLBACK)).toBe('MODEL');
  });

  it('leaves non-Use-Everywhere nodes alone', () => {
    const sampler = node({ id: 1, type: 'KSampler', inputs: [{ name: 'model', type: 'MODEL', link: 10 }] });
    expect(resolveUseEverywhereConnectionLabel(workflow([sampler]), 1, 0, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back for a slot index that does not exist', () => {
    const controller = node({ id: 2, type: 'Anything Everywhere', inputs: [] });
    expect(resolveUseEverywhereConnectionLabel(workflow([controller]), 2, 3, FALLBACK)).toBe(FALLBACK);
  });
});

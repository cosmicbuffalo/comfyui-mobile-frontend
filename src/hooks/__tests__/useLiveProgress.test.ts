import { beforeEach, describe, expect, it } from 'vitest';
import {
  inFlightNodeFraction,
  parseLiveProgressSnapshot,
  useLiveProgressStore,
} from '@/hooks/useLiveProgress';

describe('live progress snapshots', () => {
  beforeEach(() => useLiveProgressStore.getState().reset());

  it('blends the running node fraction into cached-aware node counts', () => {
    const snapshot = parseLiveProgressSnapshot({
      prompt_id: 'p1',
      value: 10,
      max: 20,
      nodes_total: 10,
      nodes_done: 4,
      node_name: 'KSampler',
    });

    expect(snapshot).toMatchObject({
      promptId: 'p1',
      nodesDone: 4,
      nodesTotal: 10,
      nodeIndex: 5,
      nodeName: 'KSampler',
      nodeProgressPercent: 50,
      overallProgressPercent: 45,
    });
  });

  it('clears stale node interpolation between nodes', () => {
    expect(parseLiveProgressSnapshot({
      prompt_id: 'p1',
      value: 20,
      max: 20,
      nodes_total: 10,
      nodes_done: 5,
      node_name: null,
    })).toMatchObject({
      nodeName: null,
      nodeIndex: null,
      nodeProgressPercent: null,
      overallProgressPercent: 50,
    });
  });

  it('never claims 100% before an explicit finished event', () => {
    expect(inFlightNodeFraction(20, 20)).toBe(0.99);
    useLiveProgressStore.getState().applyMessage({
      prompt_id: 'p1',
      value: 20,
      max: 20,
      nodes_total: 1,
      nodes_done: 0,
      node_name: 'KSampler',
    });
    expect(useLiveProgressStore.getState().snapshot?.overallProgressPercent).toBe(99);

    useLiveProgressStore.getState().applyMessage({ type: 'finished', prompt_id: 'p1' });
    expect(useLiveProgressStore.getState().snapshot).toMatchObject({
      overallProgressPercent: 100,
      nodeName: null,
      nodeProgressPercent: null,
      finished: true,
    });
  });

  it('does not let control frames erase the latest registry snapshot', () => {
    useLiveProgressStore.getState().applyMessage({
      prompt_id: 'p1', value: 1, max: 2,
      nodes_total: 2, nodes_done: 0, node_name: 'Sampler',
    });
    useLiveProgressStore.getState().applyMessage({
      type: 'hello_ack', interval_ms: 200,
    });

    expect(useLiveProgressStore.getState().snapshot?.promptId).toBe('p1');
  });

  it('guards invalid fractions and clamps inconsistent backend counts', () => {
    expect(inFlightNodeFraction(1, 0)).toBeNull();
    expect(inFlightNodeFraction(Number.NaN, 10)).toBeNull();
    expect(parseLiveProgressSnapshot({
      prompt_id: 'p1',
      value: 1,
      max: 0,
      nodes_total: 2,
      nodes_done: 7,
      node_name: 'Node',
    })).toMatchObject({
      nodesDone: 2,
      nodeProgressPercent: null,
      overallProgressPercent: 99,
    });
  });
});

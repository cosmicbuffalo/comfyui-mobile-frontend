import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '@/api/types';
import { useOverallProgress } from '@/hooks/useOverallProgress';

function makeWorkflow(): Workflow {
  return {
    last_node_id: 1,
    last_link_id: 0,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    version: 1,
  };
}

// Stable reference — in the real tabline this is a Zustand store value whose
// identity doesn't change per render. A fresh {} each render would cause extra
// effect re-runs that incidentally reschedule the ticker and mask the bug.
const STABLE_STATS: Record<string, { avgMs: number; count: number }> = {};

function Probe(props: {
  workflow: Workflow | null;
  runKey: string | null;
  isRunning: boolean;
  holdCompleteWhileIdle?: boolean;
}) {
  const value = useOverallProgress({ ...props, workflowDurationStats: STABLE_STATS });
  return <output data-progress={value === null ? 'null' : String(value)} />;
}

describe('useOverallProgress completion hold', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  const getProgress = (): number | null => {
    const value = container.querySelector('output')?.getAttribute('data-progress');
    return value === 'null' || value == null ? null : Number(value);
  };

  it('returns to null after the completion hold instead of sticking at 100', async () => {
    const wf = makeWorkflow();

    // Running: progress should be a number (not null).
    await act(async () => {
      root.render(<Probe workflow={wf} runKey="p1" isRunning={true} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(getProgress()).not.toBeNull();

    // Finish: runKey clears and isRunning goes false in the same render.
    await act(async () => {
      root.render(<Probe workflow={wf} runKey={null} isRunning={false} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    // Briefly holds at 100 to animate completion.
    expect(getProgress()).toBe(100);

    // After the 250ms hold (+ a ticker interval), it MUST clear back to null —
    // before the fix it stuck at 100 forever (phantom progress ring on the tab).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(getProgress()).toBeNull();
  });

  it('holds at 100 between infinite runs and resets when the next run starts', async () => {
    const wf = makeWorkflow();

    await act(async () => {
      root.render(
        <Probe
          workflow={wf}
          runKey="p1"
          isRunning={true}
          holdCompleteWhileIdle={true}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    await act(async () => {
      root.render(
        <Probe
          workflow={wf}
          runKey={null}
          isRunning={false}
          holdCompleteWhileIdle={true}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(getProgress()).toBe(100);

    await act(async () => {
      root.render(
        <Probe
          workflow={wf}
          runKey="p2"
          isRunning={true}
          holdCompleteWhileIdle={true}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(getProgress()).toBe(0);
  });

  it('clears an infinite completion hold when infinite mode is disabled', async () => {
    const wf = makeWorkflow();

    await act(async () => {
      root.render(
        <Probe
          workflow={wf}
          runKey="p1"
          isRunning={true}
          holdCompleteWhileIdle={true}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    await act(async () => {
      root.render(
        <Probe
          workflow={wf}
          runKey={null}
          isRunning={false}
          holdCompleteWhileIdle={true}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    await act(async () => {
      root.render(
        <Probe
          workflow={wf}
          runKey={null}
          isRunning={false}
          holdCompleteWhileIdle={false}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(getProgress()).toBeNull();
  });
});

import { useEffect, useRef, useState } from 'react';
import type { Workflow } from '@/api/types';
import { getWorkflowSignature } from '@/hooks/useWorkflow';

interface OverallProgressInput {
  workflow: Workflow | null;
  runKey: string | null;
  isRunning: boolean;
  workflowDurationStats: Record<string, { avgMs: number; count: number }>;
  holdCompleteWhileIdle?: boolean;
}

export function useOverallProgress({
  workflow,
  runKey,
  isRunning,
  workflowDurationStats,
  holdCompleteWhileIdle = false,
}: OverallProgressInput): number | null {
  const [percent, setPercent] = useState<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const lastRunKeyRef = useRef<string | null>(null);
  const holdUntilRef = useRef<number | null>(null);
  const pendingRunKeyRef = useRef<string | null>(null);
  const queuedRunKeyRef = useRef<string | null>(null);
  const lastPercentRef = useRef(0);
  const lastEmittedRef = useRef<number | null>(null);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const update = () => {
      if (!workflow) {
        if (lastEmittedRef.current !== null) {
          lastEmittedRef.current = null;
          setPercent(null);
        }
        holdUntilRef.current = null;
        pendingRunKeyRef.current = null;
        queuedRunKeyRef.current = null;
        startTimeRef.current = null;
        lastPercentRef.current = 0;
        lastRunKeyRef.current = null;
        return;
      }

      const holdMs = 250;
      const currentTime = Date.now();
      let nextValue: number | null = null;

      if (!runKey) {
        if (lastRunKeyRef.current) {
          holdUntilRef.current = holdCompleteWhileIdle ? null : currentTime + holdMs;
          lastRunKeyRef.current = null;
          lastPercentRef.current = 100;
          nextValue = 100;
        } else if (holdCompleteWhileIdle && lastPercentRef.current === 100) {
          nextValue = 100;
        } else if (holdUntilRef.current && currentTime < holdUntilRef.current) {
          nextValue = 100;
        } else {
          holdUntilRef.current = null;
          pendingRunKeyRef.current = null;
          queuedRunKeyRef.current = null;
          startTimeRef.current = null;
          lastPercentRef.current = 0;
          nextValue = null;
          // The completion "hold at 100%" has expired and we're fully idle now.
          // Stop the ticker we started to run the hold down (no dep change will
          // re-run this effect to clean it up otherwise).
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      } else if (holdUntilRef.current && currentTime < holdUntilRef.current) {
        pendingRunKeyRef.current = runKey;
        nextValue = 100;
      } else {
        if (pendingRunKeyRef.current && currentTime >= (holdUntilRef.current ?? 0)) {
          lastRunKeyRef.current = pendingRunKeyRef.current;
          pendingRunKeyRef.current = null;
          startTimeRef.current = currentTime - holdMs;
          lastPercentRef.current = 0;
          holdUntilRef.current = null;
        }

        if (lastRunKeyRef.current && runKey !== lastRunKeyRef.current) {
          if (queuedRunKeyRef.current !== runKey) {
            queuedRunKeyRef.current = runKey;
            holdUntilRef.current = currentTime + holdMs;
            lastPercentRef.current = 100;
          }
          nextValue = 100;
        } else {
          if (lastRunKeyRef.current !== runKey) {
            startTimeRef.current = currentTime;
            lastRunKeyRef.current = runKey;
            lastPercentRef.current = 0;
            holdUntilRef.current = null;
          }

          const elapsedMs = Math.max(0, currentTime - (startTimeRef.current ?? currentTime));
          const signature = getWorkflowSignature(workflow);
          const estimateMs = workflowDurationStats[signature]?.avgMs ?? null;

          let computedPercent: number;
          if (!estimateMs) {
            const elapsedSeconds = elapsedMs / 1000;
            if (elapsedSeconds <= 50) {
              computedPercent = elapsedSeconds;
            } else {
              computedPercent = 50 + (elapsedSeconds - 50) * 0.5;
            }
            computedPercent = Math.min(90, computedPercent);
          } else {
            const raw = (elapsedMs / estimateMs) * 100;
            computedPercent = Math.min(99, Math.max(0, raw));
          }

          const next = Math.max(lastPercentRef.current, computedPercent);
          lastPercentRef.current = next;
          nextValue = Math.round(next);
        }
      }

      if (lastEmittedRef.current !== nextValue) {
        lastEmittedRef.current = nextValue;
        setPercent(nextValue);
      }
    };

    if (workflow) {
      timeoutId = setTimeout(update, 0);
      // Also run the ticker when a run has JUST finished (runKey is now null but
      // lastRunKeyRef is still set, i.e. the hold is about to begin). Without
      // this, the final completion schedules no ticker, the 250ms hold never
      // expires, and `percent` sticks at 100 forever (a phantom progress ring).
      if (isRunning || holdUntilRef.current || runKey || lastRunKeyRef.current) {
        intervalId = setInterval(update, 200);
      }
    } else {
      timeoutId = setTimeout(update, 0);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [workflow, runKey, isRunning, workflowDurationStats, holdCompleteWhileIdle]);

  return percent;
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import type { ScopeFrame } from '@/hooks/useWorkflow';

export function workflowPanelScrollKey(
  scopeStack: ScopeFrame[],
): string {
  const currentScope = scopeStack.at(-1);
  return currentScope?.type === 'subgraph'
    ? `subgraph:${currentScope.id}`
    : 'root';
}

/**
 * Persists the workflow list's scroll positions in its loaded tab session.
 * Subgraph positions are keyed by definition/type rather than placeholder
 * instance, so every instance of the same subgraph shares its last position.
 */
export function useWorkflowPanelScrollMemory<T extends HTMLElement>(
  scrollContainerRef: RefObject<T | null>,
  activeSessionId: string | null,
  scopeStack: ScopeFrame[],
) {
  const scrollKey = useMemo(
    () => workflowPanelScrollKey(scopeStack),
    [scopeStack],
  );
  const viewKey = useMemo(
    () => JSON.stringify([activeSessionId, scrollKey]),
    [activeSessionId, scrollKey],
  );
  const restoredKeyRef = useRef<string | null>(null);
  const restoringKeyRef = useRef<string | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const retryRef = useRef<{
    key: string;
    target: number;
    deadline: number;
    lastSet: number;
  } | null>(null);

  const handleScroll = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element || activeSessionId === null) return;
    if (restoredKeyRef.current !== viewKey) return;
    if (restoringKeyRef.current === viewKey) return;

    const state = useWorkflowStore.getState();
    // A scroll event from the reused DOM node can arrive just after a tab
    // switch. Never let that stale event overwrite the incoming tab's state.
    if (
      state.activeSessionId !== activeSessionId ||
      workflowPanelScrollKey(state.scopeStack) !== scrollKey
    ) {
      return;
    }
    const scrollTop = Math.max(0, element.scrollTop);
    const scrollTops = state.workflowPanelScrollTops ?? {};
    if (scrollTops[scrollKey] === scrollTop) return;
    useWorkflowStore.setState({
      workflowPanelScrollTops: {
        ...scrollTops,
        [scrollKey]: scrollTop,
      },
    });
  }, [activeSessionId, scrollContainerRef, scrollKey, viewKey]);

  // Run after every commit so a list container that was absent for an empty or
  // loading workflow still restores when it later mounts. The key guard makes
  // ordinary workflow renders a no-op.
  useLayoutEffect(() => {
    const element = scrollContainerRef.current;
    if (!element || restoredKeyRef.current === viewKey) return;

    if (restoreFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFrameRef.current);
    }
    const state = useWorkflowStore.getState();
    const scrollTop =
      state.activeSessionId === activeSessionId
        ? (state.workflowPanelScrollTops?.[scrollKey] ?? 0)
        : 0;
    restoredKeyRef.current = viewKey;
    restoringKeyRef.current = viewKey;
    element.scrollTop = scrollTop;
    // The browser clamps the write while the list is shorter than the stored
    // offset — cards still measuring, media not yet sized. A one-shot restore
    // then silently landed at the top and the next scroll event overwrote the
    // stored position with the clamped one. Re-apply for a short window as
    // the content grows, stopping as soon as it sticks, the window closes, or
    // someone scrolls underneath the retry (their position wins).
    retryRef.current =
      Math.abs(element.scrollTop - scrollTop) > 1
        ? {
            key: viewKey,
            target: scrollTop,
            deadline: Date.now() + 2000,
            lastSet: element.scrollTop,
          }
        : null;
    const step = () => {
      restoreFrameRef.current = null;
      const retry = retryRef.current;
      const el = scrollContainerRef.current;
      if (!retry || retry.key !== viewKey || !el) {
        if (restoringKeyRef.current === viewKey) restoringKeyRef.current = null;
        return;
      }
      if (Math.abs(el.scrollTop - retry.lastSet) > 1) {
        retryRef.current = null;
        if (restoringKeyRef.current === viewKey) restoringKeyRef.current = null;
        return;
      }
      el.scrollTop = retry.target;
      retry.lastSet = el.scrollTop;
      if (Math.abs(el.scrollTop - retry.target) <= 1 || Date.now() > retry.deadline) {
        retryRef.current = null;
        if (restoringKeyRef.current === viewKey) restoringKeyRef.current = null;
        return;
      }
      restoreFrameRef.current = window.requestAnimationFrame(step);
    };
    restoreFrameRef.current = window.requestAnimationFrame(step);
  });

  useEffect(
    () => () => {
      if (restoreFrameRef.current !== null) {
        window.cancelAnimationFrame(restoreFrameRef.current);
      }
    },
    [],
  );

  return handleScroll;
}

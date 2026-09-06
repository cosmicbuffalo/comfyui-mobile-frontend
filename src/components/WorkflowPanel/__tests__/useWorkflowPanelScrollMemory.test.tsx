import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import type { ScopeFrame } from '@/hooks/useWorkflow';
import {
  useWorkflowPanelScrollMemory,
  workflowPanelScrollKey,
} from '@/components/WorkflowPanel/useWorkflowPanelScrollMemory';

function Harness({
  activeSessionId,
  scopeStack,
}: {
  activeSessionId: string;
  scopeStack: ScopeFrame[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const handleScroll = useWorkflowPanelScrollMemory(
    scrollRef,
    activeSessionId,
    scopeStack,
  );
  return <div data-testid="scroll-container" ref={scrollRef} onScroll={handleScroll} />;
}

describe('useWorkflowPanelScrollMemory', () => {
  let container: HTMLDivElement;
  let root: Root;
  let animationFrames: Map<number, FrameRequestCallback>;
  let nextAnimationFrameId: number;

  const rootScope: ScopeFrame[] = [{ type: 'root' }];
  const nestedScope: ScopeFrame[] = [
    { type: 'root' },
    { type: 'subgraph', id: 'outer', placeholderNodeId: 10 },
    { type: 'subgraph', id: 'inner', placeholderNodeId: 20 },
  ];

  beforeEach(() => {
    animationFrames = new Map();
    nextAnimationFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      animationFrames.delete(id);
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useWorkflowStore.setState({
      activeSessionId: 'workflow-session',
      workflowPanelScrollTops: {},
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const flushAnimationFrames = () => {
    act(() => {
      const callbacks = [...animationFrames.values()];
      animationFrames.clear();
      callbacks.forEach((callback) => callback(0));
    });
  };

  const renderScope = (
    scopeStack: ScopeFrame[],
    activeSessionId = 'workflow-session',
  ) => {
    act(() => {
      useWorkflowStore.setState({ activeSessionId, scopeStack });
      root.render(
        <Harness
          activeSessionId={activeSessionId}
          scopeStack={scopeStack}
        />,
      );
    });
    return container.querySelector<HTMLDivElement>('[data-testid="scroll-container"]')!;
  };

  const userScrollTo = (element: HTMLDivElement, top: number) => {
    act(() => {
      element.scrollTop = top;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
  };

  it('restores root without letting nested subgraph scrolling overwrite it', () => {
    let scrollContainer = renderScope(rootScope);
    flushAnimationFrames();
    userScrollTo(scrollContainer, 420);

    scrollContainer = renderScope(nestedScope);
    expect(scrollContainer.scrollTop).toBe(0);
    flushAnimationFrames();
    userScrollTo(scrollContainer, 135);

    scrollContainer = renderScope(rootScope);
    expect(scrollContainer.scrollTop).toBe(420);
    flushAnimationFrames();

    scrollContainer = renderScope(nestedScope);
    expect(scrollContainer.scrollTop).toBe(135);
  });

  it('shares a position between instances of the same subgraph type', () => {
    const firstInstance: ScopeFrame[] = [
      { type: 'root' },
      { type: 'subgraph', id: 'shared-type', placeholderNodeId: 10 },
    ];
    const secondInstance: ScopeFrame[] = [
      { type: 'root' },
      { type: 'subgraph', id: 'shared-type', placeholderNodeId: 99 },
    ];
    expect(workflowPanelScrollKey(firstInstance)).toBe(
      workflowPanelScrollKey(secondInstance),
    );

    let scrollContainer = renderScope(firstInstance);
    flushAnimationFrames();
    userScrollTo(scrollContainer, 215);

    scrollContainer = renderScope(rootScope);
    expect(scrollContainer.scrollTop).toBe(0);
    flushAnimationFrames();

    scrollContainer = renderScope(secondInstance);
    expect(scrollContainer.scrollTop).toBe(215);
  });

  it('restores the persisted position after the panel remounts', () => {
    let scrollContainer = renderScope(nestedScope);
    flushAnimationFrames();
    userScrollTo(scrollContainer, 333);

    act(() => root.unmount());
    root = createRoot(container);
    scrollContainer = renderScope(nestedScope);

    expect(scrollContainer.scrollTop).toBe(333);
  });

  it('keeps identical scope keys isolated between loaded workflow tabs', () => {
    act(() => {
      useWorkflowStore.setState({
        activeSessionId: 'session-a',
        workflowPanelScrollTops: {},
      });
    });
    let scrollContainer = renderScope(rootScope, 'session-a');
    flushAnimationFrames();
    userScrollTo(scrollContainer, 420);
    const sessionAPositions = {
      ...useWorkflowStore.getState().workflowPanelScrollTops,
    };

    act(() => {
      useWorkflowStore.setState({
        activeSessionId: 'session-b',
        workflowPanelScrollTops: {},
      });
    });
    scrollContainer = renderScope(rootScope, 'session-b');
    expect(scrollContainer.scrollTop).toBe(0);
    flushAnimationFrames();
    userScrollTo(scrollContainer, 75);
    const sessionBPositions = {
      ...useWorkflowStore.getState().workflowPanelScrollTops,
    };

    act(() => {
      useWorkflowStore.setState({
        activeSessionId: 'session-a',
        workflowPanelScrollTops: sessionAPositions,
      });
    });
    scrollContainer = renderScope(rootScope, 'session-a');
    expect(scrollContainer.scrollTop).toBe(420);

    act(() => {
      useWorkflowStore.setState({
        activeSessionId: 'session-b',
        workflowPanelScrollTops: sessionBPositions,
      });
    });
    scrollContainer = renderScope(rootScope, 'session-b');
    expect(scrollContainer.scrollTop).toBe(75);
  });
});

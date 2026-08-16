import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore } from '../useWorkflow';

const nodeKey = makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null });

const workflow: Workflow = {
  last_node_id: 1,
  last_link_id: 0,
  nodes: [{
    id: 1,
    itemKey: nodeKey,
    type: 'Any',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
  }],
  links: [],
  groups: [],
  config: {},
  version: 1,
};

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    right: 100,
    bottom: top + height,
    left: 0,
    width: 100,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function mountScrollFixture(anchorTop: number, scrollHeight: number, clientHeight: number) {
  const container = document.createElement('div');
  container.dataset.nodeList = 'true';
  const anchor = document.createElement('div');
  anchor.id = 'node-anchor-1';
  const card = document.createElement('div');
  card.id = 'node-card-1';
  container.append(anchor, card);
  document.body.appendChild(container);

  Object.defineProperty(container, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: clientHeight });
  Object.defineProperty(container, 'scrollTop', { configurable: true, writable: true, value: 0 });
  container.getBoundingClientRect = () => rect(0, clientHeight);
  anchor.getBoundingClientRect = () => rect(anchorTop, 1);
  card.getBoundingClientRect = () => rect(anchorTop, 100);
  const scrollTo = vi.fn();
  container.scrollTo = scrollTo;

  return { container, card, scrollTo };
}

describe('scrollToNode arrival behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    useWorkflowStore.setState({
      workflow,
      hiddenItems: {},
      collapsedItems: {},
      mobileLayout: createEmptyMobileLayout(),
      itemKeyByPointer: { [nodeKey]: nodeKey },
      pointerByHierarchicalKey: { [nodeKey]: nodeKey },
    });
  });

  afterEach(() => {
    document.querySelector('[data-node-list="true"]')?.remove();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits for stable layout and flashes immediately when already at the destination', () => {
    const { card, scrollTo } = mountScrollFixture(0, 400, 200);

    useWorkflowStore.getState().scrollToNode(nodeKey);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(card.classList.contains('highlight-pulse')).toBe(true);
  });

  it('does not issue corrective scrolls when the container is already at its end', () => {
    const { card, scrollTo } = mountScrollFixture(50, 100, 100);

    useWorkflowStore.getState().scrollToNode(nodeKey);
    vi.advanceTimersByTime(250);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(card.classList.contains('highlight-pulse')).toBe(true);
  });
});

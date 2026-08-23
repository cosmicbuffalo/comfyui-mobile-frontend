import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '@/api/types';
import { usePinnedWidgetStore, type PinnedWidget } from '@/hooks/usePinnedWidget';
import { useWidgetModalOpenStore } from '@/hooks/useWidgetModalOpen';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { WidgetControl } from '@/components/InputControls/WidgetControl';
import { FollowQueueButton } from '../FollowQueueButton';
import { PinnedWidgetButton } from '../PinnedWidgetButton';
import { PinnedWidgetOverlayModal } from '../PinnedWidgetOverlayModal';

const options = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
const pin: PinnedWidget = {
  nodeId: 7,
  widgetIndex: 0,
  widgetName: 'model',
  widgetType: 'COMBO',
  options,
};
const workflow: Workflow = {
  last_node_id: 7,
  last_link_id: 0,
  nodes: [{
    id: 7,
    itemKey: 'node:7',
    type: 'CheckpointLoaderSimple',
    pos: [0, 0],
    size: [320, 180],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: ['alpha'],
  }],
  links: [],
  groups: [],
  config: {},
  version: 0.4,
};

describe('pinned widget editor state', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(pointer: coarse)',
      addEventListener: () => {},
      removeEventListener: () => {},
    })));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useWorkflowStore.setState({ workflow });
    usePinnedWidgetStore.setState({
      pinnedWidgets: {},
      pinnedWidget: pin,
      pinOverlayOpen: false,
    });
    useWidgetModalOpenStore.setState({ openCount: 0 });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    usePinnedWidgetStore.setState({
      pinnedWidgets: {},
      pinnedWidget: null,
      pinOverlayOpen: false,
    });
    useWidgetModalOpenStore.setState({ openCount: 0 });
    vi.unstubAllGlobals();
  });

  it('routes a direct tap on the pinned workflow control through the shared overlay', async () => {
    await act(async () => {
      root.render(
        <>
          <WidgetControl
            name="model"
            type="COMBO"
            value="alpha"
            options={options}
            onChange={() => {}}
            isPinned
            onTogglePin={() => {}}
          />
          <PinnedWidgetButton />
          <PinnedWidgetOverlayModal />
        </>,
      );
    });

    await act(async () => {
      container.querySelector<HTMLElement>('.combo-control-trigger')?.click();
    });

    expect(usePinnedWidgetStore.getState().pinOverlayOpen).toBe(true);
    expect(container.querySelector('[aria-label="Close pin editor"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Close pin editor"]')?.className)
      .toContain('bg-fuchsia-500');
    expect(document.body.querySelectorAll('.fullscreen-widget-modal')).toHaveLength(1);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Close pin editor"]')?.click();
    });

    expect(usePinnedWidgetStore.getState().pinOverlayOpen).toBe(false);
    expect(document.body.querySelectorAll('.fullscreen-widget-modal')).toHaveLength(0);
  });

  it('closes the pinned editor before opening Follow Queue', async () => {
    const onOpenFollowQueue = vi.fn();
    usePinnedWidgetStore.setState({ pinOverlayOpen: true });

    await act(async () => {
      root.render(
        <>
          <FollowQueueButton
            viewerOpen={false}
            followQueue={false}
            queueSize={0}
            overallProgress={null}
            onOpenFollowQueue={onOpenFollowQueue}
          />
          <PinnedWidgetOverlayModal />
        </>,
      );
    });
    expect(document.body.querySelectorAll('.fullscreen-widget-modal')).toHaveLength(1);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Open image viewer"]')?.click();
    });

    expect(usePinnedWidgetStore.getState().pinOverlayOpen).toBe(false);
    expect(document.body.querySelectorAll('.fullscreen-widget-modal')).toHaveLength(0);
    expect(onOpenFollowQueue).toHaveBeenCalledTimes(1);
  });

  it('renders a pinned numeric widget in the shared editor', async () => {
    usePinnedWidgetStore.setState({
      pinnedWidget: {
        nodeId: 7,
        widgetIndex: 0,
        widgetName: 'steps',
        widgetType: 'INT',
        options: { min: 1, max: 100, step: 1 },
      },
      pinOverlayOpen: false,
    });
    useWorkflowStore.setState({
      workflow: {
        ...workflow,
        nodes: [{ ...workflow.nodes[0], widgets_values: [20] }],
      },
    });

    await act(async () => {
      root.render(
        <>
          <PinnedWidgetButton />
          <PinnedWidgetOverlayModal />
        </>,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Open pin editor"]')?.click();
    });

    const input = document.body.querySelector<HTMLInputElement>('.number-input-field-steps');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('20');
    expect(document.body.querySelectorAll('.fullscreen-widget-modal')).toHaveLength(1);
  });
});

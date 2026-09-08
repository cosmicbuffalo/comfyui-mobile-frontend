import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useParameterSectionFoldsStore } from '@/hooks/useParameterSectionFolds';
import { useRowMenuStore } from '@/hooks/useRowMenuStore';
import { useSeedStore } from '@/hooks/useSeed';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { NodeCardParameters } from '../Parameters';

/**
 * Where the entries sit in a widget row's menu, and which one is marked
 * destructive.
 *
 * The second section is about where a value lives. Pop out is the only entry in
 * it that an ordinary node can reach, so it leads; the rest only apply inside a
 * subgraph or on a placeholder. Remove input is the only entry anywhere in the
 * menu that discards a value rather than moving it, which is what the colour is
 * for — Unpromote, immediately above it, carries the value home first.
 */
describe('the widget row menu', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    if (!window.matchMedia) {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useParameterSectionFoldsStore.setState({ collapsedItemKeys: [] });
    useSeedStore.setState({ seedModes: {}, seedLastValues: {} });
    // The open menu is remembered by key across mounts, so a menu left open by
    // the previous case would be toggled shut by this one's click.
    useRowMenuStore.setState({ openKey: null });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const renderPlaceholderRow = async () => {
    const node: WorkflowNode = {
      id: 77,
      itemKey: 'node:77',
      type: 'a-subgraph',
      pos: [0, 0],
      size: [400, 200],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [
        { name: 'factor', type: 'INT', widget: { name: 'factor' }, link: null },
        { name: 'prefix', type: 'STRING', widget: { name: 'prefix' }, link: null },
      ],
      outputs: [],
      properties: {},
      widgets_values: [4, 'out'],
    };
    const workflow: Workflow = {
      last_node_id: node.id,
      last_link_id: 0,
      nodes: [node],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    // Pop out is only offered when the matching primitive exists to pop into.
    useWorkflowStore.setState({
      workflow,
      nodeTypes: {
        PrimitiveInt: {
          name: 'PrimitiveInt',
          display_name: 'Int',
          description: '',
          python_module: 'nodes',
          category: 'utils',
          input: { required: { value: ['INT', {}] } },
          output: ['INT'],
        },
      },
      scopeStack: [{ type: 'root' }],
    });

    await act(async () => {
      root.render(
        <NodeCardParameters
          node={node}
          isBypassed={false}
          isKSampler={false}
          workflowExists
          nodeTypesExists
          visibleInputWidgets={[]}
          visibleWidgets={[
            {
              widgetIndex: 0,
              inputIndex: 0,
              name: 'factor',
              inputName: 'factor',
              type: 'INT',
              value: 4,
            },
            {
              widgetIndex: 1,
              inputIndex: 1,
              name: 'prefix',
              inputName: 'prefix',
              type: 'STRING',
              value: 'out',
            },
          ]}
          errorInputNames={new Set()}
          onUpdateNodeWidget={vi.fn()}
          onUpdateNodeWidgets={vi.fn()}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => null}
          findSeedControlWidgetIndex={() => null}
          isPlaceholder
          onRemoveBoundarySlot={vi.fn()}
          onRenameBoundarySlot={vi.fn()}
          setSeedMode={vi.fn()}
          isWidgetPinned={() => false}
          toggleWidgetPin={vi.fn()}
          showFastGroupConfig={false}
          setShowFastGroupConfig={vi.fn()}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>('button.row-actions-button');
    expect(trigger, 'the row has a menu').toBeTruthy();
    await act(async () => trigger!.click());
    return Array.from(
      document.querySelectorAll<HTMLButtonElement>('.row-actions-menu button'),
    );
  };

  it('leads the second section with Pop out widget', async () => {
    const entries = await renderPlaceholderRow();
    const labels = entries.map((button) => button.textContent?.trim());
    const popOut = labels.indexOf('Pop out widget');
    const removeInput = labels.indexOf('Remove input');
    expect(popOut, 'Pop out widget is offered').toBeGreaterThanOrEqual(0);
    expect(removeInput).toBeGreaterThanOrEqual(0);
    // Ahead of every routing entry, not trailing them.
    expect(popOut).toBeLessThan(removeInput);
    const unpromote = labels.indexOf('Unpromote');
    if (unpromote >= 0) expect(popOut).toBeLessThan(unpromote);
  });

  it('marks Remove input as the destructive one, icon included', async () => {
    const entries = await renderPlaceholderRow();
    const remove = entries.find((button) => button.textContent?.trim() === 'Remove input');
    expect(remove, 'Remove input is offered').toBeTruthy();
    expect(remove!.getAttribute('data-tone')).toBe('danger');
    // The icon carries the tone too, rather than staying the default slate.
    expect(remove!.querySelector('[data-tone-icon="danger"]')).toBeTruthy();

    // It is the only entry marked that way: Unpromote above it moves the value
    // rather than dropping it.
    const marked = entries.filter((button) => button.getAttribute('data-tone') === 'danger');
    expect(marked).toHaveLength(1);
  });
});

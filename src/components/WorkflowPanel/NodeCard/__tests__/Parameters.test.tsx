import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useParameterSectionFoldsStore } from '@/hooks/useParameterSectionFolds';
import { useSeedStore } from '@/hooks/useSeed';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { NodeCardParameters } from '../Parameters';

// Only WidgetControl is stubbed; widgetControlHasTopPadding lives in its own
// module and runs for real here, so the spacing assertions below exercise the
// same classifier the component uses.
vi.mock('@/components/InputControls/WidgetControl', () => ({
  WidgetControl: ({
    name,
    compactTrailingControls,
  }: {
    name: string;
    compactTrailingControls?: boolean;
  }) => (
    <div
      data-widget-control={name}
      data-compact-trailing-controls={compactTrailingControls || undefined}
    >
      {name}
    </div>
  ),
}));

describe('NodeCardParameters seed controls', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useParameterSectionFoldsStore.setState({ collapsedItemKeys: [] });
    useSeedStore.setState({ seedModes: {}, seedLastValues: {} });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const renderFirstWidget = async (type: string) => {
    const firstValue = type === 'POWER_LORA_HEADER' ? true : 'value';
    const node: WorkflowNode = {
      id: 21,
      itemKey: 'node:21',
      type: 'TestNode',
      pos: [0, 0],
      size: [320, 200],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [],
      outputs: [],
      properties: {},
      widgets_values: [firstValue],
    };
    await act(async () => {
      root.render(
        <NodeCardParameters
          node={node}
          isBypassed={false}
          isKSampler={false}
          workflowExists={false}
          nodeTypesExists={false}
          visibleInputWidgets={[]}
          visibleWidgets={[{
            widgetIndex: 0,
            name: 'first',
            type,
            value: firstValue,
          }]}
          errorInputNames={new Set()}
          onUpdateNodeWidget={vi.fn()}
          onUpdateNodeWidgets={vi.fn()}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => null}
          setSeedMode={vi.fn()}
          isWidgetPinned={() => false}
          toggleWidgetPin={vi.fn()}
          showFastGroupConfig={false}
          setShowFastGroupConfig={vi.fn()}
        />,
      );
    });
    return container.querySelector('.parameters-section-content');
  };

  it('compensates for the top padding on a standard first parameter', async () => {
    const content = await renderFirstWidget('STRING');
    expect(content?.classList).toContain('-mt-2');
  });

  it('does not pull up a composite first parameter such as Power LoRA', async () => {
    const content = await renderFirstWidget('POWER_LORA_HEADER');
    expect(content?.classList).not.toContain('-mt-2');
  });

  it('renders a proxied control_after_generate only through the specialized seed control', async () => {
    const node: WorkflowNode = {
      id: 911,
      itemKey: 'node:911',
      type: 'backend-subgraph',
      pos: [0, 0],
      size: [580, 1320],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [],
      outputs: [],
      properties: {
        proxyWidgets: [
          ['915', 'seed'],
          ['915', 'control_after_generate'],
        ],
      },
      widgets_values: [],
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
    useWorkflowStore.setState({
      workflow,
      nodeTypes: {},
      scopeStack: [{ type: 'root' }],
    });

    const values = new Map<number, unknown>([
      [10_000, 123],
      [10_001, 'randomize'],
      [10_002, 'fixed'],
    ]);

    await act(async () => {
      root.render(
        <NodeCardParameters
          node={node}
          isBypassed={false}
          isKSampler={false}
          workflowExists
          nodeTypesExists
          visibleInputWidgets={[
            {
              widgetIndex: 10_001,
              name: 'EasySeed: control_after_generate',
              type: 'COMBO',
              value: 'randomize',
            },
            {
              widgetIndex: 10_002,
              name: 'OtherSeed: control_after_generate',
              type: 'COMBO',
              value: 'fixed',
            },
          ]}
          visibleWidgets={[
            {
              widgetIndex: 10_000,
              name: 'EasySeed: seed',
              type: 'INT',
              value: 123,
            },
          ]}
          errorInputNames={new Set()}
          onUpdateNodeWidget={vi.fn()}
          onUpdateNodeWidgets={vi.fn()}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => 10_000}
          findSeedControlWidgetIndex={() => 10_001}
          isPlaceholder
          setSeedMode={vi.fn()}
          isWidgetPinned={() => false}
          toggleWidgetPin={vi.fn()}
          resolveWidgetValue={(index) => values.get(index)}
          showFastGroupConfig={false}
          setShowFastGroupConfig={vi.fn()}
        />,
      );
    });

    const renderedNames = Array.from(
      container.querySelectorAll<HTMLElement>('[data-widget-control]'),
      (element) => element.dataset.widgetControl,
    );
    // The promoted seed is consumed by the specialized block (as a
    // NumberControl, checked below) rather than repeated in the generic list.
    expect(renderedNames).toEqual([
      '种子控制',
      'OtherSeed: control_after_generate',
    ]);

    // The seed value renders immediately above the control that steps it.
    const seedValue = container.querySelector('.number-control-seed');
    const seedControl = container.querySelector('[data-widget-control="种子控制"]');
    expect(seedValue).not.toBeNull();
    expect(seedControl).not.toBeNull();
    expect(
      seedValue!.compareDocumentPosition(seedControl!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      container.querySelector('[data-widget-control="种子控制"]')
        ?.getAttribute('data-compact-trailing-controls'),
    ).toBe('true');
  });

  it('keeps control_after_generate in the generic list when the seed input is linked', async () => {
    // The specialized seed block bails out entirely once seed comes from a
    // link, so the generic list is the only thing left that can render the
    // control widget.
    const node: WorkflowNode = {
      id: 912,
      itemKey: 'node:912',
      type: 'EasySeed',
      pos: [0, 0],
      size: [320, 200],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [{ name: 'seed', type: 'INT', link: 7 }],
      outputs: [],
      properties: {},
      widgets_values: [123, 'randomize'],
    };
    const workflow: Workflow = {
      last_node_id: node.id,
      last_link_id: 7,
      nodes: [node],
      links: [],
      groups: [],
      config: {},
      version: 1,
    };
    useWorkflowStore.setState({
      workflow,
      nodeTypes: {},
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
            { widgetIndex: 0, name: 'seed', type: 'INT', value: 123 },
            {
              widgetIndex: 1,
              name: 'control_after_generate',
              type: 'COMBO',
              value: 'randomize',
            },
          ]}
          errorInputNames={new Set()}
          onUpdateNodeWidget={vi.fn()}
          onUpdateNodeWidgets={vi.fn()}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => 0}
          setSeedMode={vi.fn()}
          isWidgetPinned={() => false}
          toggleWidgetPin={vi.fn()}
          showFastGroupConfig={false}
          setShowFastGroupConfig={vi.fn()}
        />,
      );
    });

    const renderedNames = Array.from(
      container.querySelectorAll<HTMLElement>('[data-widget-control]'),
      (element) => element.dataset.widgetControl,
    );
    expect(renderedNames).toContain('control_after_generate');
  });
});

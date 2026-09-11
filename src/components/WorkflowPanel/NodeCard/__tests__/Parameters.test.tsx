import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useParameterSectionFoldsStore } from '@/hooks/useParameterSectionFolds';
import { useSeedStore } from '@/hooks/useSeed';
import { useRowMenuStore } from '@/hooks/useRowMenuStore';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { NodeCardParameters } from '../Parameters';

// Only WidgetControl is stubbed; widgetControlHasTopPadding lives in its own
// module and runs for real here, so the spacing assertions below exercise the
// same classifier the component uses.
vi.mock('@/components/InputControls/WidgetControl', () => ({
  WidgetControl: ({
    name,
    value,
    compactTrailingControls,
    isPromoted,
  }: {
    name: string;
    value?: unknown;
    compactTrailingControls?: boolean;
    isPromoted?: boolean;
  }) => (
    <div
      data-widget-control={name}
      data-widget-value={String(value ?? '')}
      data-compact-trailing-controls={compactTrailingControls || undefined}
      data-promoted={isPromoted || undefined}
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

  it('reserves bottom clearance for the last parameter focus ring', async () => {
    const content = await renderFirstWidget('STRING');
    expect(content?.classList).toContain('pb-1');
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
      'Seed control',
      'OtherSeed: control_after_generate',
    ]);

    // The seed value renders immediately above the control that steps it.
    const seedValue = container.querySelector('.number-control-seed');
    const seedControl = container.querySelector('[data-widget-control="Seed control"]');
    expect(seedValue).not.toBeNull();
    expect(seedControl).not.toBeNull();
    expect(
      seedValue!.compareDocumentPosition(seedControl!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      container.querySelector('[data-widget-control="Seed control"]')
        ?.getAttribute('data-compact-trailing-controls'),
    ).toBe('true');
  });

  it('renders a relabelled promoted seed once under its edited label', async () => {
    const node: WorkflowNode = {
      id: 1774,
      itemKey: 'node:1774',
      type: 'subgraph-placeholder',
      pos: [0, 0],
      size: [320, 200],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [{
        name: 'seed',
        label: 'interpolation_seed',
        type: 'INT',
        widget: { name: 'seed' },
        link: null,
      }],
      outputs: [],
      properties: {},
      widgets_values: [1120826007],
    };
    useWorkflowStore.setState({
      workflow: {
        last_node_id: node.id,
        last_link_id: 0,
        nodes: [node],
        links: [],
        groups: [],
        config: {},
        version: 1,
      },
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
          visibleWidgets={[{
            widgetIndex: 0,
            name: 'interpolation_seed',
            inputName: 'seed',
            inputIndex: 0,
            type: 'INT',
            value: 1120826007,
          }]}
          errorInputNames={new Set()}
          onUpdateNodeWidget={vi.fn()}
          onUpdateNodeWidgets={vi.fn()}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => 0}
          findSeedControlWidgetIndex={() => null}
          isPlaceholder
          setSeedMode={vi.fn()}
          isWidgetPinned={() => false}
          toggleWidgetPin={vi.fn()}
          showFastGroupConfig={false}
          setShowFastGroupConfig={vi.fn()}
          onRenameBoundarySlot={vi.fn()}
        />,
      );
    });

    expect(container.querySelectorAll('.number-control-interpolation_seed')).toHaveLength(1);
    expect(container.querySelector('.number-control-seed')).toBeNull();
    expect(container.textContent).toContain('interpolation_seed');
    expect(container.textContent).not.toContain('interpolation_seed ⇢ seed');
  });

  it('draws no inner-widget mapping on a placeholder card', async () => {
    // From outside the scope, which inner widget a boundary slot drives is
    // the subgraph's business — the card shows only the slot's own label.
    // (The Krea-2 template's slot is auto-uniqued to `seed_1` but labelled
    // `seed`, driving an inner `seed`; it used to read "seed ⇢ seed".)
    const node: WorkflowNode = {
      id: 30,
      itemKey: 'node:30',
      type: 'subgraph-placeholder',
      pos: [0, 0],
      size: [320, 200],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [{
        name: 'seed_1',
        label: 'seed',
        type: 'INT',
        widget: { name: 'seed_1' },
        link: null,
      }],
      outputs: [],
      properties: {},
      widgets_values: [594361197674106],
    };
    useWorkflowStore.setState({
      workflow: {
        last_node_id: node.id,
        last_link_id: 0,
        nodes: [node],
        links: [],
        groups: [],
        config: {},
        version: 1,
      },
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
          visibleWidgets={[{
            widgetIndex: 0,
            name: 'seed',
            inputName: 'seed_1',
            inputIndex: 0,
            type: 'INT',
            value: 594361197674106,
          }]}
          errorInputNames={new Set()}
          onUpdateNodeWidget={vi.fn()}
          onUpdateNodeWidgets={vi.fn()}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => 0}
          findSeedControlWidgetIndex={() => null}
          isPlaceholder
          setSeedMode={vi.fn()}
          isWidgetPinned={() => false}
          toggleWidgetPin={vi.fn()}
          showFastGroupConfig={false}
          setShowFastGroupConfig={vi.fn()}
          boundaryTargetNames={{ 0: ['seed'] }}
          onRenameBoundarySlot={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('seed');
    expect(container.textContent).not.toContain('⇢');

    // The mapping is still checkable without entering the scope: the row's
    // "…" menu names the inner widget beside the row name on its first line.
    const trigger = container.querySelector<HTMLButtonElement>('button.row-actions-button');
    expect(trigger).not.toBeNull();
    await act(async () => trigger!.click());
    const menu = document.querySelector('.row-actions-menu');
    expect(menu?.querySelector('.row-actions-mapping')?.textContent).toBe('⇢ seed');
    expect(menu?.querySelector('.row-actions-type')?.textContent).toBe('INT');
  });

  it('enters the instance scope and jumps to the mapped inner widget from the menu heading', async () => {
    useRowMenuStore.setState({ openKey: null });
    const jumpToWorkflowItem = vi.fn();
    const enterSubgraph = vi.fn();
    const innerNode = {
      id: 3,
      itemKey: 'root/subgraph:subgraph-placeholder/node:3',
      type: 'TestSeeded',
      pos: [0, 0],
      size: [200, 100],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [{ name: 'seed', type: 'INT', widget: { name: 'seed' }, link: 207 }],
      outputs: [],
      properties: {},
      widgets_values: [594361197674106],
    };
    const node: WorkflowNode = {
      id: 30,
      itemKey: 'node:30',
      type: 'subgraph-placeholder',
      pos: [0, 0],
      size: [320, 200],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [{
        name: 'seed_1',
        label: 'seed',
        type: 'INT',
        widget: { name: 'seed_1' },
        link: null,
      }],
      outputs: [],
      properties: {},
      widgets_values: [594361197674106],
    };
    useWorkflowStore.setState({
      workflow: {
        last_node_id: node.id,
        last_link_id: 207,
        nodes: [node],
        links: [],
        groups: [],
        config: {},
        version: 1,
        definitions: {
          subgraphs: [{
            id: 'subgraph-placeholder',
            name: 'SG',
            nodes: [innerNode],
            links: [{ id: 207, origin_id: -10, origin_slot: 0, target_id: 3, target_slot: 0, type: 'INT' }],
            inputs: [{ name: 'seed_1', type: 'INT', linkIds: [207] }],
            outputs: [],
          }],
        },
      } as unknown as Workflow,
      nodeTypes: {
        TestSeeded: {
          input: { required: { seed: ['INT', { default: 0 }] }, optional: {} },
          input_order: { required: ['seed'], optional: [] },
          output: [],
          output_name: [],
          name: 'TestSeeded',
          display_name: 'TestSeeded',
          description: '',
          python_module: '',
          category: 'test',
        },
      } as never,
      scopeStack: [{ type: 'root' }],
      jumpToWorkflowItem,
      enterSubgraph,
    } as never);

    await act(async () => {
      root.render(
        <NodeCardParameters
          node={node}
          isBypassed={false}
          isKSampler={false}
          workflowExists
          nodeTypesExists
          visibleInputWidgets={[]}
          visibleWidgets={[{
            widgetIndex: 0,
            name: 'seed',
            inputName: 'seed_1',
            inputIndex: 0,
            type: 'INT',
            value: 594361197674106,
          }]}
          errorInputNames={new Set()}
          onUpdateNodeWidget={vi.fn()}
          onUpdateNodeWidgets={vi.fn()}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => 0}
          findSeedControlWidgetIndex={() => null}
          isPlaceholder
          setSeedMode={vi.fn()}
          isWidgetPinned={() => false}
          toggleWidgetPin={vi.fn()}
          showFastGroupConfig={false}
          setShowFastGroupConfig={vi.fn()}
          boundaryTargetNames={{ 0: ['seed'] }}
          onRenameBoundarySlot={vi.fn()}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>('button.row-actions-button');
    await act(async () => trigger!.click());
    const heading = document.querySelector<HTMLButtonElement>('.row-actions-heading-jump');
    expect(heading).not.toBeNull();
    // textContent joins the name and the ml-1-spaced annotation without a gap.
    expect(heading!.textContent).toBe('seed⇢ seed');

    await act(async () => heading!.click());

    // THIS instance's scope, then the inner widget's own row.
    expect(enterSubgraph).toHaveBeenCalledWith(30);
    expect(jumpToWorkflowItem).toHaveBeenCalledWith({
      kind: 'widget',
      itemKey: 'root/subgraph:subgraph-placeholder/node:3',
      nodeId: 3,
      domId: 'widget-row-3-0',
    });
  });

  it('keeps the instance seed controls on an inner node after widget promotion', async () => {
    const setSeedMode = vi.fn();
    const node: WorkflowNode = {
      id: 1836,
      itemKey: 'root/subgraph:video/node:1836',
      type: 'GIMMVFI_interpolate',
      pos: [0, 0],
      size: [320, 200],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [{ name: 'seed', type: 'INT', widget: { name: 'seed' }, link: 1397 }],
      outputs: [],
      properties: {},
      widgets_values: [1120826007, 'randomize'],
    };
    useSeedStore.setState({ seedModes: { 1774: 'increment' }, seedLastValues: {} });

    await act(async () => {
      root.render(
        <NodeCardParameters
          node={node}
          isBypassed={false}
          isKSampler={false}
          workflowExists
          nodeTypesExists
          visibleInputWidgets={[]}
          visibleWidgets={[{
            widgetIndex: 0,
            name: 'seed',
            inputName: 'seed',
            inputIndex: 0,
            type: 'INT',
            value: 777,
            connected: true,
          }]}
          errorInputNames={new Set()}
          onUpdateNodeWidget={vi.fn()}
          onUpdateNodeWidgets={vi.fn()}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => 0}
          findSeedControlWidgetIndex={() => null}
          promotedSeedModeNodeId={1774}
          setSeedMode={setSeedMode}
          isWidgetPinned={() => false}
          toggleWidgetPin={vi.fn()}
          resolveWidgetValue={(index) => index === 0 ? 777 : undefined}
          showFastGroupConfig={false}
          setShowFastGroupConfig={vi.fn()}
        />,
      );
    });

    expect(container.querySelector<HTMLInputElement>('.number-input-field-seed')?.value).toBe('777');
    expect(
      container.querySelector('[data-widget-control="Seed control"]')
        ?.getAttribute('data-widget-value'),
    ).toBe('increment');
    expect(container.querySelector('.number-input-field-seed')?.className).toContain('border-pink-500');
    expect(
      container.querySelector('[data-widget-control="Seed control"]')
        ?.getAttribute('data-promoted'),
    ).toBe('true');

    const randomize = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Randomize each time'),
    );
    await act(async () => randomize?.click());
    expect(setSeedMode).toHaveBeenCalledWith(1774, 'randomize');
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

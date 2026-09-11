import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { useParameterSectionFoldsStore } from '@/hooks/useParameterSectionFolds';
import { useRowMenuStore } from '@/hooks/useRowMenuStore';
import { useSeedStore } from '@/hooks/useSeed';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { NodeCardParameters } from '../Parameters';

/**
 * A subgraph that promotes a seed followed by a model combo — the shape that
 * broke. Nothing about `unet_name` says "I am not a control_after_generate"
 * except its position in the definition, so any code that reaches for the slot
 * after the seed writes a mode string into the model name.
 */
const PLACEHOLDER: WorkflowNode = {
  id: 99,
  itemKey: 'node:99',
  type: 'a-subgraph-uuid',
  pos: [0, 0],
  size: [320, 200],
  flags: {},
  order: 0,
  mode: 0,
  inputs: [],
  outputs: [],
  properties: {},
  widgets_values: [321, 'minimax_model.safetensors'],
} as unknown as WorkflowNode;

const WORKFLOW = {
  last_node_id: 99,
  last_link_id: 0,
  nodes: [PLACEHOLDER],
  links: [],
  groups: [],
  config: {},
  version: 1,
  definitions: {
    subgraphs: [{ id: 'a-subgraph-uuid', name: 'Minimax', nodes: [], links: [] }],
  },
} as unknown as Workflow;

const SEED_WIDGET = {
  widgetIndex: 0,
  name: 'seed',
  inputName: 'seed',
  type: 'INT',
  value: 321,
  inputIndex: 0,
  options: { min: 0, max: 4294967295 },
};

const MODEL_WIDGET = {
  widgetIndex: 1,
  name: 'unet_name',
  inputName: 'unet_name',
  type: 'COMBO',
  value: 'minimax_model.safetensors',
  inputIndex: 1,
  options: { values: ['minimax_model.safetensors'] },
};

describe('the seed buttons on a subgraph placeholder', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useRowMenuStore.setState({ openKey: null });
    useParameterSectionFoldsStore.setState({ collapsedItemKeys: [] });
    useSeedStore.setState({ seedModes: {}, seedLastValues: {} });
    useWorkflowStore.setState({ workflow: WORKFLOW, nodeTypes: {} as NodeTypes });
    window.matchMedia = window.matchMedia
      ?? (((query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  const updateWidgetMock = () =>
    vi.fn<(widgetIndex: number, value: unknown, widgetName?: string) => void>();
  const seedModeMock = () =>
    vi.fn<(nodeId: number, mode: 'fixed' | 'randomize' | 'increment' | 'decrement') => void>();

  async function renderCard(handlers: {
    onUpdateNodeWidget: ReturnType<typeof updateWidgetMock>;
    setSeedMode: ReturnType<typeof seedModeMock>;
  }) {
    await act(async () => {
      root.render(
        <NodeCardParameters
          node={PLACEHOLDER}
          isBypassed={false}
          isKSampler={false}
          workflowExists
          nodeTypesExists
          visibleInputWidgets={[SEED_WIDGET, MODEL_WIDGET]}
          visibleWidgets={[]}
          errorInputNames={new Set()}
          onUpdateNodeWidget={handlers.onUpdateNodeWidget}
          onUpdateNodeWidgets={vi.fn()}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => 0}
          // The subgraph promoted no control_after_generate, so there is none.
          findSeedControlWidgetIndex={() => null}
          isPlaceholder
          setSeedMode={handlers.setSeedMode}
          isWidgetPinned={() => false}
          toggleWidgetPin={vi.fn()}
          showFastGroupConfig={false}
          setShowFastGroupConfig={vi.fn()}
        />,
      );
    });
  }

  function clickButton(label: string) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes(label),
    );
    expect(button, `no "${label}" button rendered`).toBeDefined();
    return act(async () => button!.click());
  }

  it('writes the new seed to the seed slot and nothing else', async () => {
    const onUpdateNodeWidget = updateWidgetMock();
    const setSeedMode = seedModeMock();
    await renderCard({ onUpdateNodeWidget, setSeedMode });

    await clickButton('New fixed random');

    expect(onUpdateNodeWidget).toHaveBeenCalledTimes(1);
    const [index, value, inputName] = onUpdateNodeWidget.mock.calls[0];
    expect(index).toBe(0);
    expect(typeof value).toBe('number');
    expect(inputName).toBe('seed');
    // The model combo is the slot the mode used to land in.
    expect(onUpdateNodeWidget).not.toHaveBeenCalledWith(1, expect.anything(), expect.anything());
  });

  it('switches the mode before writing the seed it just generated', async () => {
    // "fixed" on a seed with no control widget replaces a special value with a
    // concrete one of its own choosing, reading the node as it was at render
    // time — running it second would land that substitute on top of this seed.
    const onUpdateNodeWidget = updateWidgetMock();
    const setSeedMode = seedModeMock();
    await renderCard({ onUpdateNodeWidget, setSeedMode });

    await clickButton('New fixed random');

    expect(setSeedMode).toHaveBeenCalledWith(99, 'fixed');
    expect(setSeedMode.mock.invocationCallOrder[0])
      .toBeLessThan(onUpdateNodeWidget.mock.invocationCallOrder[0]);
  });
});

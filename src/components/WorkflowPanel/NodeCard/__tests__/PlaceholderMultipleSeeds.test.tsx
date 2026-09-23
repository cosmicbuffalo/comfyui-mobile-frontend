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
 * A placeholder promoting two seeds, each owned by a sampler with its own
 * control_after_generate. Stock keeps each mode on its interior widget, so the
 * card has to draw one value + mode pair per seed, show each seed's own mode,
 * and write a mode change back to that seed's interior control only.
 */

function samplerType(seedInput: string): NodeTypes[string] {
  return {
    input: {
      required: {
        [seedInput]: ['INT', { default: 0, min: 0, max: 4294967295 }],
        steps: ['INT', { default: 20, min: 1, max: 10000 }],
      },
      optional: {},
    },
    input_order: { required: [seedInput, 'steps'], optional: [] },
    output: ['LATENT'],
    output_name: ['LATENT'],
    name: seedInput,
    display_name: seedInput,
    description: '',
    python_module: '',
    category: 'test',
  } as unknown as NodeTypes[string];
}

const NODE_TYPES: NodeTypes = {
  KSampler: samplerType('seed'),
  KSamplerAdvanced: samplerType('noise_seed'),
};

const PLACEHOLDER = {
  id: 100,
  itemKey: 'node:100',
  type: 'sg-two',
  pos: [0, 0], size: [320, 200], flags: {}, order: 0, mode: 0,
  inputs: [
    { name: 'seed', type: 'INT', widget: { name: 'seed' }, link: null },
    { name: 'noise_seed', type: 'INT', widget: { name: 'noise_seed' }, link: null },
  ],
  outputs: [],
  properties: {},
  widgets_values: [1111, 2222],
} as unknown as WorkflowNode;

function inner(id: number, type: string, seedInput: string, link: number, control: string) {
  return {
    id, type,
    pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0,
    inputs: [{ name: seedInput, type: 'INT', widget: { name: seedInput }, link }],
    outputs: [],
    properties: {},
    widgets_values: [0, control, 20],
  };
}

const WORKFLOW = {
  last_node_id: 100, last_link_id: 502,
  nodes: [PLACEHOLDER],
  links: [], groups: [], config: {}, version: 0.4,
  definitions: {
    subgraphs: [{
      id: 'sg-two',
      name: 'Two samplers',
      nodes: [
        inner(10, 'KSampler', 'seed', 501, 'randomize'),
        inner(11, 'KSamplerAdvanced', 'noise_seed', 502, 'fixed'),
      ],
      links: [
        { id: 501, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'INT' },
        { id: 502, origin_id: -10, origin_slot: 1, target_id: 11, target_slot: 0, type: 'INT' },
      ],
      inputs: [
        { name: 'seed', type: 'INT', linkIds: [501] },
        { name: 'noise_seed', type: 'INT', linkIds: [502] },
      ],
      outputs: [],
    }],
  },
} as unknown as Workflow;

const SEED_WIDGETS = [
  { widgetIndex: 0, name: 'seed', inputName: 'seed', type: 'INT', value: 1111, inputIndex: 0, options: { min: 0, max: 4294967295 } },
  { widgetIndex: 1, name: 'noise_seed', inputName: 'noise_seed', type: 'INT', value: 2222, inputIndex: 1, options: { min: 0, max: 4294967295 } },
];

describe('a placeholder with two promoted seeds', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useRowMenuStore.setState({ openKey: null });
    useParameterSectionFoldsStore.setState({ collapsedItemKeys: [] });
    useSeedStore.setState({ seedModes: {}, seedLastValues: {} });
    useWorkflowStore.setState({ workflow: WORKFLOW, nodeTypes: NODE_TYPES });
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

  async function renderCard(node: WorkflowNode = PLACEHOLDER) {
    await act(async () => {
      root.render(
        <NodeCardParameters
          node={node}
          isBypassed={false}
          isKSampler={false}
          workflowExists
          nodeTypesExists
          visibleInputWidgets={[]}
          visibleWidgets={SEED_WIDGETS}
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
        />,
      );
    });
  }

  // Each boundary slot is its own row: `widget-row-<node>-<value index>`.
  const row = (valueIndex: number) =>
    container.querySelector<HTMLElement>(`#widget-row-100-${valueIndex}`);
  const modeShownIn = (valueIndex: number) =>
    row(valueIndex)?.querySelector('[role="combobox"]')
      ?.closest('[data-swipe-nav-ignore]')?.textContent ?? null;

  it('draws both seeds, each with its own interior mode', async () => {
    await renderCard();

    // The second seed used to vanish: a name rule hid every `seed` and
    // `noise_seed` beside the one the specialized block drew.
    expect(row(0)?.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('1111');
    expect(row(1)?.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('2222');
    expect(modeShownIn(0)).toBe('randomize');
    expect(modeShownIn(1)).toBe('fixed');
  });

  it('writes a mode change to that seed\'s interior control only', async () => {
    const write = vi.spyOn(useWorkflowStore.getState(), 'updateSubgraphInnerNodeWidget')
      .mockImplementation(() => {});
    useWorkflowStore.setState({ updateSubgraphInnerNodeWidget: write });
    await renderCard();

    const combobox = row(1)!.querySelector<HTMLInputElement>('[role="combobox"]')!;
    await act(async () => {
      combobox.focus();
      combobox.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    const option = Array.from(document.querySelectorAll('[id*="-option-"]'))
      .find((candidate) => candidate.textContent === 'increment');
    expect(option, 'no "increment" option opened').toBeDefined();
    await act(async () => (option as HTMLElement).click());

    // Definition sg-two, sampler 11 (the noise_seed owner), control slot 1.
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('sg-two', 11, 1, 'increment', 'control_after_generate');
  });

  it('shows the inner seed that runs when the placeholder stores none', async () => {
    // Templates ship the placeholder with an empty widgets_values and keep the
    // real seed on the inner sampler; that seed is the one that executes and
    // advances, so it is the one the card has to show.
    const [a, b] = WORKFLOW.definitions!.subgraphs![0].nodes!;
    const templateWorkflow = {
      ...WORKFLOW,
      definitions: { subgraphs: [{
        ...WORKFLOW.definitions!.subgraphs![0],
        nodes: [
          { ...a, widgets_values: [4444, 'randomize', 20] },
          { ...b, widgets_values: [5555, 'fixed', 20] },
        ],
      }] },
    } as unknown as Workflow;
    useWorkflowStore.setState({ workflow: templateWorkflow });
    await renderCard({ ...PLACEHOLDER, widgets_values: [] } as WorkflowNode);

    expect(row(0)?.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('4444');
    expect(row(1)?.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe('5555');
  });

  it('offers no mobile-only seed buttons for a seed stock controls', async () => {
    await renderCard();
    expect(container.textContent).not.toContain('Randomize each time');
  });
});

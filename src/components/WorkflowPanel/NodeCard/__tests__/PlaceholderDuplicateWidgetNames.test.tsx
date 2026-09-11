import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { useParameterSectionFoldsStore } from '@/hooks/useParameterSectionFolds';
import { useSeedStore } from '@/hooks/useSeed';
import {
  resolveSubgraphPlaceholderInputWidgetDefs,
  resolveSubgraphPlaceholderWidgetDefs,
} from '@/utils/widgetDefinitions';
import { NodeCardParameters } from '../Parameters';
import workflowFixture from './fixtures/duplicate-promoted-widget-names.json';

// The label is what this suite is about, so render it rather than the raw name.
vi.mock('@/components/InputControls/WidgetControl', () => ({
  WidgetControl: ({ name, displayLabel }: { name: string; displayLabel?: string }) => (
    <div data-widget-control={displayLabel ?? name} />
  ),
}));

const nodeType = (name: string, input: NodeTypes[string]['input'], output: string[]) => ({
  name,
  display_name: name,
  description: '',
  python_module: 'nodes',
  category: 'test',
  input,
  output,
});

const NODE_TYPES: NodeTypes = {
  PrimitiveInt: nodeType('PrimitiveInt', { required: { value: ['INT', { control_after_generate: true }] } }, ['INT']),
  PrimitiveFloat: nodeType('PrimitiveFloat', { required: { value: ['FLOAT', {}] } }, ['FLOAT']),
  PrimitiveBoolean: nodeType('PrimitiveBoolean', { required: { value: ['BOOLEAN', {}] } }, ['BOOLEAN']),
  LoraLoaderModelOnly: nodeType(
    'LoraLoaderModelOnly',
    {
      required: {
        model: ['MODEL', {}],
        lora_name: [['turbo_lora.safetensors'], {}],
        strength_model: ['FLOAT', { default: 1 }],
      },
    },
    ['MODEL'],
  ),
};

/**
 * A subgraph that promotes three primitives to the boundary. Each primitive's
 * inner widget is called `value`, so ComfyUI names the boundary slots `value`,
 * `value_1` and `value_2` and the author's renames live in each slot's `label`.
 * Resolving a row's slot by the inner widget name collapsed all three onto the
 * first one, and every row drew the first slot's rename.
 */
describe('placeholder rows over boundary slots that share an inner widget name', () => {
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

  it('draws each row under its own boundary slot rename', async () => {
    const workflow = workflowFixture as unknown as Workflow;
    const definition = workflow.definitions!.subgraphs![0];
    const placeholder = workflow.nodes.find((n) => n.type === definition.id) as WorkflowNode;
    expect(placeholder).toBeDefined();

    const byBoundaryOrder = <T extends { widgetIndex: number }>(defs: T[]) =>
      [...defs].sort((a, b) => a.widgetIndex - b.widgetIndex);
    const visibleWidgets = byBoundaryOrder(
      resolveSubgraphPlaceholderWidgetDefs(placeholder, workflow, NODE_TYPES),
    );
    const visibleInputWidgets = byBoundaryOrder(
      resolveSubgraphPlaceholderInputWidgetDefs(placeholder, workflow, NODE_TYPES),
    );
    await act(async () => {
      root.render(
        <NodeCardParameters
          node={placeholder}
          isBypassed={false}
          isKSampler={false}
          workflowExists
          nodeTypesExists
          visibleInputWidgets={visibleInputWidgets}
          visibleWidgets={visibleWidgets}
          errorInputNames={new Set()}
          onUpdateNodeWidget={vi.fn()}
          onUpdateNodeWidgets={vi.fn()}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => null}
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

    const labels = Array.from(container.querySelectorAll('[data-widget-control]'))
      .map((el) => el.getAttribute('data-widget-control'));

    // Each row wears its own slot's rename — never another slot's, and never
    // an inner-mapping arrow: from outside the scope, which inner widget a
    // boundary slot drives is the subgraph's business, not the card's.
    expect(labels).toEqual([
      'turbo_steps',
      'turbo_mode',
      'turbo_model_strength',
      'turbo_cfg',
    ]);
    // The original regression: every `value`-backed row wearing the first
    // slot's rename.
    expect(labels.filter((label) => label === 'turbo_steps')).toHaveLength(1);
  });
});

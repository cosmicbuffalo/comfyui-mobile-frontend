import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowNode } from '@/api/types';
import { useParameterSectionFoldsStore } from '@/hooks/useParameterSectionFolds';
import { useRowMenuStore } from '@/hooks/useRowMenuStore';
import { useSeedStore } from '@/hooks/useSeed';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { NodeCardParameters } from '../Parameters';

// The row's "…" menu reaches WidgetControl as `labelAccessory`, so the stub has
// to render it — a stub that drops it silently hides every menu under test.
vi.mock('@/components/InputControls/WidgetControl', () => ({
  WidgetControl: ({ name, labelAccessory }: { name: string; labelAccessory?: unknown }) => (
    <div data-widget-control={name}>
      {name}
      {labelAccessory as never}
    </div>
  ),
}));

interface WidgetCase {
  type: string;
  value?: unknown;
  options?: Record<string, unknown> | unknown[];
  connected?: boolean;
  disabled?: boolean;
}

const menuLabels = () =>
  Array.from(document.querySelectorAll('.row-actions-menu button'))
    .map((item) => item.textContent?.trim() ?? '');

/**
 * "Enqueue with variations" only makes sense where the widget's value is a
 * choice from a list AND is genuinely this node's to set. Anything else would
 * queue a batch of identical runs, so the entry has to stay hidden.
 */
describe('the Enqueue with variations menu entry', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useParameterSectionFoldsStore.setState({ collapsedItemKeys: [] });
    useSeedStore.setState({ seedModes: {}, seedLastValues: {} });
    useRowMenuStore.setState({ openKey: null });
    useWorkflowStore.setState({ workflow: null, nodeTypes: null, scopeStack: [{ type: 'root' }] });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  /** Render one widget row and open its "…" menu. */
  const openMenuFor = async (widget: WidgetCase) => {
    const node: WorkflowNode = {
      id: 21,
      itemKey: 'node:21',
      type: 'KSampler',
      pos: [0, 0],
      size: [320, 200],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [],
      outputs: [],
      properties: {},
      widgets_values: [widget.value ?? 'euler'],
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
            name: 'sampler_name',
            type: widget.type,
            value: widget.value ?? 'euler',
            options: widget.options,
            connected: widget.connected,
            disabled: widget.disabled,
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
    const trigger = container.querySelector<HTMLButtonElement>('.row-actions-button');
    if (trigger) await act(async () => trigger.click());
    return menuLabels();
  };

  it('is offered on a combo with more than one option', async () => {
    const labels = await openMenuFor({ type: 'COMBO', options: ['euler', 'dpmpp_2m', 'ddim'] });
    expect(labels).toContain('Enqueue with variations');
  });

  it('is offered on a legacy array-typed combo', async () => {
    const labels = await openMenuFor({ type: 'COMBO', options: ['euler', 'dpmpp_2m'] });
    expect(labels).toContain('Enqueue with variations');
  });

  it('is withheld from a single-option combo, which is not a comparison', async () => {
    const labels = await openMenuFor({ type: 'COMBO', options: ['euler'] });
    // Assert the menu actually opened, so a withheld-entry check cannot pass
    // just because nothing rendered.
    expect(labels).toContain('Pin widget');
    expect(labels).not.toContain('Enqueue with variations');
  });

  it('is withheld from a non-combo widget', async () => {
    const labels = await openMenuFor({ type: 'INT', value: 20, options: { default: 20 } });
    expect(labels).toContain('Pin widget');
    expect(labels).not.toContain('Enqueue with variations');
  });

  it('is withheld while the widget is fed by a link', async () => {
    // The value comes from upstream; rewriting widgets_values would change
    // nothing about what executes.
    const labels = await openMenuFor({
      type: 'COMBO',
      options: ['euler', 'dpmpp_2m'],
      connected: true,
    });
    expect(labels).toContain('Pin widget');
    expect(labels).not.toContain('Enqueue with variations');
  });

  it('is withheld from a server-owned widget', async () => {
    const labels = await openMenuFor({
      type: 'COMBO',
      options: ['euler', 'dpmpp_2m'],
      disabled: true,
    });
    expect(labels).toContain('Pin widget');
    expect(labels).not.toContain('Enqueue with variations');
  });

  it('opens the picker for the widget it was invoked from', async () => {
    await openMenuFor({ type: 'COMBO', options: ['euler', 'dpmpp_2m', 'ddim'] });
    const entry = Array.from(document.querySelectorAll<HTMLButtonElement>('.row-actions-menu button'))
      .find((item) => item.textContent?.trim() === 'Enqueue with variations');
    await act(async () => entry!.click());

    expect(document.querySelector('#widget-variations-modal')).not.toBeNull();
    expect(document.querySelector('.widget-variations-subject')?.textContent)
      .toContain('sampler_name');
    expect(document.querySelectorAll('.widget-variations-option')).toHaveLength(3);
  });
});

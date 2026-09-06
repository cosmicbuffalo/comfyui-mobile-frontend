import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowNode } from '@/api/types';
import { useParameterSectionFoldsStore } from '@/hooks/useParameterSectionFolds';
import { NodeCardParameters } from '../Parameters';
import { useRowMenuStore } from '@/hooks/useRowMenuStore';

/**
 * Which widget menu offers what.
 *
 * Reordering only means something where the order is on screen: the
 * placeholder's own card, and the subgraph's slot list. On an inner node the
 * promoted widget is one control among that node's own, in an order the
 * boundary has no say over — so the move actions do not belong there, however
 * promoted the widget is.
 */
describe('widget menu by scope', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useRowMenuStore.setState({ openKey: null });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useParameterSectionFoldsStore.setState({ collapsedItemKeys: [] });
    window.matchMedia = window.matchMedia
      ?? (((query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  const node = (overrides?: Partial<WorkflowNode>): WorkflowNode => ({
    id: 5,
    itemKey: 'node:5',
    type: 'CLIPTextEncode',
    pos: [0, 0],
    size: [320, 200],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [{ name: 'text', type: 'STRING', link: 20, widget: { name: 'text' } }],
    outputs: [],
    properties: {},
    widgets_values: ['a prompt'],
    ...overrides,
  } as WorkflowNode);

  const widget = {
    widgetIndex: 0,
    name: 'text',
    inputName: 'text',
    type: 'STRING',
    value: 'a prompt',
    inputIndex: 0,
  };

  const renderCounting = async (
    props: Partial<Parameters<typeof NodeCardParameters>[0]>,
  ) => {
    await act(async () => {
      root.render(
        <NodeCardParameters
          node={node()}
          isBypassed={false}
          isKSampler={false}
          workflowExists
          nodeTypesExists
          visibleInputWidgets={[]}
          visibleWidgets={[widget]}
          errorInputNames={new Set()}
          onUpdateNodeWidget={() => {}}
          onUpdateNodeWidgets={() => {}}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => null}
          setSeedMode={() => {}}
          isWidgetPinned={() => false}
          toggleWidgetPin={() => {}}
          showFastGroupConfig={false}
          setShowFastGroupConfig={() => {}}
          {...props}
        />,
      );
    });
    return container.querySelectorAll('button.row-actions-button').length;
  };

  const render = async (props: Partial<Parameters<typeof NodeCardParameters>[0]>) => {
    await act(async () => {
      root.render(
        <NodeCardParameters
          node={node()}
          isBypassed={false}
          isKSampler={false}
          workflowExists
          nodeTypesExists
          visibleInputWidgets={[]}
          visibleWidgets={[widget]}
          errorInputNames={new Set()}
          onUpdateNodeWidget={() => {}}
          onUpdateNodeWidgets={() => {}}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => null}
          setSeedMode={() => {}}
          isWidgetPinned={() => false}
          toggleWidgetPin={() => {}}
          showFastGroupConfig={false}
          setShowFastGroupConfig={() => {}}
          {...props}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>('button.row-actions-button');
    await act(async () => trigger?.click());
    return Array.from(document.querySelectorAll('.row-actions-menu button')).map(
      (button) => button.textContent,
    );
  };

  it('offers no reorder on an inner node, however promoted the widget is', async () => {
    const labels = await render({
      promotedWidgetForms: { text: 'widget' },
      onDemoteWidget: () => {},
      onChangePromotedForm: () => {},
    });

    expect(labels).not.toContain('Move up');
    expect(labels).not.toContain('Move down');
    // The actions that DO belong to the inner side are still there.
    expect(labels).toContain('Unpromote');
    expect(labels).toContain('Switch to input');
  });

  it('offers the reorder on the placeholder, where the order is drawn', async () => {
    const labels = await render({
      isPlaceholder: true,
      visibleWidgets: [widget, { ...widget, widgetIndex: 1, name: 'text_1', inputName: 'text_1', inputIndex: 1 }],
      onMoveBoundarySlot: () => {},
      onRemoveBoundarySlot: () => {},
    });

    // First of two slots: down is offered, up is not.
    expect(labels).toContain('Move down');
    expect(labels).not.toContain('Move up');
    expect(labels).toContain('Remove input');
  });

  it('names the widget type from the node\'s own slot', async () => {
    await render({});
    // The fixture's `text` slot is a STRING, and the heading says so.
    expect(document.querySelector('.row-actions-type')?.textContent).toBe('STRING');
  });

  it('says how many options a combo has, rather than just COMBO', async () => {
    await render({
      node: node({
        inputs: [{ name: 'mode', type: 'COMBO', link: null, widget: { name: 'mode' } }],
        widgets_values: ['fast'],
      }),
      visibleWidgets: [{
        widgetIndex: 0,
        name: 'mode',
        inputName: 'mode',
        type: 'COMBO',
        value: 'fast',
        inputIndex: 0,
        options: ['fast', 'balanced', 'slow'],
      }],
    });

    expect(document.querySelector('.row-actions-type')?.textContent).toBe('COMBO · 3');
  });

  it('gives the seed block its menus, not just the generic widget list', async () => {
    // The seed and its control render through their own paths on every sampler
    // card, and each had no "…" at all while an ordinary widget beside them did.
    const menus = await renderCounting({
      // The card always supplies rename, so every row has at least one action;
      // a row with none renders no trigger at all, which is correct.
      onRenameWidget: () => {},
      node: node({
        type: 'KSampler',
        inputs: [{ name: 'seed', type: 'INT', link: null, widget: { name: 'seed' } }],
        widgets_values: [12345, 'fixed'],
      }),
      isKSampler: true,
      // One ordinary widget as well, since the parameters section only renders
      // when the node has some.
      visibleWidgets: [widget],
      getWidgetIndexForInput: (name: string) => (name === 'seed' ? 0 : null),
      findSeedWidgetIndex: () => 0,
    });

    // The ordinary widget, plus seed and its control mode.
    expect(menus).toBeGreaterThanOrEqual(3);
  });

  it('gives an unknown widget type a menu through the fallback control', async () => {
    const menus = await renderCounting({
      onRenameWidget: () => {},
      visibleWidgets: [{
        widgetIndex: 0,
        name: 'preview',
        inputName: 'preview',
        type: 'CUSTOM_THING',
        value: null,
        inputIndex: 0,
      }],
    });

    expect(menus).toBe(1);
  });
});

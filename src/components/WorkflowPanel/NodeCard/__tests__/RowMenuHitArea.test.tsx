import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowNode } from '@/api/types';
import { useParameterSectionFoldsStore } from '@/hooks/useParameterSectionFolds';
import { useRowMenuStore } from '@/hooks/useRowMenuStore';
import { NodeCardParameters } from '../Parameters';

/**
 * Only the button opens the row menu.
 *
 * The menu button is rendered as the label's accessory, and a <label> forwards
 * a click to its first labelable descendant — which, once a <button> is in
 * there, is the menu button. So clicking the widget's NAME, or the empty space
 * the label stretches across, opened the menu as if the button had been
 * pressed. The label is doing nothing else useful here: it carries no htmlFor
 * and the control is its sibling, so the forwarding was pure surprise.
 */
describe('the row menu opens from its button only', () => {
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

  const render = async (type: string, value: unknown) => {
    const node = {
      id: 5,
      itemKey: 'node:5',
      type: 'TestNode',
      pos: [0, 0],
      size: [320, 200],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [],
      outputs: [],
      properties: {},
      widgets_values: [value],
    } as unknown as WorkflowNode;

    await act(async () => {
      root.render(
        <NodeCardParameters
          node={node}
          isBypassed={false}
          isKSampler={false}
          workflowExists
          nodeTypesExists
          visibleInputWidgets={[]}
          visibleWidgets={[{ widgetIndex: 0, name: 'steps', type, value }]}
          errorInputNames={new Set()}
          onUpdateNodeWidget={() => {}}
          onUpdateNodeWidgets={() => {}}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => null}
          setSeedMode={() => {}}
          isWidgetPinned={() => false}
          toggleWidgetPin={() => {}}
          onRenameWidget={() => {}}
          showFastGroupConfig={false}
          setShowFastGroupConfig={() => {}}
        />,
      );
    });
  };

  const menuIsOpen = () => document.querySelectorAll('.row-actions-menu').length > 0;

  /** The label element that holds the widget's name and the menu button. */
  const labelOf = () => {
    const button = container.querySelector('button.row-actions-button');
    expect(button, 'no row menu button rendered').toBeTruthy();
    return button!.closest('label');
  };

  for (const [type, value] of [
    ['INT', 4],
    ['STRING', 'a prompt'],
    ['COMBO', 'euler'],
  ] as const) {
    it(`does not open when the ${type} row's label is clicked`, async () => {
      await render(type, value);

      const label = labelOf();
      // A label containing the button is the bug itself: with the accessory
      // outside it, there is nothing to forward and nothing to click through.
      if (label) {
        await act(async () => label.click());
        expect(menuIsOpen(), `clicking the ${type} label opened the menu`).toBe(false);
      }
    });

    it(`still opens from the ${type} row's own button`, async () => {
      await render(type, value);

      const button = container.querySelector<HTMLButtonElement>('button.row-actions-button');
      await act(async () => button!.click());
      expect(menuIsOpen()).toBe(true);
    });
  }
});

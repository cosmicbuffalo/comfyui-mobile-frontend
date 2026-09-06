import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowNode } from '@/api/types';
import { useParameterSectionFoldsStore } from '@/hooks/useParameterSectionFolds';
import { useRowMenuStore } from '@/hooks/useRowMenuStore';
import { NodeCardParameters } from '../Parameters';

/**
 * A promoted widget is DRAWN as "text ⇠ positive" — the widget's own name and
 * the boundary slot it feeds. That composition is display only. Seeding the
 * rename field with it wrote the arrow into the stored label, which then
 * composed again on the next render and again on the next rename.
 */
describe('renaming a widget that shows a mapping', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useRowMenuStore.setState({ openKey: null });
    useParameterSectionFoldsStore.setState({ collapsedItemKeys: [] });
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
  });

  const node = {
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
  } as unknown as WorkflowNode;

  it('offers the stored label, not the arrow the card draws', async () => {
    const onRenameWidget = vi.fn();
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
            name: 'text',
            inputName: 'text',
            type: 'STRING',
            value: 'a prompt',
            inputIndex: 0,
          }]}
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
          promotedWidgetForms={{ text: 'widget' }}
          promotedBoundaryLabels={{ text: 'positive' }}
          onRenameWidget={onRenameWidget}
        />,
      );
    });

    // The card shows the mapping...
    expect(container.textContent).toContain('text ⇠ positive');

    const trigger = container.querySelector<HTMLButtonElement>('button.row-actions-button');
    await act(async () => trigger?.click());
    const rename = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Rename',
    );
    await act(async () => rename?.click());

    // ...but the field offers nothing, because no rename has been stored yet.
    const field = document
      .querySelector('[data-dialog-root="true"]')
      ?.querySelector<HTMLInputElement>('input');
    expect(field?.value).toBe('');
    expect(field?.placeholder).toBe('text');

    const save = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[data-dialog-root="true"] button'),
    ).find((button) => button.textContent === 'Rename');
    await act(async () => save?.click());
    // Saving an untouched field stores nothing rather than the decoration.
    expect(onRenameWidget).toHaveBeenCalledWith('text', '');
  });
});

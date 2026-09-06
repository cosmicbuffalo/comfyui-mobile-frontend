import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowNode } from '@/api/types';
import { useParameterSectionFoldsStore } from '@/hooks/useParameterSectionFolds';
import { useRowMenuStore } from '@/hooks/useRowMenuStore';
import { widgetRowDomId } from '@/utils/workflowJumpTargets';
import { NodeCardParameters } from '../Parameters';

/**
 * The row id is the contract between the card and the jump: an undo of a single
 * widget edit is revealed by looking this id up in the DOM. If the markup stops
 * carrying it, the reveal silently falls back to the whole card for ever, which
 * no test of the undo side would notice.
 *
 * Combos matter as much as plain widgets here — `WidgetControl` hands them off
 * before it draws its own markup, so the id lives on the row wrapper the
 * parameters section renders rather than inside the control.
 */
describe('widget row ids', () => {
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
    id: 7,
    itemKey: 'node:7',
    type: 'KSampler',
    pos: [0, 0],
    size: [320, 200],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [12, 'euler'],
  } as unknown as WorkflowNode;

  it('gives every drawn row an id naming its node and widget index', async () => {
    await act(async () => {
      root.render(
        <NodeCardParameters
          node={node}
          isBypassed={false}
          isKSampler={false}
          workflowExists
          nodeTypesExists
          visibleInputWidgets={[{
            widgetIndex: 1,
            name: 'sampler_name',
            inputName: 'sampler_name',
            type: 'COMBO',
            value: 'euler',
            options: ['euler', 'ddim'],
            inputIndex: 1,
          }]}
          visibleWidgets={[{
            widgetIndex: 0,
            name: 'steps',
            inputName: 'steps',
            type: 'INT',
            value: 12,
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
        />,
      );
    });

    // The plain widget...
    expect(container.querySelector(`#${widgetRowDomId(7, 0)}`)).toBeTruthy();
    // ...and the combo, which renders down a different path inside the control.
    expect(container.querySelector(`#${widgetRowDomId(7, 1)}`)).toBeTruthy();
  });

  it('scopes the id to the node, so two cards drawing the same widget differ', () => {
    expect(widgetRowDomId(7, 0)).not.toBe(widgetRowDomId(8, 0));
  });
});

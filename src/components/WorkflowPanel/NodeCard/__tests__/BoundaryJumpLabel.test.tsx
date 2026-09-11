import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowNode } from '@/api/types';
import { useConnectionSectionFoldsStore } from '@/hooks/useConnectionSectionFolds';
import { useParameterSectionFoldsStore } from '@/hooks/useParameterSectionFolds';
import { useRowMenuStore } from '@/hooks/useRowMenuStore';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { flashJumpTarget } from '@/utils/workflowJumpDom';
import { NodeCardParameters } from '../Parameters';

/**
 * Inside a subgraph scope, a promoted widget's "⇠ slot" annotation and its
 * pink promoted marker render as ONE button — text first, marker on its
 * right — that jumps up to the boundary slot's row in the connections
 * section. When the boundary shares the widget's name, no annotation text is
 * drawn but the marker alone still jumps. Rendered through the REAL controls
 * (no WidgetControl mock), so the threading down to ControlLabelRow is what
 * is under test.
 */
describe('the boundary annotation jump on a promoted widget', () => {
  let container: HTMLDivElement;
  let root: Root;
  const jumpToWorkflowItem = vi.fn();
  const expand = vi.fn();

  beforeEach(() => {
    jumpToWorkflowItem.mockClear();
    expand.mockClear();
    useRowMenuStore.setState({ openKey: null });
    useParameterSectionFoldsStore.setState({ collapsedItemKeys: [] });
    useWorkflowStore.setState({
      workflow: null,
      nodeTypes: {},
      scopeStack: [{ type: 'root' }, { type: 'subgraph', id: 'sg1', placeholderNodeId: 9 }],
      jumpToWorkflowItem,
    } as never);
    useConnectionSectionFoldsStore.setState({ expand } as never);
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

  const makeNode = (): WorkflowNode => ({
    id: 5,
    itemKey: 'root/subgraph:sg1/node:5',
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
  } as unknown as WorkflowNode);

  const render = async (boundaryLabel: string) => {
    const node = makeNode();
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
          onUpdateNodeWidget={vi.fn()}
          onUpdateNodeWidgets={vi.fn()}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => null}
          setSeedMode={vi.fn()}
          isWidgetPinned={() => false}
          toggleWidgetPin={vi.fn()}
          showFastGroupConfig={false}
          setShowFastGroupConfig={vi.fn()}
          promotedWidgetForms={{ text: 'widget' }}
          promotedBoundaryLabels={{ text: boundaryLabel }}
          promotedBoundarySlots={{ text: 2 }}
        />,
      );
    });
  };

  it('draws the annotation as a button beside the bare label', async () => {
    // (Marker-in-button structure is pinned by ControlLabelRow's own test —
    // promotion state here would need a full placeholder workflow fixture.)
    await render('positive');

    const button = container.querySelector<HTMLButtonElement>('button.boundary-jump');
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe('⇠ positive');
    // The label itself carries only the widget's own name now.
    const label = container.querySelector('label');
    expect(label?.textContent).toBe('text');
  });

  it('unfolds the connections section and jumps to the slot row on tap', async () => {
    await render('positive');

    const button = container.querySelector<HTMLButtonElement>('button.boundary-jump');
    await act(async () => button!.click());

    expect(expand).toHaveBeenCalledWith('subgraph-boundary:sg1');
    expect(jumpToWorkflowItem).toHaveBeenCalledWith({
      kind: 'boundarySlot',
      domId: 'connection-button--10-input-2',
    });
  });

  it('jumps via the node input link when the promoted-view maps resolve nothing', async () => {
    // The view machinery also needs an inner widget index for value routing;
    // a widget it gives up on still has a boundary slot worth jumping to. The
    // binding then comes straight off the node's own input link, label
    // included — this is what keeps the icon-only (same-name) rows jumpable.
    useWorkflowStore.setState({
      workflow: {
        last_node_id: 9,
        last_link_id: 20,
        nodes: [],
        links: [],
        groups: [],
        config: {},
        version: 1,
        definitions: {
          subgraphs: [{
            id: 'sg1',
            name: 'SG',
            nodes: [],
            links: [{ id: 20, origin_id: -10, origin_slot: 2, target_id: 5, target_slot: 0, type: 'STRING' }],
            inputs: [
              { name: 'a', type: 'STRING', linkIds: [] },
              { name: 'b', type: 'STRING', linkIds: [] },
              { name: 'text_1', label: 'positive', type: 'STRING', linkIds: [20] },
            ],
            outputs: [],
          }],
        },
      },
    } as never);
    const node = makeNode();
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
          onUpdateNodeWidget={vi.fn()}
          onUpdateNodeWidgets={vi.fn()}
          getWidgetIndexForInput={() => null}
          findSeedWidgetIndex={() => null}
          setSeedMode={vi.fn()}
          isWidgetPinned={() => false}
          toggleWidgetPin={vi.fn()}
          showFastGroupConfig={false}
          setShowFastGroupConfig={vi.fn()}
          promotedWidgetForms={{ text: 'widget' }}
        />,
      );
    });

    const button = container.querySelector<HTMLButtonElement>('button.boundary-jump');
    expect(button).not.toBeNull();
    // The label too comes off the boundary slot the link names.
    expect(button!.textContent).toBe('⇠ positive');

    await act(async () => button!.click());
    expect(expand).toHaveBeenCalledWith('subgraph-boundary:sg1');
    expect(jumpToWorkflowItem).toHaveBeenCalledWith({
      kind: 'boundarySlot',
      domId: 'connection-button--10-input-2',
    });
  });

  it.each([
    ['seed', 'INT', true, undefined],
    ['noise_seed', 'INT', false, undefined],
    ['unet_name', 'COMBO', false, ['model.safetensors', 'other.safetensors']],
    ['enable_lora', 'BOOLEAN', false, undefined],
    ['lora_trigger_word', 'STRING', false, undefined],
  ] as const)('shares the icon-only return jump and input arrival for %s', async (name, type, isKSampler, options) => {
    const value = type === 'INT' ? 42 : type === 'COMBO' ? 'model.safetensors' : 'trigger';
    const node = {
      ...makeNode(), type: isKSampler ? 'KSampler' : 'TestNode',
      inputs: [{ name, type, link: 20, widget: { name } }],
      widgets_values: [value],
    };
    useWorkflowStore.setState({ workflow: {
      nodes: [{ ...makeNode(), id: 9, properties: { proxyWidgets: [['5', name]] } }],
      links: [], groups: [],
      definitions: { subgraphs: [{ id: 'sg1', nodes: [node], inputs: [{ name, type }],
        links: [{ id: 20, origin_id: -10, origin_slot: 0, target_id: 5, target_slot: 0, type }],
      }] },
    } } as never);
    await act(async () => root.render(
      <NodeCardParameters
        node={node} isBypassed={false} isKSampler={isKSampler} workflowExists nodeTypesExists
        visibleInputWidgets={[]}
        visibleWidgets={[{ name, inputName: name, type, value, options: options ? [...options] : undefined, widgetIndex: 0, inputIndex: 0 }]}
        errorInputNames={new Set()} onUpdateNodeWidget={vi.fn()} onUpdateNodeWidgets={vi.fn()}
        getWidgetIndexForInput={() => 0} findSeedWidgetIndex={() => type === 'INT' ? 0 : null}
        setSeedMode={vi.fn()} isWidgetPinned={() => false} toggleWidgetPin={vi.fn()}
        showFastGroupConfig={false} setShowFastGroupConfig={vi.fn()}
        promotedSeedModeNodeId={type === 'INT' && !isKSampler ? 9 : undefined}
      />,
    ));
    const row = container.querySelector<HTMLElement>('#widget-row-5-0');
    expect(row).not.toBeNull();
    expect(container.querySelectorAll('#widget-row-5-0')).toHaveLength(1);
    const button = row!.querySelector<HTMLButtonElement>('button.boundary-jump');
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe('');
    await act(async () => button!.click());
    expect(jumpToWorkflowItem).toHaveBeenCalledWith({ kind: 'boundarySlot', domId: 'connection-button--10-input-0' });
    flashJumpTarget(row);
    expect(row!.classList.contains('highlight-pulse')).toBe(false);
    expect(row!.querySelector('.widget-jump-surface.widget-input-highlight-pulse')).not.toBeNull();
    expect(button!.classList.contains('widget-label-highlight-pulse')).toBe(true);
  });

  it('draws nothing extra when the boundary shares the name and nothing is promoted', async () => {
    // Identical names say nothing, and without promotion state there is no
    // marker either — so no button renders at all. (Marker-alone jumping is
    // pinned by ControlLabelRow's own test.)
    await render('text');

    expect(container.querySelector('button.boundary-jump')).toBeNull();
    const label = container.querySelector('label');
    expect(label?.textContent).toBe('text');
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { SubgraphTypesModal } from '@/components/modals/SubgraphTypesModal';

const SHARED = 'sg-shared';
const PLAIN = 'sg-plain';

function node(id: number, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: `root/node:${id}`,
    type: 'Any',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides,
  };
}

function makeWorkflow(): Workflow {
  return {
    last_node_id: 20,
    last_link_id: 0,
    nodes: [
      node(1, { type: SHARED, properties: { mobileInstanceNumber: 1 }, color: '#3f789e' }),
      node(2, { type: SHARED, properties: { mobileInstanceNumber: 2 } }),
      node(3, { type: PLAIN }),
    ],
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: {
      subgraphs: [
        {
          id: SHARED,
          name: 'Section {n}',
          inputs: [{ id: 'i', name: 'clip', type: 'CLIP', linkIds: [] }],
          outputs: [],
          nodes: [node(10, { type: 'KSampler' })],
          links: [],
          extra: { 'comfyui-mobile': { nextInstanceNumber: 3 } },
        },
        { id: PLAIN, name: 'Loose one', inputs: [], outputs: [], nodes: [], links: [] },
      ],
    },
  } as unknown as Workflow;
}

const text = () => document.body.textContent ?? '';
const buttons = () => Array.from(document.querySelectorAll('button'));
const byText = (needle: string) => buttons().find((b) => b.textContent?.includes(needle));

describe('SubgraphTypesModal', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useWorkflowStore.setState({
      workflow: makeWorkflow(),
      scopeStack: [{ type: 'root' }],
      nodeTypes: null,
    });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  const render = async (onClose = () => {}) => {
    await act(async () => { root.render(<SubgraphTypesModal onClose={onClose} />); });
  };

  it('lists every subgraph in one list, with its instance count', async () => {
    // Every definition is a type; a one-off is a type with a single instance,
    // so there is nothing to separate it into a second category.
    await render();
    expect(text()).toContain('Section {n}');   // raw template, not interpolated
    expect(text()).toContain('2 instances');
    expect(text()).toContain('Loose one');
    expect(text()).not.toContain('Reusable types');
    expect(text()).not.toContain('Other subgraphs');
  });

  it('expands a row to list the instances it is used by', async () => {
    await render();
    expect(text()).not.toContain('Used by');
    await act(async () => { byText('Section {n}')?.click(); });
    expect(text()).toContain('Used by');
    // Each instance renders with its own number.
    expect(text()).toContain('Section 1');
    expect(text()).toContain('Section 2');
  });

  it('paints Used by instances with their workflow colours', async () => {
    await render();
    await act(async () => { byText('Section {n}')?.click(); });
    const instance = document.querySelector<HTMLElement>('.subgraph-type-instance')!;
    expect(instance.style.backgroundColor).toMatch(/^rgba\(/);
    expect(instance.style.borderColor).toMatch(/^rgba\(/);
  });

  it('renames the type through the store', async () => {
    await render();
    await act(async () => { byText('Section {n}')?.click(); });
    await act(async () => { byText('Rename')?.click(); });
    const input = document.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => {
      // React tracks the value property, so set it through the native setter.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Chunk {n}');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { byText('Save')?.click(); });
    const def = useWorkflowStore.getState().workflow?.definitions?.subgraphs?.find((d) => d.id === SHARED);
    expect(def?.name).toBe('Chunk {n}');
  });

  it('offers the two destructive choices when the type is in use', async () => {
    await render();
    await act(async () => { byText('Section {n}')?.click(); });
    await act(async () => { byText('Delete')?.click(); });
    expect(text()).toContain('is used by 2 instances');
    expect(byText('Unpack instances into the graph')).toBeTruthy();
    expect(byText('Delete instances and their nodes')).toBeTruthy();
  });

  it('deletes the type and its instances on confirm', async () => {
    await render();
    await act(async () => { byText('Section {n}')?.click(); });
    await act(async () => { byText('Delete')?.click(); });
    await act(async () => { byText('Delete instances and their nodes')?.click(); });
    const wf = useWorkflowStore.getState().workflow;
    expect(wf?.definitions?.subgraphs?.some((d) => d.id === SHARED)).toBe(false);
    expect(wf?.nodes.some((n) => n.type === SHARED)).toBe(false);
    // The unrelated plain subgraph survives.
    expect(wf?.definitions?.subgraphs?.some((d) => d.id === PLAIN)).toBe(true);
  });

  it('jumps to an instance and closes', async () => {
    const onClose = vi.fn();
    const setScopeTrail = vi.fn();
    const jumpToWorkflowItem = vi.fn();
    useWorkflowStore.setState({
      setScopeTrail: setScopeTrail as never,
      jumpToWorkflowItem: jumpToWorkflowItem as never,
    });
    await render(onClose);
    await act(async () => { byText('Section {n}')?.click(); });
    await act(async () => { byText('Section 2')?.click(); });

    // The scope moves first — an instance can live somewhere other than the
    // scope on screen, and a card that is not rendered cannot be revealed.
    // The trail is passed explicitly: with a shared type, letting the jump
    // derive it would land on whichever instance it found first, and this list
    // exists precisely so the user can say which one.
    expect(setScopeTrail).toHaveBeenCalledWith([{ type: 'root' }]);
    expect(onClose).toHaveBeenCalled();
    // Everything after that — revealing, waiting, scrolling, flashing — is the
    // shared jump's, tested where it lives.
    expect(jumpToWorkflowItem).toHaveBeenCalledWith({
      kind: 'subgraph',
      itemKey: 'root/node:2',
    });
  });
});

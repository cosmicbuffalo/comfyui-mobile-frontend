import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { UnpromoteSharedWidgetDialog } from '../UnpromoteSharedWidgetDialog';

/**
 * What the confirmation claims is about to be lost.
 *
 * An instance already holding the value being kept loses nothing — the inner
 * widget ends up on that value either way — so listing it would overstate the
 * cost of the action and pad the table with rows that are not at stake.
 */
describe('the unpromote confirmation', () => {
  let container: HTMLDivElement;
  let root: Root;

  const definitionId = 'shared-type';

  const instance = (id: number, title: string, value: unknown): WorkflowNode => ({
    id,
    itemKey: `node:${id}`,
    type: definitionId,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [{ name: 'text', type: 'STRING', widget: { name: 'text' }, link: null }],
    outputs: [],
    properties: {},
    widgets_values: [value],
    title,
  } as unknown as WorkflowNode);

  const load = (values: [number, string, unknown][]) => {
    const workflow: Workflow = {
      last_node_id: 100,
      last_link_id: 0,
      nodes: values.map(([id, title, value]) => instance(id, title, value)),
      links: [],
      groups: [],
      config: {},
      version: 1,
      definitions: {
        subgraphs: [{
          id: definitionId,
          name: 'Shared',
          inputs: [{ name: 'text', type: 'STRING' }],
          outputs: [],
          nodes: [{
            id: 5,
            type: 'CLIPTextEncode',
            inputs: [{ name: 'text', type: 'STRING', widget: { name: 'text' }, link: 1 }],
            outputs: [],
            widgets_values: [''],
          }],
          links: [{ id: 1, origin_id: -10, origin_slot: 0, target_id: 5, target_slot: 0, type: 'STRING' }],
          groups: [],
        }],
      },
    } as unknown as Workflow;
    useWorkflowStore.setState({ workflow, nodeTypes: {}, scopeStack: [{ type: 'root' }] });
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const render = async (keptId: number) => {
    await act(async () => {
      root.render(
        <UnpromoteSharedWidgetDialog
          subgraphId={definitionId}
          instanceNodeId={keptId}
          parentSubgraphId={null}
          boundarySlot={0}
          slotLabel="text"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });
  };

  const rowsOf = (section: string): string[][] =>
    Array.from(document.querySelectorAll(`${section} tbody tr`)).map((row) =>
      Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent?.trim() ?? ''),
    );

  it('leaves out instances that already hold the value being kept', async () => {
    load([
      [1, 'Section 1', 'keep me'],
      [2, 'Section 2', 'keep me'],
      [3, 'Section 3', 'something else'],
    ]);
    await render(1);

    expect(rowsOf('.unpromote-keeping')).toEqual([['Section 1', 'keep me']]);
    // Section 2 already agrees, so it is not losing anything.
    expect(rowsOf('.unpromote-losing')).toEqual([['Section 3', 'something else']]);
    expect(document.body.textContent).not.toContain('Section 2');
  });

  it('names the columns Instance and Value', async () => {
    load([[1, 'Section 1', 'a'], [2, 'Section 2', 'b']]);
    await render(1);

    for (const section of ['.unpromote-keeping', '.unpromote-losing']) {
      const headers = Array.from(document.querySelectorAll(`${section} thead th`))
        .map((cell) => cell.textContent?.trim());
      expect(headers, section).toEqual(['Instance', 'Value']);
    }
  });

  it('shows every disagreeing instance', async () => {
    load([
      [1, 'Section 1', 'a'],
      [2, 'Section 2', 'b'],
      [3, 'Section 3', 'c'],
    ]);
    await render(1);
    expect(rowsOf('.unpromote-losing')).toEqual([
      ['Section 2', 'b'],
      ['Section 3', 'c'],
    ]);
  });
});

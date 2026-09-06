import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { RemoveHarvestedNodesDialog } from '@/components/modals/RemoveHarvestedNodesDialog';

function node(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: `root/node:${id}`,
    type,
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
  } as WorkflowNode;
}

/** Two stranded encoders (one renamed) and a bystander that stays. */
function makeWorkflow(): Workflow {
  return {
    last_node_id: 20,
    last_link_id: 0,
    nodes: [
      node(4, 'CLIPTextEncode'),
      node(5, 'CLIPTextEncode', { title: 'Section 3 Prompt' }),
      node(6, 'KSampler'),
    ],
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: { subgraphs: [] },
  } as unknown as Workflow;
}

const text = () => document.body.textContent ?? '';
const buttons = () => Array.from(document.querySelectorAll('button'));
const byText = (needle: string) => buttons().find((b) => b.textContent?.includes(needle));

describe('RemoveHarvestedNodesDialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: makeWorkflow(),
      scopeStack: [{ type: 'root' }],
      nodeTypes: null,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  const render = async (nodeIds = [4, 5], onClose = vi.fn()) => {
    await act(async () => {
      root.render(<RemoveHarvestedNodesDialog nodeIds={nodeIds} onClose={onClose} />);
    });
    return onClose;
  };

  it('lists each stranded node by name and id', async () => {
    await render();
    const rows = Array.from(document.querySelectorAll('.remove-harvested-node'))
      .map((row) => row.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('CLIPTextEncode');
    expect(rows[0]).toContain('#4');
    expect(rows[1]).toContain('Section 3 Prompt');
    expect(rows[1]).toContain('#5');
  });

  it('keeps the nodes when declined', async () => {
    const onClose = await render();
    await act(async () => byText('Keep them')!.click());
    expect(onClose).toHaveBeenCalled();
    const ids = (useWorkflowStore.getState().workflow?.nodes ?? []).map((n) => n.id);
    expect(ids).toEqual([4, 5, 6]);
  });

  it('removes exactly the offered nodes when confirmed', async () => {
    const onClose = await render();
    await act(async () => byText('Remove')!.click());
    expect(onClose).toHaveBeenCalled();
    const ids = (useWorkflowStore.getState().workflow?.nodes ?? []).map((n) => n.id);
    expect(ids).toEqual([6]);
  });

  it('renders nothing once the offered nodes are gone', async () => {
    await render([99]);
    expect(text()).not.toContain('feed nothing');
    expect(document.querySelector('[data-dialog-root]')).toBeNull();
  });
});

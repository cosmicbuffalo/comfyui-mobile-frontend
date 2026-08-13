import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeCardConnections } from '../Connections';
import { useConnectionSectionFoldsStore } from '@/hooks/useConnectionSectionFolds';

let connectionButtonsVisible = true;

vi.mock('@/components/WorkflowPanel/NodeCard/Connections/ConnectionButton', () => ({
  ConnectionButton: ({ direction }: { direction: string }) => (
    <div data-testid={`connection-${direction}`}>{direction}</div>
  ),
}));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: (
    selector: (state: { connectionButtonsVisible: boolean; nodeTypes: null }) => unknown,
  ) => selector({ connectionButtonsVisible, nodeTypes: null }),
}));

describe('NodeCardConnections folding', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    connectionButtonsVisible = true;
    useConnectionSectionFoldsStore.setState({ collapsedItemKeys: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps the title row visible while defaulting buttons to open', async () => {
    await act(async () => {
      root.render(
        <NodeCardConnections
          nodeId={1}
          nodeHierarchicalKey="node-key"
          nodeType="Example"
          inputs={[{ name: 'input', type: 'IMAGE', link: null }]}
          outputs={[{ name: 'output', type: 'IMAGE', links: [] }]}
          allInputs={[{ name: 'input', type: 'IMAGE', link: null }]}
          allOutputs={[{ name: 'output', type: 'IMAGE', links: [] }]}
        />,
      );
    });

    expect(container.textContent).toContain('输入');
    expect(container.textContent).toContain('输出');
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
    // Default open now: the section starts expanded.
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.getAttribute('aria-label')).toBe('折叠连接');
    expect(toggle?.getAttribute('data-fold-state')).toBe('expanded');
    expect(toggle?.querySelectorAll('[data-connection-fold-chevron]')).toHaveLength(2);
    expect(container.querySelectorAll('.connection-section-divider')).toHaveLength(2);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();

    await act(async () => {
      toggle?.click();
    });

    // Clicking folds it, recording the node key as collapsed.
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.getAttribute('aria-label')).toBe('展开连接');
    expect(toggle?.getAttribute('data-fold-state')).toBe('collapsed');
    expect(useConnectionSectionFoldsStore.getState().collapsedItemKeys).toEqual(['node-key']);
  });

  it('shows the number of hidden connections when connection buttons are hidden', async () => {
    connectionButtonsVisible = false;

    await act(async () => {
      root.render(
        <NodeCardConnections
          nodeId={1}
          nodeHierarchicalKey="node-key"
          nodeType="Example"
          inputs={[
            { name: 'input-one', type: 'IMAGE', link: null },
            { name: 'input-two', type: 'MASK', link: null },
          ]}
          outputs={[{ name: 'output', type: 'IMAGE', links: [] }]}
          allInputs={[
            { name: 'input-one', type: 'IMAGE', link: null },
            { name: 'input-two', type: 'MASK', link: null },
          ]}
          allOutputs={[{ name: 'output', type: 'IMAGE', links: [] }]}
        />,
      );
    });

    expect(container.textContent).toBe('3 个隐藏连接');
    expect(container.querySelector('.connection-hidden-summary')).toBeTruthy();
    expect(container.querySelector('button[aria-expanded]')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="connection-"]')).toHaveLength(0);
  });

  it('uses a singular hidden connection label for one connection', async () => {
    connectionButtonsVisible = false;

    await act(async () => {
      root.render(
        <NodeCardConnections
          nodeId={1}
          nodeHierarchicalKey="node-key"
          nodeType="Example"
          inputs={[{ name: 'input', type: 'IMAGE', link: null }]}
          outputs={[]}
          allInputs={[{ name: 'input', type: 'IMAGE', link: null }]}
          allOutputs={[]}
        />,
      );
    });

    expect(container.textContent).toBe('1 个隐藏连接');
  });

  it('shows horizontal rules on both sides for one-sided nodes', async () => {
    await act(async () => {
      root.render(
        <NodeCardConnections
          nodeId={1}
          nodeHierarchicalKey="node-key"
          nodeType="Example"
          inputs={[]}
          outputs={[{ name: 'output', type: 'IMAGE', links: [] }]}
          allInputs={[]}
          allOutputs={[{ name: 'output', type: 'IMAGE', links: [] }]}
        />,
      );
    });

    expect(container.textContent).not.toContain('输入');
    expect(container.textContent).toContain('输出');
    expect(container.querySelectorAll('.connection-section-divider')).toHaveLength(2);
  });
});

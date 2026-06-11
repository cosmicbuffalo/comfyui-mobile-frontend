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
    useConnectionSectionFoldsStore.setState({ expandedItemKeys: [] });
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

  it('keeps the title row visible while defaulting buttons to folded', async () => {
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

    expect(container.textContent).toContain('Inputs');
    expect(container.textContent).toContain('Outputs');
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.getAttribute('aria-label')).toBe('Unfold connections');
    expect(toggle?.getAttribute('data-fold-state')).toBe('collapsed');
    expect(toggle?.querySelectorAll('[data-connection-fold-chevron]')).toHaveLength(2);
    expect(container.querySelectorAll('.connection-section-divider')).toHaveLength(2);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();

    await act(async () => {
      toggle?.click();
    });

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.getAttribute('aria-label')).toBe('Fold connections');
    expect(toggle?.getAttribute('data-fold-state')).toBe('expanded');
    expect(useConnectionSectionFoldsStore.getState().expandedItemKeys).toEqual(['node-key']);
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

    expect(container.textContent).toBe('3 hidden connections');
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

    expect(container.textContent).toBe('1 hidden connection');
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

    expect(container.textContent).not.toContain('Inputs');
    expect(container.textContent).toContain('Outputs');
    expect(container.querySelectorAll('.connection-section-divider')).toHaveLength(2);
  });
});

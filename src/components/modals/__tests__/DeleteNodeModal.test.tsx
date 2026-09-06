import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteNodeModal } from '@/components/modals/DeleteNodeModal';

function renderModal(
  root: Root,
  props: { hasConnections: boolean; canReconnect: boolean; onDelete?: (reconnect: boolean) => void },
) {
  return act(async () => {
    root.render(
      <DeleteNodeModal
        nodeId={7}
        displayName="KSampler"
        hasConnections={props.hasConnections}
        canReconnect={props.canReconnect}
        onCancel={() => {}}
        onDelete={props.onDelete ?? (() => {})}
      />,
    );
  });
}

function actionLabels(): string[] {
  return Array.from(document.querySelectorAll('button')).map((b) => b.textContent ?? '');
}

describe('DeleteNodeModal actions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  it('offers a single plain Delete for a node with no connections', async () => {
    await renderModal(root, { hasConnections: false, canReconnect: false });

    const labels = actionLabels();
    expect(labels).toContain('Delete');
    expect(labels).not.toContain('Delete & Reconnect');
    expect(labels).not.toContain('Delete & Disconnect');
    expect(document.body.textContent).toContain('Delete KSampler (#7)?');
  });

  it('offers a single Delete & Disconnect when nothing could be reconnected', async () => {
    await renderModal(root, { hasConnections: true, canReconnect: false });

    const labels = actionLabels();
    expect(labels).toContain('Delete & Disconnect');
    expect(labels).not.toContain('Delete & Reconnect');
  });

  it('opens with the delete focused so Enter confirms it', async () => {
    const onDelete = vi.fn();
    await renderModal(root, { hasConnections: false, canReconnect: false, onDelete });

    const deleteButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Delete',
    );
    expect(document.activeElement).toBe(deleteButton);
    // The ring is drawn on plain :focus, so it shows even though the dialog was
    // opened by a tap rather than by the keyboard.
    expect(deleteButton?.className).toContain('focus:ring-2');

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    expect(onDelete).toHaveBeenCalledWith(false);
  });

  it('leaves Cancel reachable by Tab, activating it rather than the default', async () => {
    const onDelete = vi.fn();
    await renderModal(root, { hasConnections: true, canReconnect: true, onDelete });

    const cancel = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Cancel',
    );
    await act(async () => {
      cancel?.focus();
      cancel?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    // Enter on a tabbed-to button must not fall through to the delete default.
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('offers both choices only when a reconnect would bridge something', async () => {
    const onDelete = vi.fn();
    await renderModal(root, { hasConnections: true, canReconnect: true, onDelete });

    const labels = actionLabels();
    expect(labels).toContain('Delete & Reconnect');
    expect(labels).toContain('Delete & Disconnect');

    const reconnect = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Delete & Reconnect',
    );
    await act(async () => {
      reconnect?.click();
    });
    expect(onDelete).toHaveBeenCalledWith(true);
  });
});

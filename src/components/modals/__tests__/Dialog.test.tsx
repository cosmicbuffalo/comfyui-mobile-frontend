import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '@/components/modals/Dialog';

describe('Dialog keyboard actions', () => {
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

  it('activates the autofocused action on Enter even when focus is outside the dialog controls', async () => {
    const onConfirm = vi.fn();

    await act(async () => {
      root.render(
        <Dialog
          onClose={() => {}}
          title="Delete file?"
          actions={[
            { label: 'Cancel', onClick: () => {} },
            { label: 'Delete', autoFocus: true, onClick: onConfirm },
          ]}
        />,
      );
    });

    (document.activeElement as HTMLElement | null)?.blur();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('activates the autofocused action on Enter when its button is focused', async () => {
    const onConfirm = vi.fn();

    await act(async () => {
      root.render(
        <Dialog
          onClose={() => {}}
          title="Delete file?"
          actions={[
            { label: 'Cancel', onClick: () => {} },
            { label: 'Delete', autoFocus: true, onClick: onConfirm },
          ]}
        />,
      );
    });

    // The dialog focuses the autofocus (Delete) button on mount. Enter must
    // activate it via the keybind rather than relying on native button
    // activation, which jsdom (and portaled fullscreen overlays) do not fire.
    const deleteButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => b.textContent === 'Delete');
    expect(document.activeElement).toBe(deleteButton);

    deleteButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not override Enter on a focused non-default dialog button', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    await act(async () => {
      root.render(
        <Dialog
          onClose={() => {}}
          title="Delete file?"
          actions={[
            { label: 'Cancel', onClick: onCancel },
            { label: 'Delete', autoFocus: true, onClick: onConfirm },
          ]}
        />,
      );
    });

    const cancelButton = document.querySelector<HTMLButtonElement>('button');
    cancelButton?.focus();
    cancelButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('submits the primary action from a focused single-line text field', async () => {
    const onSave = vi.fn();

    await act(async () => {
      root.render(
        <Dialog
          onClose={() => {}}
          title="Rename"
          description={<input aria-label="Workflow name" defaultValue="Draft" />}
          actions={[
            { label: 'Cancel', onClick: () => {} },
            { label: 'Save', variant: 'primary', onClick: onSave },
          ]}
        />,
      );
    });

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Workflow name"]');
    input?.focus();
    input?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('preserves Enter inside multiline text and content editors', async () => {
    const onSave = vi.fn();

    await act(async () => {
      root.render(
        <Dialog
          onClose={() => {}}
          title="Edit details"
          description={<textarea aria-label="Details" defaultValue="Line one" />}
          actions={[{ label: 'Save', variant: 'primary', onClick: onSave }]}
        />,
      );
    });

    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Details"]');
    textarea?.focus();
    textarea?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not submit a disabled primary action from a text field', async () => {
    const onSave = vi.fn();

    await act(async () => {
      root.render(
        <Dialog
          onClose={() => {}}
          title="Rename"
          description={<input aria-label="Workflow name" />}
          actions={[{ label: 'Save', variant: 'primary', disabled: true, onClick: onSave }]}
        />,
      );
    });

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Workflow name"]');
    input?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));

    expect(onSave).not.toHaveBeenCalled();
  });

  it('remains interactive when rendered inside a pointer-events-none overlay', async () => {
    await act(async () => {
      root.render(
        <div className="pointer-events-none">
          <Dialog
            onClose={() => {}}
            title="Download complete"
            actions={[{ label: 'Got it', onClick: () => {} }]}
          />
        </div>,
      );
    });

    expect(document.querySelector('[data-dialog-root="true"]')?.className).toContain(
      'pointer-events-auto',
    );
  });
});

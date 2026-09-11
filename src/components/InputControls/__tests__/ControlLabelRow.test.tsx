import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlLabelRow } from '../ControlLabelRow';

describe('ControlLabelRow boundary annotation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const render = async (props: Parameters<typeof ControlLabelRow>[0]) => {
    await act(async () => {
      root.render(<ControlLabelRow {...props} />);
    });
  };

  it('statically composes the annotation into the label, marker after it', async () => {
    // Without a jump handler the row draws exactly as it always has: one
    // span reading "text ⇠ positive" inside the label, the marker following.
    await render({
      name: 'text',
      boundaryAnnotation: '⇠ positive',
      isPromoted: true,
    });

    expect(container.querySelector('button.boundary-jump')).toBeNull();
    const span = container.querySelector('label span');
    expect(span?.textContent).toBe('text ⇠ positive');
    expect(container.querySelector('label svg')).not.toBeNull();
  });

  it('renders annotation and marker as one button, marker on the right', async () => {
    const onBoundaryJump = vi.fn();
    await render({
      name: 'text',
      boundaryAnnotation: '⇠ positive',
      isPromoted: true,
      onBoundaryJump,
    });

    const button = container.querySelector<HTMLButtonElement>('button.boundary-jump');
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe('⇠ positive');
    const text = button!.querySelector('span');
    const icon = button!.querySelector('svg');
    expect(text).not.toBeNull();
    expect(icon).not.toBeNull();
    expect(
      text!.compareDocumentPosition(icon!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The label keeps only the widget's own name, and no second marker.
    expect(container.querySelector('label')?.textContent).toBe('text');
    expect(container.querySelector('label svg')).toBeNull();

    await act(async () => button!.click());
    expect(onBoundaryJump).toHaveBeenCalledTimes(1);
  });

  it('keeps the marker alone jumpable when no annotation is drawn', async () => {
    // A boundary sharing the widget's name shows no "⇠" text, but the pink
    // marker itself still answers "where does this live?" on tap.
    const onBoundaryJump = vi.fn();
    await render({
      name: 'seed',
      isPromoted: true,
      onBoundaryJump,
    });

    const button = container.querySelector<HTMLButtonElement>('button.boundary-jump');
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe('');
    expect(button!.querySelector('svg')).not.toBeNull();

    await act(async () => button!.click());
    expect(onBoundaryJump).toHaveBeenCalledTimes(1);
  });

  it('renders no button when there is nothing to jump from', async () => {
    await render({
      name: 'steps',
      onBoundaryJump: vi.fn(),
    });

    expect(container.querySelector('button.boundary-jump')).toBeNull();
    expect(container.querySelector('label')?.textContent).toBe('steps');
  });
});

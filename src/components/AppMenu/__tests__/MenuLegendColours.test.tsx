import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PinButton } from '@/components/InputControls/PinButton';
import { MenuLegend } from '../MenuLegend';

/**
 * The legend is a picture of the app, so a swatch that no longer matches its
 * control is a wrong answer rather than a cosmetic slip — the pin entries sat
 * on amber for several releases while the buttons were fuchsia. Both sides now
 * read the same token; this renders them together so a future edit to one of
 * them alone shows up here.
 */
describe('icon legend swatches', () => {
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

  const classesOf = (element: Element | null | undefined) =>
    (element?.getAttribute('class') ?? '').split(/\s+/);

  it('draws the pin entries in the accent the pin controls use', async () => {
    await act(async () => root.render(<MenuLegend onBack={vi.fn()} />));
    const legend = container.innerHTML;

    const pinControl = document.createElement('div');
    document.body.appendChild(pinControl);
    const pinRoot = createRoot(pinControl);
    await act(async () => pinRoot.render(<PinButton isPinned onToggle={vi.fn()} />));
    const accent = classesOf(pinControl.querySelector('button'))
      .find((name) => name.startsWith('text-fuchsia-'));
    await act(async () => pinRoot.unmount());
    pinControl.remove();

    expect(accent).toBeDefined();
    // The same hue family, and nothing left on the old amber.
    expect(legend).toContain('fuchsia');
    expect(legend).not.toContain('amber');
  });
});

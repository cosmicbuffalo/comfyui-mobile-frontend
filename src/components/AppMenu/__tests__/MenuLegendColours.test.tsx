import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PinButton } from '@/components/InputControls/PinButton';
import {
  pinAccentActiveClassName,
  pinAccentMutedTextClassName,
  pinAccentTextClassName,
} from '@/components/chromeStyles';
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

  it('draws the pin entries in the accent the pin controls use', async () => {
    await act(async () => root.render(<MenuLegend onBack={vi.fn()} />));
    const legend = container.innerHTML;

    const pinControl = document.createElement('div');
    document.body.appendChild(pinControl);
    const pinRoot = createRoot(pinControl);
    await act(async () => pinRoot.render(<PinButton isPinned onToggle={vi.fn()} />));
    const control = pinControl.querySelector('button')?.getAttribute('class') ?? '';
    await act(async () => pinRoot.unmount());
    pinControl.remove();

    // Both sides are asserted against the shared token rather than a colour
    // spelled out here — the point is that they read the same source, not that
    // the source says any particular thing today.
    expect(control).toContain(pinAccentTextClassName);
    expect(legend).toContain(pinAccentActiveClassName);
    expect(legend).toContain(pinAccentMutedTextClassName);
  });
});

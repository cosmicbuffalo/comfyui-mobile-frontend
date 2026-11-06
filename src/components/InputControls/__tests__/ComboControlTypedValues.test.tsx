import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComboControl } from '../ComboControl';

// The server checks a combo with Python's `in`, so a saved number among string
// options (or the reverse) is rejected, and the card has to say so.
describe('ComboControl with a value of another type than its options', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = async (value: unknown, options: unknown[]) => {
    await act(async () => {
      root.render(
        <ComboControl containerClass="" name="size" value={value} options={options} onChange={() => {}} hasPin={false} />,
      );
    });
    return container.querySelector('.rs-missing') !== null;
  };

  it('marks a number saved among string options as missing', async () => {
    expect(await render(1, ['1', '2'])).toBe(true);
  });

  it('marks a string saved among number options as missing', async () => {
    expect(await render('512', [512, 768])).toBe(true);
  });

  it('accepts a value of the options own type', async () => {
    expect(await render(512, [512, 768])).toBe(false);
    expect(await render('1', ['1', '2'])).toBe(false);
  });
});

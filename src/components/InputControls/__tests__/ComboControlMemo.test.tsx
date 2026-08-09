import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComboControl } from '../ComboControl';

describe('ComboControl option memoization', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      media: '(pointer: coarse)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('does not repeat model metadata lookups for an equivalent parent render', () => {
    const modelLookup = vi.fn(() => null);
    const options = {
      options: ['alpha.safetensors', 'beta.safetensors', 'gamma.safetensors'],
      modelLookup,
    };
    const props = {
      containerClass: '',
      name: 'model',
      value: 'alpha.safetensors',
      options,
      onChange: () => {},
      hasPin: false,
    };

    act(() => root.render(<ComboControl {...props} />));
    expect(modelLookup).toHaveBeenCalledTimes(3);

    act(() => root.render(<ComboControl {...props} />));
    expect(modelLookup).toHaveBeenCalledTimes(3);
  });
});

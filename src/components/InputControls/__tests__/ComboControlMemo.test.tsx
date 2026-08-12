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

  it('uses compact trailing space for model controls and only reserves a visible pin', () => {
    const sharedProps = {
      containerClass: '',
      name: 'model',
      value: 'a-long-model-name.safetensors',
      options: { options: ['a-long-model-name.safetensors'] },
      onChange: () => {},
      hasPin: true,
      onTogglePin: () => {},
      forceModalOpen: true,
      compactTrailingControls: true,
    };

    act(() => root.render(<ComboControl {...sharedProps} isPinned={false} />));
    expect(container.querySelector('.combo-control-trigger-label')?.className).toContain('pr-6');
    expect(container.querySelector('.combo-control-chevron')?.className).toContain('w-9');
    expect(container.querySelector('.combo-control-chevron svg')?.classList).toContain('w-5');
    expect(container.querySelector('.combo-control-pin')).toBeNull();

    act(() => root.render(<ComboControl {...sharedProps} isPinned />));
    expect(container.querySelector('.combo-control-trigger-label')?.className).toContain('pr-13');
    expect(container.querySelector('.combo-control-chevron')?.className).toContain('w-9');
    expect(container.querySelector('.combo-control-pin')).not.toBeNull();
  });
});

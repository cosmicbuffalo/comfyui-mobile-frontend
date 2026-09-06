import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComboControl } from '../ComboControl';
import { useShowHiddenStore } from '@/hooks/useShowHidden';

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
    useShowHiddenStore.setState({ showHidden: false });
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

  it('filters dot-hidden model choices with the global preference', () => {
    act(() => root.render(
      <ComboControl
        containerClass=""
        name="model"
        value="public/model.safetensors"
        options={{ options: ['public/model.safetensors', '.hidden/fixture-model.safetensors'] }}
        onChange={() => {}}
        hasPin={false}
        isModelPicker
      />,
    ));

    act(() => {
      container.querySelector<HTMLElement>('.rs__control')?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      );
    });
    expect(document.body.textContent).not.toContain('.hidden/fixture-model.safetensors');

    act(() => useShowHiddenStore.getState().setShowHidden(true));
    expect(document.body.textContent).toContain('.hidden/fixture-model.safetensors');
  });
});

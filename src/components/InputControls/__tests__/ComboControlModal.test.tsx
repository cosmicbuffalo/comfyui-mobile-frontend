import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComboControl } from '../ComboControl';

function enterText(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ComboControl modal picker', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(pointer: coarse)',
      addEventListener: () => {},
      removeEventListener: () => {},
    })));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('keeps the search filter when the mobile keyboard dismisses the input', async () => {
    await act(async () => {
      root.render(
        <ComboControl
          containerClass=""
          name="model"
          value="alpha.safetensors"
          options={[
            'alpha.safetensors',
            'beta.safetensors',
            'gamma.safetensors',
            'delta.safetensors',
            'epsilon.safetensors',
          ]}
          onChange={() => {}}
          hasPin={false}
        />,
      );
    });

    await act(async () => {
      container.querySelector<HTMLElement>('.combo-control-trigger')?.click();
    });
    const input = document.body.querySelector<HTMLInputElement>(
      '.fullscreen-widget-modal input[role="combobox"]',
    );
    expect(input).not.toBeNull();

    await act(async () => {
      input?.focus();
      if (input) enterText(input, 'gamma');
    });
    expect(input?.value).toBe('gamma');

    await act(async () => input?.blur());

    expect(input?.value).toBe('gamma');
    expect(document.body.textContent).toContain('gamma.safetensors');
    expect(document.body.textContent).not.toContain('beta.safetensors');
  });

  it('uses the keyboard-aware modal as the vertical results scroller', async () => {
    await act(async () => {
      root.render(
        <ComboControl
          containerClass=""
          name="model"
          value="alpha"
          options={['alpha', 'beta', 'gamma', 'delta', 'epsilon']}
          onChange={() => {}}
          hasPin={false}
        />,
      );
    });

    await act(async () => {
      container.querySelector<HTMLElement>('.combo-control-trigger')?.click();
    });

    const modalScroller = document.body.querySelector<HTMLElement>(
      '.fullscreen-widget-modal .scroll-container',
    );
    const menuList = document.body.querySelector<HTMLElement>('.rs__menu-list');
    expect(modalScroller).not.toBeNull();
    expect(menuList).not.toBeNull();
    expect(modalScroller?.classList).toContain('overflow-y-auto');
    expect(getComputedStyle(menuList!).maxHeight).toBe('none');
    expect(getComputedStyle(menuList!).overflow).toBe('visible');
  });
});

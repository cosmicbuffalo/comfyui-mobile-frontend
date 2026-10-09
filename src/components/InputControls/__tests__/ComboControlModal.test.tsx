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

  it('matches every search term anywhere in the path, in any order', async () => {
    await act(async () => {
      root.render(
        <ComboControl
          containerClass=""
          name="lora_name"
          value="Flux/inpaint_v2.safetensors"
          options={[
            'Flux/inpaint_v2.safetensors',
            'Flux/detail.safetensors',
            'SDXL/paint_style.safetensors',
            'SDXL/eyes.safetensors',
            'SDXL/hands.safetensors',
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
    await act(async () => {
      input?.focus();
      if (input) enterText(input, 'paint flux');
    });

    const menu = document.body.querySelector('.fullscreen-widget-modal .rs__menu');
    expect(menu?.textContent).toContain('Flux/inpaint_v2.safetensors');
    expect(menu?.textContent).not.toContain('Flux/detail.safetensors');
    expect(menu?.textContent).not.toContain('SDXL/paint_style.safetensors');
  });

  it('only offers the base-model filter when it can narrow the list', async () => {
    const renderWith = async (baseModels: Record<string, string | undefined>) => {
      await act(async () => {
        root.render(
          <ComboControl
            containerClass=""
            name="lora_name"
            value="a.safetensors"
            options={{
              options: Object.keys(baseModels),
              modelLookup: (value: string) => ({ model_name: value, base_model: baseModels[value] }),
            }}
            onChange={() => {}}
            hasPin={false}
          />,
        );
      });
      await act(async () => {
        container.querySelector<HTMLElement>('.combo-control-trigger')?.click();
      });
      return document.body.querySelector('[aria-label="Filter by base model"]');
    };

    expect(await renderWith({
      'a.safetensors': undefined,
      'b.safetensors': undefined,
      'c.safetensors': undefined,
      'd.safetensors': undefined,
      'e.safetensors': undefined,
    })).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    expect(await renderWith({
      'a.safetensors': 'Flux.1 D',
      'b.safetensors': undefined,
      'c.safetensors': undefined,
      'd.safetensors': undefined,
      'e.safetensors': undefined,
    })).not.toBeNull();
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

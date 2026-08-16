import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComboControl } from '../ComboControl';

describe('ComboControl accessibility', () => {
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

  it('names the input-browser trigger from its widget name', async () => {
    await act(async () => {
      root.render(
        <ComboControl
          containerClass=""
          name="source_image"
          value="portrait.png"
          options={{
            options: ['portrait.png'],
            image_upload: true,
            image_folder: 'input',
          }}
          onChange={() => {}}
          hasPin={false}
        />,
      );
    });

    expect(
      container.querySelector('[role="button"]')?.getAttribute('aria-label'),
    ).toBe('Select source image');
  });
});

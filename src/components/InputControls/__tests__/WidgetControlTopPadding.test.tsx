import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetControl } from '../WidgetControl';
import { widgetControlHasTopPadding } from '../widgetControlSpacing';

// widgetControlHasTopPadding drives a `-mt-2` compensation on the node card's
// parameters section, so a type it claims is padded but that renders without
// `pt-2` pulls the first control up under the section divider. These render the
// real controls and check the promise holds.
describe('standard controls honor widgetControlHasTopPadding', () => {
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

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const renderWidget = async (
    type: string,
    value: unknown,
    options?: Record<string, unknown>,
  ) => {
    await act(async () => {
      root.render(
        <WidgetControl
          name="first"
          type={type}
          value={value}
          options={options}
          onChange={vi.fn()}
        />,
      );
    });
    return container.firstElementChild;
  };

  const cases: Array<{
    label: string;
    type: string;
    value: unknown;
    options?: Record<string, unknown>;
  }> = [
    { label: 'single-line STRING', type: 'STRING', value: 'text' },
    { label: 'multiline STRING', type: 'STRING', value: 'text', options: { multiline: true } },
    { label: 'INT', type: 'INT', value: 4 },
    { label: 'FLOAT', type: 'FLOAT', value: 1.5 },
    { label: 'BOOLEAN', type: 'BOOLEAN', value: true },
    { label: 'COMBO', type: 'COMBO', value: 'a', options: { options: ['a', 'b'] } },
  ];

  it.each(cases)('$label renders the pt-2 it claims', async ({ type, value, options }) => {
    expect(widgetControlHasTopPadding(type, options)).toBe(true);
    const rendered = await renderWidget(type, value, options);
    expect(rendered?.className).toContain('pt-2');
  });
});

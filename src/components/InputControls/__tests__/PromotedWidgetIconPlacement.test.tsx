import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WidgetControl } from '@/components/InputControls/WidgetControl';

/**
 * The promoted marker belongs with the label text it marks. The label reads
 * "widget ⇠ slot", so the marker follows the slot name at the end of it — and
 * before the actions menu, which is a control rather than part of the name.
 */
describe('promoted widget marker placement', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // StringControl asks whether the pointer is coarse; jsdom has no matchMedia.
    window.matchMedia = window.matchMedia
      ?? (((query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const render = async (isPromoted: boolean) => {
    await act(async () => {
      root.render(
        <WidgetControl
          name="steps"
          type="INT"
          value={20}
          onChange={() => {}}
          isPromoted={isPromoted}
          labelAccessory={<button type="button" className="row-actions-button">menu</button>}
        />,
      );
    });
  };

  it('puts the marker straight after the label text, before the actions menu', async () => {
    await render(true);

    // Asserted in document order rather than as siblings: the menu button is
    // the label's SIBLING, not its child, because a <label> forwards clicks to
    // a button inside it and would make the widget's name open the menu.
    const row = container.querySelector('.control-label-row')!;
    const name = row.querySelector('span')!;
    const marker = row.querySelector('svg')!;
    const menu = row.querySelector('button.row-actions-button')!;
    expect(name.textContent).toBe('steps');
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    // The marker sits between the name it marks and the menu button.
    expect(follows(name, marker)).toBe(true);
    expect(follows(marker, menu)).toBe(true);
  });

  it('follows the slot name when the label maps a widget onto a boundary slot', async () => {
    await act(async () => {
      root.render(
        <WidgetControl
          name="text"
          displayLabel="text ⇠ positive"
          type="STRING"
          value=""
          onChange={() => {}}
          isPromoted
        />,
      );
    });

    const row = container.querySelector('.control-label-row')!;
    const name = row.querySelector('span')!;
    const marker = row.querySelector('svg')!;
    expect(name.textContent).toBe('text ⇠ positive');
    expect(
      Boolean(name.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it('renders no marker at all when the widget is not promoted', async () => {
    await render(false);
    const row = container.querySelector('.control-label-row');
    // The label and the menu button; no marker anywhere inside.
    expect(Array.from(row?.children ?? [])).toHaveLength(2);
    expect(row?.querySelector('svg')).toBeNull();
  });

  it('gives a combo widget the same menu — booleans and enums render through it', async () => {
    // BOOLEAN routes through ComboControl, as do plain enum widgets like a
    // node's `mode`. The control ignored labelAccessory, so those widgets had
    // no "…" at all while numbers and strings did.
    await act(async () => {
      root.render(
        <WidgetControl
          name="enable_middle_frame"
          type="BOOLEAN"
          value={false}
          onChange={() => {}}
          labelAccessory={<button type="button" className="row-actions-button">menu</button>}
        />,
      );
    });

    expect(container.querySelector('button.row-actions-button')).toBeTruthy();
  });

  it('gives an enum combo the menu too', async () => {
    await act(async () => {
      root.render(
        <WidgetControl
          name="mode"
          type="COMBO"
          value="fast"
          options={['fast', 'slow']}
          onChange={() => {}}
          labelAccessory={<button type="button" className="row-actions-button">menu</button>}
        />,
      );
    });

    expect(container.querySelector('button.row-actions-button')).toBeTruthy();
  });
});

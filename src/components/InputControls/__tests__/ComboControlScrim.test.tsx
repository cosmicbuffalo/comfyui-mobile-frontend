import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComboControl } from '../ComboControl';
import { INLINE_SCRIM_LINGER_MS } from '../InlineComboScrim';

const backdrop = () => document.body.querySelector('.combo-open-backdrop');
const spotlight = () => document.body.querySelector('.combo-open-spotlight');
const menu = () => document.body.querySelector('.rs__menu');

const settle = (ms: number) =>
  act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

describe('the scrim behind an open inline combo', () => {
  let container: HTMLDivElement;
  let root: Root;

  const renderCombo = (props: Record<string, unknown> = {}) => act(async () => {
    root.render(
      <ComboControl
        containerClass=""
        name="scheduler"
        value="normal"
        options={['normal', 'karras', 'exponential']}
        onChange={() => {}}
        hasPin={false}
        {...props}
      />,
    );
  });

  const pressControl = async () => {
    const control = container.querySelector<HTMLElement>('.rs__control');
    await act(async () => {
      control?.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
      }));
    });
  };

  /** The click that ends the gesture which opened the list. */
  const finishOpeningGesture = () => act(async () => {
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

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

  it('appears with the list', async () => {
    await renderCombo();
    expect(backdrop()).toBeNull();

    await pressControl();
    expect(menu()).not.toBeNull();
    expect(backdrop()).not.toBeNull();
    expect(spotlight()).not.toBeNull();
    // Its geometry comes from index.css and from measured rectangles, neither
    // of which jsdom has — scripts/combo-scroll-smoke.mjs checks those.
  });

  it('stays out of the way until the opening gesture is over', async () => {
    await renderCombo();
    await pressControl();
    // On touch the list opens at touchend; the compatibility mousedown that
    // follows would otherwise land here and close it again straight away.
    expect((backdrop() as HTMLElement).style.pointerEvents).toBe('none');

    await finishOpeningGesture();
    expect((backdrop() as HTMLElement).style.pointerEvents).toBe('auto');
  });

  it('dismisses the list when it is pressed', async () => {
    await renderCombo();
    await pressControl();
    await finishOpeningGesture();

    await act(async () => {
      backdrop()?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it('spends the dismissing press entirely on itself', async () => {
    await renderCombo();
    await pressControl();
    await finishOpeningGesture();

    const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    await act(async () => { backdrop()?.dispatchEvent(press); });
    // Cancelled, so it moves no focus and produces no synthetic mouse events.
    expect(press.defaultPrevented).toBe(true);
  });

  it('cancels the mouse events a touch device would fire after it', async () => {
    await renderCombo();
    await pressControl();
    await finishOpeningGesture();

    for (const name of ['touchstart', 'touchend', 'mousedown', 'click']) {
      const event = new Event(name, { bubbles: true, cancelable: true });
      backdrop()?.dispatchEvent(event);
      expect(event.defaultPrevented, name).toBe(true);
    }
  });

  it('leaves as soon as the finger lifts, so it never blocks the next scroll', async () => {
    await renderCombo();
    await pressControl();
    await finishOpeningGesture();

    await act(async () => {
      backdrop()?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    // Still there: the press it is absorbing is not over yet.
    expect(backdrop()).not.toBeNull();

    await act(async () => { window.dispatchEvent(new Event('pointerup')); });
    await settle(100);
    // Gone well inside the window a full-screen catcher used to hold for. What
    // watches for the stray click from here is a listener, not an element.
    expect(backdrop()).toBeNull();
  });

  it('does not linger at all when a key closed the list', async () => {
    await renderCombo();
    await pressControl();
    await finishOpeningGesture();

    // On the input, so it reaches react-select's own handler on the way up
    // and this control's capture handler on the way down.
    const input = container.querySelector('.rs__control input');
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });
    // Escape is the end of it: an invisible catcher left over the page would
    // only swallow the reader's next click.
    expect(menu()).toBeNull();
    expect(backdrop()).toBeNull();
  });

  it('outlives the press itself, so the trailing click hits it', async () => {
    await renderCombo();
    await pressControl();
    await finishOpeningGesture();

    await act(async () => {
      backdrop()?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    // The list is gone but the scrim is not: the press is still underway.
    expect(menu()).toBeNull();
    expect(backdrop()).not.toBeNull();
    // The dim goes immediately, though — only the catcher stays.
    expect(spotlight()).toBeNull();

    await settle(INLINE_SCRIM_LINGER_MS + 80);
    expect(backdrop()).toBeNull();
  });

  it('leaves nothing behind when the control unmounts while open', async () => {
    await renderCombo();
    await pressControl();
    expect(backdrop()).not.toBeNull();

    await act(async () => root.unmount());
    expect(backdrop()).toBeNull();
    expect(spotlight()).toBeNull();
    root = createRoot(container);
  });

  it('is not used by the modal picker, which is its own surface', async () => {
    await renderCombo({
      options: ['a', 'b', 'c', 'd', 'e', 'f'],
      value: 'a',
    });
    // Six options on a coarse pointer takes the modal path, not the inline one.
    expect(container.querySelector('.combo-control-inline')).toBeNull();
    expect(container.querySelector('.rs-inline')).toBeNull();
    expect(backdrop()).toBeNull();
  });
});

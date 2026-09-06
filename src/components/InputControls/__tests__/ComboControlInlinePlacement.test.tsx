import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComboControl } from '../ComboControl';
import { COMBO_SCROLL_SPACE_VAR } from '../inlineComboScroll';

/**
 * These assertions are about *which* mechanism runs, not about geometry —
 * jsdom has no layout, and the mocked-rectangle tests that came before this
 * happily passed while the real browser was scrolling the whole document.
 * The measured behaviour lives in scripts/combo-scroll-smoke.mjs.
 */
describe('ComboControl inline menu placement', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalScrollIntoView: PropertyDescriptor | undefined;
  let scrollIntoView: ReturnType<typeof vi.fn>;
  let windowScrollTo: ReturnType<typeof vi.fn>;
  let scroller: HTMLDivElement;
  let scrollTop = 0;

  const openMenu = async () => {
    const control = container.querySelector<HTMLElement>('.rs__control');
    await act(async () => {
      control?.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
      }));
    });
  };

  const renderCombo = () => act(async () => {
    root.render(
      <ComboControl
        containerClass=""
        name="scheduler"
        value="normal"
        options={['normal', 'karras', 'exponential']}
        onChange={() => {}}
        hasPin={false}
      />,
    );
  });

  beforeEach(() => {
    // A short combo stays inline even on touch devices, which is the path the
    // alignment applies to.
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(pointer: coarse)',
      addEventListener: () => {},
      removeEventListener: () => {},
    })));
    scrollIntoView = vi.fn();
    originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    windowScrollTo = vi.fn();
    vi.stubGlobal('scrollTo', windowScrollTo);

    scrollTop = 900;
    scroller = document.createElement('div');
    scroller.dataset.nodeList = 'true';
    Object.defineProperty(scroller, 'clientHeight', { get: () => 500 });
    Object.defineProperty(scroller, 'scrollHeight', {
      get: () => {
        const granted = Number.parseFloat(
          scroller.style.getPropertyValue(COMBO_SCROLL_SPACE_VAR),
        ) || 0;
        return 4000 + granted;
      },
    });
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => { scrollTop = value; },
    });
    scroller.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    document.body.appendChild(scroller);

    container = document.createElement('div');
    scroller.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    scroller.remove();
    if (originalScrollIntoView) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollIntoView',
        originalScrollIntoView,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
    vi.unstubAllGlobals();
  });

  it('scrolls the workflow list only — never the element, never the document', async () => {
    await renderCombo();
    const label = container.querySelector<HTMLElement>('.combo-control-root > .control-label-row');
    expect(label).not.toBeNull();
    label!.getBoundingClientRect = () => ({ top: 460 }) as DOMRect;

    await openMenu();

    // 900 + (460 - 100) - 8
    expect(scrollTop).toBe(1252);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(windowScrollTo).not.toHaveBeenCalled();
  });

  it('measures the label, not the padded control root', async () => {
    await renderCombo();
    const rootControl = container.querySelector<HTMLElement>('.combo-control-root');
    const label = rootControl!.querySelector<HTMLElement>(':scope > .control-label-row');
    // The root sits above its label by the control's own top padding.
    rootControl!.getBoundingClientRect = () => ({ top: 420 }) as DOMRect;
    label!.getBoundingClientRect = () => ({ top: 460 }) as DOMRect;

    await openMenu();

    expect(scrollTop).toBe(1252);
  });

  it('keeps the portalled menu in document coordinates', async () => {
    await renderCombo();
    await openMenu();
    const menuPortal = document.body.querySelector<HTMLElement>('.rs__menu-portal');
    expect(menuPortal).not.toBeNull();
    expect(getComputedStyle(menuPortal!).position).toBe('absolute');
  });

  it('does not summon a keyboard for a touch-sized choice list', async () => {
    await renderCombo();
    const input = container.querySelector<HTMLInputElement>('input');
    expect(input?.getAttribute('inputmode')).toBe('none');
    expect(input?.getAttribute('aria-readonly')).toBe('true');
  });

  it('returns the combo to where it was, and gives the range back with it', async () => {
    scrollTop = 3480;
    await renderCombo();
    const label = container.querySelector<HTMLElement>('.combo-control-root > .control-label-row');
    // The label tracks the scroller, the way a real one does.
    label!.getBoundingClientRect = () => ({ top: 460 + (3480 - scrollTop) }) as DOMRect;

    await openMenu();
    // 3480 + 360 - 8 = 3832, past the natural 3500 maximum.
    expect(scrollTop).toBe(3832);
    expect(scroller.style.getPropertyValue(COMBO_SCROLL_SPACE_VAR)).toBe('332px');

    const control = container.querySelector<HTMLElement>('.rs__control');
    await act(async () => {
      control?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Escape',
      }));
    });
    // Back to the view the reader had, with nothing borrowed still outstanding.
    expect(scrollTop).toBe(3480);
    expect(scroller.style.getPropertyValue(COMBO_SCROLL_SPACE_VAR)).toBe('');
  });

  it('drops granted scroll space when the control unmounts', async () => {
    scrollTop = 3480;
    await renderCombo();
    const label = container.querySelector<HTMLElement>('.combo-control-root > .control-label-row');
    label!.getBoundingClientRect = () => ({ top: 460 }) as DOMRect;
    await openMenu();
    expect(scroller.style.getPropertyValue(COMBO_SCROLL_SPACE_VAR)).toBe('332px');

    await act(async () => root.unmount());
    expect(scroller.style.getPropertyValue(COMBO_SCROLL_SPACE_VAR)).toBe('');
    root = createRoot(container);
  });
});

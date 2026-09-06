import { describe, expect, it, vi } from 'vitest';
import {
  COMBO_SCROLL_SPACE_VAR,
  INLINE_COMBO_TOP_INSET,
  applyInlineComboAlignment,
  findComboScroller,
  holdInlineComboScroll,
  inlineComboAnchor,
  measureInlineComboAlignment,
  measureInlineComboOffset,
  restoreInlineComboOffset,
} from '../inlineComboScroll';

/**
 * jsdom has no layout, so every scroller here is a hand-built stand-in: a
 * fixed viewport height, a content height that grows by whatever trailing
 * space the module grants, and a scrollTop that clamps the way a real one
 * does.
 */
function makeScroller({
  contentHeight,
  viewportHeight = 500,
  top = 100,
  nodeList = true,
  scrollTop = 0,
}: {
  contentHeight: number;
  viewportHeight?: number;
  top?: number;
  nodeList?: boolean;
  scrollTop?: number;
}) {
  const element = document.createElement('div');
  if (nodeList) element.dataset.nodeList = 'true';
  let current = scrollTop;
  const granted = () => {
    const raw = element.style.getPropertyValue(COMBO_SCROLL_SPACE_VAR);
    return Number.parseFloat(raw) || 0;
  };
  // scrollHeight never reports less than the scrollport itself.
  const scrollHeight = () =>
    Math.max(viewportHeight, contentHeight + granted());
  Object.defineProperty(element, 'clientHeight', { get: () => viewportHeight });
  Object.defineProperty(element, 'scrollHeight', { get: scrollHeight });
  Object.defineProperty(element, 'scrollTop', {
    get: () => current,
    set: (value: number) => {
      current = Math.max(0, Math.min(value, scrollHeight() - viewportHeight));
    },
  });
  element.getBoundingClientRect = () => ({ top }) as DOMRect;
  document.body.appendChild(element);
  return element;
}

/**
 * A combo at a fixed place in the scroller's *content*. Its rectangles move
 * with scrollTop, the way a real element's do — without that, a round trip out
 * to the top and back would prove nothing.
 */
function makeCombo(
  scroller: HTMLElement,
  contentTop: number,
  { withLabel = true } = {},
) {
  let top = contentTop;
  const target = Object.assign(document.createElement('div'), {
    /** Stands in for a re-render that changes the height of anything above. */
    moveBy: (delta: number) => { top += delta; },
  });
  target.className = 'combo-control-inline';
  const labelTop = () =>
    scroller.getBoundingClientRect().top + top - scroller.scrollTop;
  // The root sits above its label by the control's own top padding.
  target.getBoundingClientRect = () => ({ top: labelTop() - 8 }) as DOMRect;
  if (withLabel) {
    const label = document.createElement('label');
    label.getBoundingClientRect = () => ({ top: labelTop() }) as DOMRect;
    target.appendChild(label);
  }
  scroller.appendChild(target);
  return target;
}

describe('inlineComboAnchor', () => {
  it('prefers the label over the padded control root', () => {
    const scroller = makeScroller({ contentHeight: 2000 });
    const target = makeCombo(scroller, 300);
    expect(inlineComboAnchor(target).tagName).toBe('LABEL');
  });

  it('falls back to the root when the combo renders no label', () => {
    const scroller = makeScroller({ contentHeight: 2000 });
    const target = makeCombo(scroller, 300, { withLabel: false });
    expect(inlineComboAnchor(target)).toBe(target);
  });
});

describe('findComboScroller', () => {
  it('finds the workflow list even when its content currently fits', () => {
    // Found, though nothing is granted to it — see the alignment tests.
    const scroller = makeScroller({ contentHeight: 200, viewportHeight: 500 });
    const target = makeCombo(scroller, 300);
    expect(findComboScroller(target)).toBe(scroller);
  });

  it('never offers the document as a scroller', () => {
    const loose = document.createElement('div');
    document.body.appendChild(loose);
    expect(findComboScroller(loose)).toBeNull();
  });
});

describe('measureInlineComboAlignment', () => {
  it('lands the label at the inset below the scrollport edge', () => {
    const scroller = makeScroller({ contentHeight: 4000, scrollTop: 900 });
    const target = makeCombo(scroller, 1220);
    const alignment = measureInlineComboAlignment(target, scroller);
    expect(alignment.desiredScrollTop).toBe(1220 - INLINE_COMBO_TOP_INSET);
    expect(alignment.canGrantSpace).toBe(true);
  });

  it('clamps to what a non-workflow host already allows', () => {
    const scroller = makeScroller({
      contentHeight: 1000,
      viewportHeight: 500,
      nodeList: false,
      scrollTop: 400,
    });
    const target = makeCombo(scroller, 720);
    const alignment = measureInlineComboAlignment(target, scroller);
    expect(alignment.canGrantSpace).toBe(false);
    expect(alignment.desiredScrollTop).toBe(500);
  });
});

describe('applyInlineComboAlignment', () => {
  it('leaves the scroller alone when the target is already reachable', () => {
    const scroller = makeScroller({ contentHeight: 4000, scrollTop: 900 });
    const target = makeCombo(scroller, 1220);
    applyInlineComboAlignment(scroller, measureInlineComboAlignment(target, scroller));
    expect(scroller.scrollTop).toBe(1212);
    expect(scroller.style.getPropertyValue(COMBO_SCROLL_SPACE_VAR)).toBe('');
  });

  it('grants a combo in the last node the range it is missing', () => {
    const scroller = makeScroller({ contentHeight: 1000, scrollTop: 480 });
    const target = makeCombo(scroller, 800);
    // Target 792, but the list naturally stops at 500.
    applyInlineComboAlignment(scroller, measureInlineComboAlignment(target, scroller));
    expect(scroller.scrollTop).toBe(792);
    expect(scroller.style.getPropertyValue(COMBO_SCROLL_SPACE_VAR)).toBe('292px');
  });

  it('re-measures the shortfall instead of calculating it', () => {
    // scrollHeight is floored at the viewport height, so a grant that leaves
    // the content still shorter than the scrollport buys no range at all. The
    // first round here lands 8px short of the target for exactly that reason.
    const scroller = makeScroller({ contentHeight: 508, viewportHeight: 500 });
    const target = makeCombo(scroller, 300);
    applyInlineComboAlignment(scroller, measureInlineComboAlignment(target, scroller));
    expect(scroller.scrollTop).toBe(292);
    expect(scroller.style.getPropertyValue(COMBO_SCROLL_SPACE_VAR)).toBe('284px');
  });

  it('leaves a workflow that fits on screen exactly where it is', () => {
    const scroller = makeScroller({ contentHeight: 300, viewportHeight: 500 });
    const target = makeCombo(scroller, 300);
    applyInlineComboAlignment(scroller, measureInlineComboAlignment(target, scroller));
    expect(scroller.style.getPropertyValue(COMBO_SCROLL_SPACE_VAR)).toBe('');
    expect(scroller.scrollTop).toBe(0);
  });

  it('never grants range to a host that has nowhere to put it', () => {
    const scroller = makeScroller({
      contentHeight: 300,
      viewportHeight: 500,
      nodeList: false,
    });
    const target = makeCombo(scroller, 300);
    applyInlineComboAlignment(scroller, measureInlineComboAlignment(target, scroller));
    expect(scroller.style.getPropertyValue(COMBO_SCROLL_SPACE_VAR)).toBe('');
    expect(scroller.scrollTop).toBe(0);
  });
});

describe("restoring the reader's position", () => {
  it('puts the combo back on the line it was opened from', () => {
    const scroller = makeScroller({ contentHeight: 4000, scrollTop: 900 });
    const target = makeCombo(scroller, 1220);
    const offset = measureInlineComboOffset(target, scroller);
    expect(offset).toBe(320);

    applyInlineComboAlignment(scroller, measureInlineComboAlignment(target, scroller));
    expect(scroller.scrollTop).toBe(1212);

    restoreInlineComboOffset(target, scroller, offset);
    expect(scroller.scrollTop).toBe(900);
  });

  it('hands the borrowed range back on the way', () => {
    const scroller = makeScroller({ contentHeight: 1000, scrollTop: 480 });
    const target = makeCombo(scroller, 800);
    const offset = measureInlineComboOffset(target, scroller);

    applyInlineComboAlignment(scroller, measureInlineComboAlignment(target, scroller));
    expect(scroller.style.getPropertyValue(COMBO_SCROLL_SPACE_VAR)).toBe('292px');

    restoreInlineComboOffset(target, scroller, offset);
    expect(scroller.style.getPropertyValue(COMBO_SCROLL_SPACE_VAR)).toBe('');
    expect(scroller.scrollTop).toBe(480);
  });

  it('follows the combo, not the old scrollTop, when the content above grew', () => {
    // Choosing a value can change the height of what sits above the combo. An
    // offset still puts the combo back on the same line of the screen; a
    // remembered scrollTop would be off by however much the content moved.
    const scroller = makeScroller({ contentHeight: 4000, scrollTop: 900 });
    const target = makeCombo(scroller, 1220);
    const offset = measureInlineComboOffset(target, scroller);
    applyInlineComboAlignment(scroller, measureInlineComboAlignment(target, scroller));

    target.moveBy(60);
    restoreInlineComboOffset(target, scroller, offset);
    expect(scroller.scrollTop).toBe(960);
    expect(measureInlineComboOffset(target, scroller)).toBe(offset);
  });
});

describe('holdInlineComboScroll', () => {
  it('puts both the document and the list back where the menu opened', () => {
    const scroller = makeScroller({ contentHeight: 4000, scrollTop: 1200 });
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });

    const hold = holdInlineComboScroll(scroller, 1200, { x: 0, y: 0 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 260 });
    scroller.scrollTop = 900;
    window.dispatchEvent(new Event('scroll'));

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(scroller.scrollTop).toBe(1200);

    hold.release();
    scroller.scrollTop = 900;
    window.dispatchEvent(new Event('scroll'));
    expect(scroller.scrollTop).toBe(900);
    vi.unstubAllGlobals();
  });
});

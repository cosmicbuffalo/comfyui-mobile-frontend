import { describe, expect, it, vi } from 'vitest';
import {
  captureQueueScrollAnchor,
  captureQueueScrollAnchorForItem,
  isQueueTouchMomentumScroll,
  restoreQueueScrollAnchor,
  shouldCaptureQueueScrollAnchor,
} from '../queueScrollAnchor';

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    height: bottom - top,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

// A fine-grained anchor element (header / image / prompt-preview row).
function anchorEl(id: string, top: number, bottom: number): HTMLElement {
  const el = document.createElement('div');
  el.dataset.scrollAnchorId = id;
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(top, bottom));
  return el;
}

// A queue card (`data-queue-item-id`) that also carries a card-level anchor id
// and holds the given fine-grained anchor children.
function card(
  id: string,
  top: number,
  bottom: number,
  children: HTMLElement[] = [],
): HTMLElement {
  const c = document.createElement('div');
  c.dataset.queueItemId = id;
  c.dataset.scrollAnchorId = id;
  vi.spyOn(c, 'getBoundingClientRect').mockReturnValue(rect(top, bottom));
  children.forEach((child) => c.appendChild(child));
  return c;
}

function container(
  top: number,
  bottom: number,
  scrollTop: number,
  cards: HTMLElement[] = [],
): HTMLElement {
  const c = document.createElement('div');
  Object.defineProperty(c, 'scrollTop', { value: scrollTop, writable: true });
  vi.spyOn(c, 'getBoundingClientRect').mockReturnValue(rect(top, bottom));
  cards.forEach((item) => c.appendChild(item));
  return c;
}

describe('queueScrollAnchor', () => {
  it('does not replace the anchor for layout-induced scroll events', () => {
    expect(shouldCaptureQueueScrollAnchor(300, false)).toBe(false);
    expect(shouldCaptureQueueScrollAnchor(300, true)).toBe(true);
    expect(shouldCaptureQueueScrollAnchor(0, true)).toBe(false);
  });

  it('only treats recent scroll events as momentum after a touch gesture', () => {
    expect(isQueueTouchMomentumScroll(false, false, 0, 100)).toBe(false);
    expect(isQueueTouchMomentumScroll(true, true, 0, 100)).toBe(false);
    expect(isQueueTouchMomentumScroll(true, false, 50, 100)).toBe(true);
    expect(isQueueTouchMomentumScroll(true, false, 100, 100)).toBe(false);
  });

  it('does not anchor while the queue is at the top', () => {
    const c = container(100, 700, 0, [card('first', 100, 200)]);
    expect(captureQueueScrollAnchor(c)).toBeNull();
  });

  it('anchors the card header when the card top is in view', () => {
    const c = container(100, 700, 300, [
      card('c1', 120, 600, [
        anchorEl('c1::header', 120, 170),
        anchorEl('c1::media::a.png', 180, 500),
      ]),
    ]);

    expect(captureQueueScrollAnchor(c)).toEqual({
      itemId: 'c1::header',
      offsetTop: 20,
      scrollTop: 300,
    });
  });

  it('anchors the finest element in view when the card is scrolled past its header', () => {
    const c = container(100, 700, 300, [
      card('c1', 0, 600, [
        anchorEl('c1::header', 0, 50), // scrolled above the viewport
        anchorEl('c1::media::a.png', 120, 400), // first with its top in view
        anchorEl('c1::media::b.png', 410, 600),
      ]),
    ]);

    expect(captureQueueScrollAnchor(c)).toEqual({
      itemId: 'c1::media::a.png',
      offsetTop: 20,
      scrollTop: 300,
    });
  });

  it('falls back to the topmost partially-visible element', () => {
    const c = container(100, 700, 300, [
      card('c1', 0, 600, [
        anchorEl('c1::header', 0, 50), // above the viewport
        anchorEl('c1::media::a.png', 60, 600), // straddles the top edge
      ]),
    ]);

    expect(captureQueueScrollAnchor(c)).toEqual({
      itemId: 'c1::media::a.png',
      offsetTop: -40,
      scrollTop: 300,
    });
  });

  it('skips cards scrolled entirely above the viewport', () => {
    const c = container(100, 700, 300, [
      card('above', 0, 90, [anchorEl('above::header', 0, 40)]),
      card('c1', 95, 400, [anchorEl('c1::header', 110, 160)]),
    ]);

    expect(captureQueueScrollAnchor(c)).toEqual({
      itemId: 'c1::header',
      offsetTop: 10,
      scrollTop: 300,
    });
  });

  it('can make a clicked fold row the active anchor before it resizes', () => {
    const c = container(100, 700, 300);
    const clickedRow = anchorEl('c1::prompt::5', 240, 500);

    expect(captureQueueScrollAnchorForItem(c, clickedRow)).toEqual({
      itemId: 'c1::prompt::5',
      offsetTop: 140,
      scrollTop: 300,
    });
  });

  it('restores the anchored element after content is inserted above it', () => {
    const c = container(100, 700, 300);
    c.appendChild(anchorEl('c1::media::a.png', 180, 320));

    expect(restoreQueueScrollAnchor(c, {
      itemId: 'c1::media::a.png',
      offsetTop: -20,
      scrollTop: 300,
    })).toBe(true);
    expect(c.scrollTop).toBe(400);
  });

  it('can repeatedly restore the same anchor through animated size changes', () => {
    const c = container(100, 700, 300);
    const el = anchorEl('c1::header', 130, 270);
    c.appendChild(el);

    const anchor = { itemId: 'c1::header', offsetTop: 0, scrollTop: 300 };
    expect(restoreQueueScrollAnchor(c, anchor)).toBe(true);
    expect(c.scrollTop).toBe(330);

    // restore advanced the anchor's scroll baseline to the compensated 330, so
    // a further involuntary growth keeps pinning without double-counting.
    vi.mocked(el.getBoundingClientRect).mockReturnValue(rect(145, 285));
    expect(restoreQueueScrollAnchor(c, anchor)).toBe(true);
    expect(c.scrollTop).toBe(375);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flashJumpTarget, revealJumpTarget } from '../workflowJumpDom';

/**
 * jsdom lays nothing out, so the geometry every alignment reads is stubbed:
 * a list 900px tall scrolled to 1000, with the target 200px below its top edge.
 */
function stageList(): { container: HTMLElement; card: HTMLElement; scrolled: number[] } {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.dataset.nodeList = 'true';
  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-reposition-item', 'node-7');
  const card = document.createElement('div');
  card.id = 'node-card-7';
  wrapper.appendChild(card);
  container.appendChild(wrapper);
  document.body.appendChild(container);

  Object.defineProperty(container, 'clientHeight', { value: 900, configurable: true });
  Object.defineProperty(container, 'scrollHeight', { value: 10000, configurable: true });
  container.scrollTop = 1000;
  container.getBoundingClientRect = () => ({ top: 50, bottom: 950, height: 900 }) as DOMRect;
  wrapper.getBoundingClientRect = () => ({ top: 250, bottom: 400, height: 150 }) as DOMRect;

  const scrolled: number[] = [];
  container.scrollTo = ((options: ScrollToOptions) => {
    scrolled.push(options.top ?? 0);
  }) as typeof container.scrollTo;
  return { container, card, scrolled };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('revealJumpTarget alignment', () => {
  it('scrolls the list so the target sits a third of the way down', () => {
    const { scrolled } = stageList();

    revealJumpTarget({ kind: 'container', nodeId: 7 }, 'belowTopThird');

    // 1000 (scrollTop) + 200 (offset in list) - 300 (a third of 900).
    expect(scrolled[0]).toBe(900);
  });

  it('corrects once more after the list has finished filling in', () => {
    vi.useFakeTimers();
    const { scrolled } = stageList();

    revealJumpTarget({ kind: 'container', nodeId: 7 }, 'belowTopThird');
    expect(scrolled).toHaveLength(1);
    vi.advanceTimersByTime(500);

    // Cards mounting above the target move it; a position computed as the jump
    // started is stale by the time the smooth scroll lands.
    expect(scrolled).toHaveLength(2);
  });

  it('never scrolls past the top of the list', () => {
    const { container, scrolled } = stageList();
    container.scrollTop = 10;

    revealJumpTarget({ kind: 'container', nodeId: 7 }, 'belowTopThird');

    expect(scrolled[0]).toBe(0);
  });

  it('leaves the default alignment flush with the top', () => {
    const { card, scrolled } = stageList();
    const into = vi.fn();
    card.scrollIntoView = into;
    (card.parentElement as HTMLElement).scrollIntoView = into;

    revealJumpTarget({ kind: 'container', nodeId: 7 });

    expect(scrolled).toHaveLength(0);
    expect(into).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });
});

describe('the widget-row arrival flash', () => {
  function stageWidgetRow({ withInput = true, withAnnotation = true } = {}) {
    document.body.innerHTML = '';
    const row = document.createElement('div');
    row.id = 'widget-row-5-3';
    const label = document.createElement('label');
    label.textContent = 'text';
    row.appendChild(label);
    let annotation: HTMLElement | null = null;
    if (withAnnotation) {
      annotation = document.createElement('button');
      annotation.className = 'boundary-jump';
      annotation.textContent = '⇠ positive';
      row.appendChild(annotation);
    }
    let input: HTMLElement | null = null;
    if (withInput) {
      input = document.createElement('div');
      input.className = 'w-full p-3 widget-jump-surface';
      row.appendChild(input);
    }
    document.body.appendChild(row);
    return { row, label, annotation, input };
  }

  it('rings the input and tints the slot name, not the row rectangle', () => {
    const { row, annotation, input } = stageWidgetRow();

    flashJumpTarget(row);

    expect(row.classList.contains('highlight-pulse')).toBe(false);
    expect(input!.classList.contains('widget-input-highlight-pulse')).toBe(true);
    expect(annotation!.classList.contains('widget-label-highlight-pulse')).toBe(true);
  });

  it('tints the label itself when the row shows no slot annotation', () => {
    const { row, label, input } = stageWidgetRow({ withAnnotation: false });

    flashJumpTarget(row);

    expect(input!.classList.contains('widget-input-highlight-pulse')).toBe(true);
    expect(label.classList.contains('widget-label-highlight-pulse')).toBe(true);
  });

  it('falls back to the row rectangle when the control draws no standard input', () => {
    const { row } = stageWidgetRow({ withInput: false });

    flashJumpTarget(row);

    expect(row.classList.contains('highlight-pulse')).toBe(true);
  });

  it('waits longer before flashing the further away the row starts', () => {
    vi.useFakeTimers();
    const { row, input } = stageWidgetRow();
    // Starts 2000px below the viewport bottom: delay = 300 + 2000 * 0.25 = 800.
    row.getBoundingClientRect = () => ({
      top: window.innerHeight + 2000,
      bottom: window.innerHeight + 2100,
      height: 100,
    }) as DOMRect;
    row.scrollIntoView = vi.fn();

    revealJumpTarget({ kind: 'widgetRow', domId: 'widget-row-5-3' });

    vi.advanceTimersByTime(700);
    expect(input!.classList.contains('widget-input-highlight-pulse')).toBe(false);
    vi.advanceTimersByTime(150);
    expect(input!.classList.contains('widget-input-highlight-pulse')).toBe(true);
  });

  it('keeps the short delay for a nearby row', () => {
    vi.useFakeTimers();
    const { row, input } = stageWidgetRow();
    // Just below the fold: the standard post-scroll delay applies.
    row.getBoundingClientRect = () => ({
      top: window.innerHeight + 40,
      bottom: window.innerHeight + 140,
      height: 100,
    }) as DOMRect;
    row.scrollIntoView = vi.fn();

    revealJumpTarget({ kind: 'widgetRow', domId: 'widget-row-5-3' });

    vi.advanceTimersByTime(320);
    expect(input!.classList.contains('widget-input-highlight-pulse')).toBe(true);
  });
});

describe('the boundary-slot arrival flash', () => {
  function stageConnectionRow() {
    document.body.innerHTML = '';
    const row = document.createElement('div');
    const button = document.createElement('button');
    button.id = 'connection-button--10-input-2';
    const labelCluster = document.createElement('span');
    labelCluster.className = 'connection-slot-label';
    labelCluster.textContent = 'seed';
    row.appendChild(button);
    row.appendChild(labelCluster);
    document.body.appendChild(row);
    return { row, button, labelCluster };
  }

  it('tints the slot name in unison with the button pulse', () => {
    const { button, labelCluster } = stageConnectionRow();

    flashJumpTarget(button);

    expect(button.classList.contains('connection-highlight-pulse')).toBe(true);
    expect(labelCluster.classList.contains('widget-label-highlight-pulse')).toBe(true);
  });

  it('waits longer before flashing the further away the slot starts', () => {
    vi.useFakeTimers();
    const { button } = stageConnectionRow();
    // 2000px below the viewport: delay = 300 + 2000 * 0.25 = 800.
    button.getBoundingClientRect = () => ({
      top: window.innerHeight + 2000,
      bottom: window.innerHeight + 2030,
      height: 30,
    }) as DOMRect;
    button.scrollIntoView = vi.fn();

    revealJumpTarget({ kind: 'connection', domId: 'connection-button--10-input-2' });

    vi.advanceTimersByTime(700);
    expect(button.classList.contains('connection-highlight-pulse')).toBe(false);
    vi.advanceTimersByTime(150);
    expect(button.classList.contains('connection-highlight-pulse')).toBe(true);
  });
});

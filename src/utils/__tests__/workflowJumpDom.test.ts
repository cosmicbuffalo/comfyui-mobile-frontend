import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealJumpTarget } from '../workflowJumpDom';

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

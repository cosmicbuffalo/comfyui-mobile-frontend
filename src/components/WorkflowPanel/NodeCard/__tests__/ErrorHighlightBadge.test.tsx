import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErrorHighlightBadge } from '../ErrorHighlightBadge';

describe('ErrorHighlightBadge', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('overlaps the top of the node header', async () => {
    await act(async () => {
      root.render(<ErrorHighlightBadge label="Running" overlapHeader />);
    });

    const badgePositioner = container.firstElementChild;
    expect(badgePositioner?.classList.contains('top-1')).toBe(true);
    expect(badgePositioner?.className).not.toMatch(/(?:^|\s)-top-/);
  });

  it('keeps ordinary reveal labels above the node', async () => {
    await act(async () => {
      root.render(<ErrorHighlightBadge label="Load Image" />);
    });

    const badgePositioner = container.firstElementChild;
    expect(badgePositioner?.classList.contains('-top-6')).toBe(true);
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FullscreenWidgetModal } from '@/components/modals/FullscreenWidgetModal';

describe('FullscreenWidgetModal viewer sidebar', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1600,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 900,
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('docks to the rightmost quarter of a large viewport when viewerSidebar is set', async () => {
    await act(async () => {
      root.render(
        <FullscreenWidgetModal
          isOpen
          title="Pinned widget"
          onClose={() => {}}
          viewerSidebar
        >
          Widget
        </FullscreenWidgetModal>,
      );
    });

    const modal = document.body.querySelector<HTMLDivElement>('.fullscreen-widget-modal');
    expect(modal?.style.width).toBe('400px');
    expect(modal?.style.transform).toBe('translate(1200px, 0px)');
  });

  it('stays fullscreen when viewerSidebar is not set', async () => {
    await act(async () => {
      root.render(
        <FullscreenWidgetModal
          isOpen
          title="Pinned widget"
          onClose={() => {}}
        >
          Widget
        </FullscreenWidgetModal>,
      );
    });

    const modal = document.body.querySelector<HTMLDivElement>('.fullscreen-widget-modal');
    expect(modal?.style.width).toBe('1600px');
    expect(modal?.style.transform).toBe('translate(0px, 0px)');
  });
});

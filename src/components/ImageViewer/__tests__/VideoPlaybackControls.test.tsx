import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoPlaybackControls } from '../MediaViewer/VideoPlaybackControls';

describe('VideoPlaybackControls timeline layout', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('uses 90% of the rendered video width without a panel background', () => {
    act(() => {
      root.render(
        <VideoPlaybackControls
          playing
          currentTime={5}
          duration={10}
          videoWidth={800}
          isIdle={false}
          onTogglePlayback={() => {}}
          onSeek={() => {}}
          onInteractionStart={() => {}}
          onInteractionEnd={() => {}}
        />,
      );
    });

    const scrubber = container.querySelector<HTMLElement>('.video-scrubber');
    expect(scrubber?.style.width).toBe('720px');
    expect(scrubber?.className).not.toContain('bg-black');
    expect(scrubber?.className).not.toContain('backdrop-blur');
    const timeline = scrubber?.querySelector<HTMLInputElement>('.video-timeline-input');
    expect(timeline?.style.getPropertyValue('--video-progress')).toBe('50%');
  });

  it('owns the displayed time while dragging and commits one seek on release', () => {
    const onSeek = vi.fn();
    const onInteractionStart = vi.fn();
    const onInteractionEnd = vi.fn();
    const renderAt = (currentTime: number) => {
      root.render(
        <VideoPlaybackControls
          playing
          currentTime={currentTime}
          duration={10}
          isIdle={false}
          onTogglePlayback={() => {}}
          onSeek={onSeek}
          onInteractionStart={onInteractionStart}
          onInteractionEnd={onInteractionEnd}
        />,
      );
    };

    act(() => renderAt(2));
    const timeline = container.querySelector<HTMLInputElement>('.video-timeline-input')!;
    Object.defineProperty(timeline, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });

    act(() => {
      timeline.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(timeline, '8');
      timeline.dispatchEvent(new Event('input', { bubbles: true }));
      // Simulate a stale timeupdate arriving while the finger is still at 8s.
      renderAt(3);
    });

    expect(timeline.value).toBe('8');
    expect(timeline.style.getPropertyValue('--video-progress')).toBe('80%');
    expect(onSeek).not.toHaveBeenCalled();
    expect(onInteractionStart).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(8);
    expect(onInteractionEnd).toHaveBeenCalledTimes(1);
  });
});

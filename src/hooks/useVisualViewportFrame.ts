import { useEffect, useState } from 'react';

export interface VisualViewportFrame {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
}

export function getVisualViewportFrame(): VisualViewportFrame {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
    offsetLeft: viewport?.offsetLeft ?? 0,
    offsetTop: viewport?.offsetTop ?? 0,
  };
}

/**
 * Tracks the visual viewport (size + offset), which on mobile shrinks/shifts
 * when the on-screen keyboard opens. Use it to size keyboard-aware overlays so
 * their content stays above the keyboard. Only listens while `active`.
 */
export function useVisualViewportFrame(active: boolean): VisualViewportFrame | null {
  const [frame, setFrame] = useState<VisualViewportFrame | null>(null);

  useEffect(() => {
    if (!active) return;

    let rafId: number | null = null;
    const update = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setFrame(getVisualViewportFrame());
      });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [active]);

  return frame;
}

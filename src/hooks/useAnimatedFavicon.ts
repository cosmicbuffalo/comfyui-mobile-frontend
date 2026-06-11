import { useEffect } from 'react';

// Drives the browser-tab favicon: a pulsing green dot while a generation is in
// progress, a solid cyan dot when idle. Rendered to a canvas → data URL and
// swapped onto the <link rel="icon">. Uses setInterval (not rAF) so the pulse
// keeps animating in a backgrounded tab — exactly when the user is looking at
// another tab and wants the at-a-glance status.

const SIZE = 32;
const PULSE_CYCLE_MS = 1100;
const IDLE_COLOR = '#22d3ee'; // cyan-400
// The dot pulses between these two greens (color only — size stays constant).
const ACTIVE_DIM: [number, number, number] = [21, 94, 48]; // green-800
const ACTIVE_BRIGHT: [number, number, number] = [74, 222, 128]; // green-400

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function getFaviconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  return link;
}

function drawDot(
  ctx: CanvasRenderingContext2D,
  color: string,
  scale: number,
  alpha: number,
): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  const center = SIZE / 2;
  const radius = (SIZE / 2 - 2) * scale;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function useAnimatedFavicon(active: boolean): void {
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const link = getFaviconLink();
    link.type = 'image/png';

    const paint = (color: string, scale: number, alpha: number) => {
      drawDot(ctx, color, scale, alpha);
      link.href = canvas.toDataURL('image/png');
    };

    if (!active) {
      paint(IDLE_COLOR, 1, 1);
      return;
    }

    const render = () => {
      // Phase from the wall clock so background-tab throttling only lowers the
      // frame rate, not the pulse timing.
      const phase = (performance.now() % PULSE_CYCLE_MS) / PULSE_CYCLE_MS;
      const pulse = (Math.sin(phase * 2 * Math.PI - Math.PI / 2) + 1) / 2; // 0..1
      // Color-only pulse: constant full size and opacity.
      paint(lerpColor(ACTIVE_DIM, ACTIVE_BRIGHT, pulse), 1, 1);
    };
    render();
    const timer = window.setInterval(render, 120);
    return () => window.clearInterval(timer);
  }, [active]);
}

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useOutputsStore } from '@/hooks/useOutputs';

export function OutputsSourceToggle() {
  const source = useOutputsStore((s) => s.source);
  const setSource = useOutputsStore((s) => s.setSource);
  const files = useOutputsStore((s) => s.files);
  const isLoading = useOutputsStore((s) => s.isLoading);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLButtonElement>(null);
  const outputRef = useRef<HTMLButtonElement>(null);
  // Null until first measured so the underline appears already in place on
  // mount rather than sliding in from the corner; it only animates on switch.
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  // Position the sliding underline under the active button. Measuring against
  // the live DOM (rather than hard-coding widths) keeps it correct as the
  // "Inputs"/"Outputs" label widths differ and survive font/layout shifts.
  useLayoutEffect(() => {
    const update = () => {
      const container = containerRef.current;
      // 'input'/'output' each have a button; any other source (e.g. 'temp') has
      // none — clear the underline rather than parking it under "Outputs".
      const active =
        source === 'input' ? inputRef.current : source === 'output' ? outputRef.current : null;
      if (!container) return;
      if (!active) {
        setIndicator(null);
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      setIndicator({ left: activeRect.left - containerRect.left, width: activeRect.width });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [source]);

  // Recursive item total for the focused location: each folder entry already
  // carries a server-computed recursive descendant-file count, every other
  // entry is one file. Summing both gives the total under the current folder.
  const totalItems = useMemo(
    () => files.reduce((acc, f) => acc + (f.type === 'folder' ? (f.count ?? 0) : 1), 0),
    [files]
  );

  const sourceLabel = source === 'input' ? 'inputs' : source === 'temp' ? 'temp' : 'outputs';
  const subtitle = isLoading && files.length === 0
    ? ' '
    : `${totalItems.toLocaleString()} ${sourceLabel}`;

  const buttonClass = (active: boolean) =>
    `h-7 text-lg font-semibold leading-7 transition-colors ${
      active ? 'text-slate-100' : 'text-slate-400 hover:text-slate-200'
    }`;

  return (
    <div id="top-bar-outputs-toggle" className="h-11 w-full min-w-0 px-2">
      {/* 3-column grid keeps the divider exactly centered in the bar while the
          differing "Inputs"/"Outputs" widths absorb into the side 1fr tracks. */}
      <div ref={containerRef} className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <button
          ref={inputRef}
          type="button"
          onClick={() => setSource('input')}
          className={`${buttonClass(source === 'input')} justify-self-end`}
        >
          Inputs
        </button>
        <svg width="20" height="8" viewBox="0 0 20 8" className="text-slate-500 shrink-0" aria-hidden="true">
          <line x1="2" y1="4" x2="18" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <button
          ref={outputRef}
          type="button"
          onClick={() => setSource('output')}
          className={`${buttonClass(source === 'output')} justify-self-start`}
        >
          Outputs
        </button>
        {indicator && (
          // Animate real left/width rather than a scaleX of a 1px base: scaling
          // a rounded element stretches its corner radius into tapered edges and
          // accumulates sub-pixel rounding that overshoots on the right. Driving
          // left/width directly keeps a crisp rectangle exactly the tab's width.
          <span
            className="pointer-events-none absolute bottom-0 h-[3px] bg-cyan-400 will-change-[left,width] transition-[left,width] duration-300 ease-out"
            style={{ left: `${indicator.left}px`, width: `${indicator.width}px` }}
          />
        )}
      </div>
      <p className="top-bar-subtitle h-4 text-xs text-slate-400 leading-4 text-center">{subtitle}</p>
    </div>
  );
}

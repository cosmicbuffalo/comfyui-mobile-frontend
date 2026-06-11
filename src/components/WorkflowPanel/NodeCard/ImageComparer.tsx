import { useCallback, useRef, useState } from 'react';
import { getImagePreviewUrl } from '@/api/client';
import { useGenerationSettingsStore } from '@/hooks/useGenerationSettings';
import { MenuIcon } from '@/components/icons/MenuIcon';

interface ComparerImage {
  filename: string;
  subfolder: string;
  type: string;
}

interface NodeCardImageComparerProps {
  show: boolean;
  aImages: ComparerImage[];
  bImages: ComparerImage[];
  displayName: string;
}

// Handle is `w-14 h-14` (56px); half of that is how far its centre must stay
// from the image edges so it never gets clipped.
const HANDLE_HALF_PX = 28;
// Buffer (px) around the comparer where swipe-navigation is also suppressed, so
// a touch that lands just outside the image edge can't switch app panels.
const SWIPE_DEAD_ZONE_PX = 56;

/**
 * Inline before/after slider for Image Comparer (rgthree) nodes. Image A occupies
 * the left of the divider, image B the right. Only the
 * round handle is draggable: dragging it moves the divider horizontally and lets
 * the handle follow the finger vertically along the line (clamped inside the
 * image). Tapping elsewhere on the image is inert, and a vertical drag anywhere
 * but the handle scrolls the page normally. When only one side has an image the
 * node behaves like a plain preview.
 */
export function NodeCardImageComparer({
  show,
  aImages,
  bImages,
  displayName,
}: NodeCardImageComparerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Subscribe so the preview refreshes immediately when the WebP preference is
  // toggled (the URL helpers read the flag, but this drives the re-render).
  useGenerationSettingsStore((s) => s.webpPreviewEnabled);
  // Divider position (% from left) and the handle's position along it (% from top).
  const [position, setPosition] = useState(50);
  const [handleTop, setHandleTop] = useState(50);

  const a = aImages[0] ?? null;
  const b = bImages[0] ?? null;

  const updateFromPointer = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    // Horizontal: the divider/clip position.
    const xPct = ((clientX - rect.left) / rect.width) * 100;
    setPosition(Math.min(100, Math.max(0, xPct)));
    // Vertical: the handle follows the finger but stays fully inside the image.
    const minCenter = Math.min(HANDLE_HALF_PX, rect.height / 2);
    const maxCenter = Math.max(rect.height - HANDLE_HALF_PX, rect.height / 2);
    const centerY = Math.min(maxCenter, Math.max(minCenter, clientY - rect.top));
    setHandleTop((centerY / rect.height) * 100);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Capture so the drag keeps following the finger/cursor even once it leaves
    // the handle. Don't move on the initial press — only on actual drag — so a
    // tap doesn't jump the divider.
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        updateFromPointer(e.clientX, e.clientY);
      }
    },
    [updateFromPointer]
  );

  if (!show) return null;

  // `/view` serves the original (usually a multi-MB PNG); the comparer would
  // otherwise stream two of them top-to-bottom. The preview URL re-encodes to a
  // small WebP at full resolution, so the slider populates near-instantly.
  const aSrc = a ? getImagePreviewUrl(a.filename, a.subfolder, a.type) : null;
  const bSrc = b ? getImagePreviewUrl(b.filename, b.subfolder, b.type) : null;

  // With only one side available, fall back to a single image — nothing to slide.
  if (!aSrc || !bSrc) {
    const onlySrc = aSrc ?? bSrc;
    if (!onlySrc) return null;
    return (
      <div className="mb-3">
        <div className="text-xs text-slate-500 mb-1.5 uppercase tracking-wide">
          Image Comparer
        </div>
        <img
          src={onlySrc}
          alt={`${displayName} output`}
          className="w-full h-auto rounded-lg border border-white/10"
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="text-xs text-slate-500 mb-1.5 uppercase tracking-wide">
        Image Comparer
      </div>
      <div
        ref={containerRef}
        data-swipe-nav-ignore="true"
        data-swipe-nav-ignore-margin={SWIPE_DEAD_ZONE_PX}
        className="relative w-full overflow-hidden rounded-lg border border-white/10 select-none"
      >
        {/* Base layer: image B drives the box height at its natural aspect. */}
        <img
          src={bSrc}
          alt={`${displayName} image B`}
          className="block w-full h-auto pointer-events-none"
          draggable={false}
        />
        {/* Overlay: image A, revealed from the left up to the divider. */}
        <img
          src={aSrc}
          alt={`${displayName} image A`}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          draggable={false}
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        />

        {/* Corner labels — left region shows A, right region shows B. */}
        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/55 text-[10px] font-semibold text-white/90 pointer-events-none">
          A
        </span>
        <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-black/55 text-[10px] font-semibold text-white/90 pointer-events-none">
          B
        </span>

        {/* Divider line (inert) + draggable handle. Only the handle takes pointer
            input (the container's `data-swipe-nav-ignore` keeps the drag from
            also triggering app swipe-navigation). `touch-none` on the handle lets
            it capture both axes so it can follow the finger up/down too. */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white/90 pointer-events-none"
          style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
        >
          {/* bg-[#fff], not bg-white: index.css globally remaps the `.bg-white`
              utility to a dark surface, so use an arbitrary white that dodges that
              rule and keeps the handle actually white. */}
          <div
            className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-[#fff] shadow-md flex items-center justify-center text-slate-600 touch-none cursor-ew-resize pointer-events-auto"
            style={{ top: `${handleTop}%` }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
          >
            <MenuIcon className="w-5 h-5 rotate-90" />
          </div>
        </div>
      </div>
    </div>
  );
}

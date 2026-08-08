import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useWidgetModalOpenStore } from '@/hooks/useWidgetModalOpen';
import { getVisualViewportFrame, useVisualViewportFrame } from '@/hooks/useVisualViewportFrame';
import { getCaretCoordinates } from '@/utils/caretCoordinates';
import { FullscreenModalHeader } from './FullscreenModalHeader';

const LARGE_SCREEN_MIN_WIDTH = 1024;

interface FullscreenWidgetModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  background?: 'opaque' | 'translucent';
  viewerSidebar?: boolean;
}

export function FullscreenWidgetModal({
  isOpen,
  title,
  onClose,
  children,
  headerActions,
  background = 'translucent',
  viewerSidebar = false,
}: FullscreenWidgetModalProps) {
  const viewportFrame = useVisualViewportFrame(isOpen);
  const widgetModalOpened = useWidgetModalOpenStore((s) => s.widgetModalOpened);
  const widgetModalClosed = useWidgetModalOpenStore((s) => s.widgetModalClosed);

  useBodyScrollLock(isOpen);

  // Announce open/close so overlays that would fight the modal for attention
  // (the execution progress card) can hide while a widget editor is up.
  useEffect(() => {
    if (!isOpen) return;
    widgetModalOpened();
    return () => widgetModalClosed();
  }, [isOpen, widgetModalOpened, widgetModalClosed]);

  // Keep the CARET visible while typing in a textarea inside the modal. iOS
  // WebKit's focus scroll targets the element's top edge, so in a long
  // auto-grown prompt textarea the cursor line can sit below the keyboard-
  // shrunken viewport. On focus/typing/caret moves (selectionchange), measure
  // the caret line via the shared mirror-div helper and nudge the modal's
  // scroll container so that line stays inside the visible frame, with one
  // line of breathing room. rAF-coalesced since selectionchange can fire per
  // keystroke.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    let rafId: number | null = null;
    const revealCaret = () => {
      rafId = null;
      const el = document.activeElement;
      if (!(el instanceof HTMLTextAreaElement) || !container.contains(el)) return;
      const caret = getCaretCoordinates(el, el.selectionEnd ?? el.value.length);
      // Caret line's position within the scroll container's content box.
      const caretTop =
        el.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop +
        caret.top -
        el.scrollTop;
      const caretBottom = caretTop + caret.height;
      const margin = caret.height;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight;
      if (caretBottom + margin > viewBottom) {
        container.scrollTop = caretBottom + margin - container.clientHeight;
      } else if (caretTop - margin < viewTop) {
        container.scrollTop = Math.max(0, caretTop - margin);
      }
    };
    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(revealCaret);
    };
    container.addEventListener('input', schedule);
    container.addEventListener('focusin', schedule);
    document.addEventListener('selectionchange', schedule);
    // Also re-check right away: this effect re-runs when the keyboard resizes
    // the visual viewport (frame height dep below), and the caret that was
    // visible pre-keyboard may not be anymore.
    schedule();
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      container.removeEventListener('input', schedule);
      container.removeEventListener('focusin', schedule);
      document.removeEventListener('selectionchange', schedule);
    };
  }, [isOpen, viewportFrame?.height]);

  if (!isOpen) return null;
  const frame = viewportFrame ?? getVisualViewportFrame();
  // Dock to the right 25% for any pinned-widget modal on a large screen, whether
  // or not the image viewer happens to be open.
  const useViewerSidebar =
    viewerSidebar && frame.width >= LARGE_SCREEN_MIN_WIDTH;
  const width = useViewerSidebar ? frame.width * 0.25 : frame.width;
  const offsetLeft = useViewerSidebar
    ? frame.offsetLeft + frame.width - width
    : frame.offsetLeft;

  return createPortal(
    // z-index sits BELOW the bottom bar (z-[2200]) on purpose: widget editing is
    // always launched from the workflow panel, and the user must be able to reach
    // the Run/enqueue controls while a widget editor (e.g. a pinned widget) is
    // open. The bar therefore renders on top of this modal's bottom edge; the
    // content is padded by --bottom-bar-offset so nothing hides behind it. (The
    // outputs "move" modal is a different component, ModalFrame, and still covers
    // the bar.) When the keyboard is open the bar is off-screen below it, so
    // there's no overlap regardless.
    //
    // The backdrop is pinned to the LAYOUT viewport: its height is 100lvh (100vh
    // fallback — see the .fullscreen-widget-modal rule in index.css), NOT the
    // visual-viewport height. When the on-screen keyboard opens, WebKit shrinks
    // only the visual viewport; a backdrop sized to it would stop right at the
    // keyboard's top edge and let the workflow underneath show through in the
    // strip behind the keyboard/accessory bar. The content is confined to the
    // keyboard-aware visual-viewport frame by the inner wrapper below instead.
    <div
      className={`fullscreen-widget-modal fixed left-0 top-0 z-[2190] overflow-hidden ${
        background === 'opaque' ? 'bg-slate-950' : 'bg-black/50 backdrop-blur-sm'
      }`}
      data-background={background}
      style={{
        width: `${width}px`,
        transform: `translate(${offsetLeft}px, 0px)`,
      }}
      onClick={onClose}
    >
      <div
        // Keyboard-aware frame: tracks the visual viewport (offset + height) so
        // the header and scrollable content always sit above the keyboard, while
        // the backdrop above keeps covering the whole layout viewport.
        className="pointer-events-none w-full"
        style={{
          height: `${frame.height}px`,
          transform: `translateY(${frame.offsetTop}px)`,
        }}
      >
        <div
          // The panel hugs its content and only grows to the full frame height
          // when the content needs it (max-h-full + auto height). The backdrop
          // div always covers the full frame, so short widgets (a small input,
          // a few combo options) no longer stretch a textarea/list to full height.
          className="pointer-events-none w-full max-h-full flex flex-col overflow-hidden"
          style={{
            paddingBottom: 'env(safe-area-inset-bottom, 0px)'
          }}
        >
          <div className="pointer-events-auto" onClick={(e) => e.stopPropagation()}>
            <FullscreenModalHeader
              title={title}
              onClose={onClose}
              headerActions={headerActions}
            />
          </div>
          <div
            ref={scrollContainerRef}
            // Sizes to its content (no flex-1) so the panel hugs short widgets;
            // min-h-0 + overflow-y-auto make this the scroll container once the
            // panel hits max-h-full, so tall content scrolls while the header stays put.
            className="pointer-events-auto min-h-0 overflow-y-auto overscroll-contain px-4 pt-2 text-slate-100"
            // Pad past the bottom bar so the tail of scrollable content (e.g. the
            // last combo options / bottom of a textarea) can scroll clear of it.
            style={{ paddingBottom: 'calc(1rem + var(--bottom-bar-offset, 0px))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col">{children}</div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

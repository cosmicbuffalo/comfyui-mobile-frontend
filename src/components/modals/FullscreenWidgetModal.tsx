import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { getVisualViewportFrame, useVisualViewportFrame } from '@/hooks/useVisualViewportFrame';
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

  useBodyScrollLock(isOpen);

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
    <div
      className={`fullscreen-widget-modal fixed left-0 top-0 z-[2190] overflow-hidden ${
        background === 'opaque' ? 'bg-slate-950' : 'bg-black/50 backdrop-blur-sm'
      }`}
      data-background={background}
      style={{
        width: `${width}px`,
        height: `${frame.height}px`,
        transform: `translate(${offsetLeft}px, ${frame.offsetTop}px)`,
      }}
      onClick={onClose}
    >
      <div
        // The panel hugs its content and only grows to the full backdrop height
        // when the content needs it (max-h-full + auto height). The backdrop div
        // above always covers the full frame, so short widgets (a small input,
        // a few combo options) no longer stretch a textarea/list to full height.
        className="w-full max-h-full flex flex-col overflow-hidden"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom, 0px)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <FullscreenModalHeader
          title={title}
          onClose={onClose}
          headerActions={headerActions}
        />
        <div
          // Sizes to its content (no flex-1) so the panel hugs short widgets;
          // min-h-0 + overflow-y-auto make this the scroll container once the
          // panel hits max-h-full, so tall content scrolls while the header stays put.
          className="min-h-0 overflow-y-auto overscroll-contain px-4 pt-2 text-slate-100"
          // Pad past the bottom bar so the tail of scrollable content (e.g. the
          // last combo options / bottom of a textarea) can scroll clear of it.
          style={{ paddingBottom: 'calc(1rem + var(--bottom-bar-offset, 0px))' }}
        >
          <div className="flex flex-col">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}

import { useEffect, useRef, type ReactNode } from 'react';

interface DialogAction {
  label: string;
  onClick: () => void;
  className?: string;
  variant?: 'secondary' | 'danger' | 'primary';
  disabled?: boolean;
  /**
   * When true, this action's button is focused once the dialog mounts. The
   * browser's :focus-visible heuristic decides whether to render the focus
   * ring — programmatic focus that follows a click event stays invisible,
   * while focus that follows a keyboard event shows the ring.
   */
  autoFocus?: boolean;
}

type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl';
type DialogAlign = 'center' | 'top';
type DialogBackground = 'translucent' | 'opaque';

interface DialogProps {
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  actions: DialogAction[];
  actionsLayout?: 'stack' | 'inline';
  size?: DialogSize;
  align?: DialogAlign;
  disableClose?: boolean;
  zIndex?: number;
  /**
   * When true the backdrop covers the entire viewport instead of leaving
   * space for the top/bottom chrome bars. Use this when the dialog is
   * rendered above a fullscreen overlay (e.g. the image viewer) where the
   * chrome is not visible.
   */
  fullscreen?: boolean;
  background?: DialogBackground;
}

const SIZE_CLASS: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
};

export function Dialog({
  onClose,
  title,
  description,
  actions,
  actionsLayout = 'inline',
  size = 'sm',
  align = 'center',
  disableClose = false,
  zIndex = 2200,
  fullscreen = false,
  background = 'opaque',
}: DialogProps) {
  const defaultActionClass = (variant: DialogAction['variant']) => {
    if (variant === 'danger') {
      return 'px-3 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-600';
    }
    if (variant === 'primary') {
      return 'px-3 py-2 rounded-lg text-sm font-semibold text-slate-950 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-cyan-500';
    }
    return 'px-3 py-2 rounded-lg text-sm font-medium text-slate-200 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent';
  };

  const alignClass = align === 'top' ? 'items-start pt-6' : 'items-center';
  const surfaceClass = background === 'opaque' ? 'bg-slate-900' : 'bg-slate-900/95';
  const handleBackdropClick = disableClose ? undefined : onClose;

  // Focus management:
  // - On mount, focus the action marked `autoFocus` (if any).
  // - On unmount, restore focus to whatever was focused before the dialog opened.
  // - Tab cycles between focusable elements inside the dialog, wrapping at both ends.
  const dialogContentRef = useRef<HTMLDivElement>(null);
  const dialogRootRef = useRef<HTMLDivElement>(null);
  // Populated by each action button's callback ref below. We intentionally do
  // NOT clear this during render (that mutates a ref mid-render and can be seen
  // as empty by a concurrent render); the inline callback refs re-run every
  // render — null for removed buttons, the element for current ones — keeping
  // the array in sync on their own.
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const autoFocusIndex = actions.findIndex((a) => a.autoFocus);
    if (autoFocusIndex >= 0) {
      buttonRefs.current[autoFocusIndex]?.focus({ preventScroll: true });
    }
    return () => {
      previouslyFocused?.focus?.({ preventScroll: true });
    };
    // We intentionally only run this on mount; actions changing mid-dialog
    // shouldn't refocus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleContentKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const container = dialogContentRef.current;
    if (!container) return;
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey) {
      if (active === first || !container.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !container.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  const isTopmostDialog = () => {
    const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-dialog-root="true"]'));
    return roots[roots.length - 1] === dialogRootRef.current;
  };

  // Enter activates the explicit default action (the one marked `autoFocus`),
  // whether focus is still on that button or has not landed inside the dialog at
  // all. preventDefault suppresses any duplicate native click. Other focused
  // controls keep their browser behavior to avoid double-submits and preserve
  // text editing.
  useEffect(() => {
    const shouldLetTargetHandleEnter = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const nativeEnterTarget = target.closest(
        'button, a[href], input, select, textarea, [contenteditable="true"]',
      );
      if (!nativeEnterTarget || !dialogContentRef.current?.contains(nativeEnterTarget)) {
        return false;
      }
      // The auto-focus action is our explicit default. Since the dialog focuses
      // that button on mount, focus is already on it when Enter is pressed — so we
      // must activate it through the keybind below rather than deferring to the
      // browser's native button activation, which does not reliably fire when the
      // dialog is portaled over a fullscreen overlay (e.g. the image viewer).
      // Other focused controls keep their native behavior: text fields preserve
      // editing, and a different button the user tabbed to activates itself.
      const autoFocusIndex = actions.findIndex((a) => a.autoFocus && !a.disabled);
      const autoFocusButton = autoFocusIndex >= 0 ? buttonRefs.current[autoFocusIndex] : null;
      if (autoFocusButton && nativeEnterTarget === autoFocusButton) {
        return false;
      }
      return true;
    };

    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.isComposing) return;
      if (!isTopmostDialog()) return;
      if (shouldLetTargetHandleEnter(event.target)) return;

      const action = actions.find((item) => item.autoFocus && !item.disabled);
      if (!action) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      action.onClick();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [actions]);

  // Intercept Escape on the capture phase so ancestor handlers (e.g. the
  // image viewer, SlidePanel) don't also act on it. When the dialog is
  // closable, Escape closes the dialog and stops there. When `disableClose`
  // is set, the key is swallowed entirely.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!disableClose) {
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [disableClose, onClose]);

  return (
    <div
      ref={dialogRootRef}
      data-dialog-root="true"
      className={`fixed left-0 right-0 bg-black/50 flex ${alignClass} justify-center p-4 overscroll-contain`}
      style={{
        zIndex,
        top: fullscreen ? 0 : 'var(--top-bar-offset, 0px)',
        bottom: fullscreen ? 0 : 'var(--bottom-bar-offset, 0px)',
      }}
      onClick={handleBackdropClick}
      onTouchMove={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={dialogContentRef}
        className={`w-full ${SIZE_CLASS[size]} max-h-full flex flex-col rounded-xl shadow-lg p-4 ${surfaceClass} border border-white/10 text-slate-100`}
        onClick={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
        onKeyDown={handleContentKeyDown}
      >
        <div className="text-slate-100 text-base font-semibold shrink-0">{title}</div>
        {description && (
          <div className="text-slate-300 text-sm mt-1 overflow-y-auto overscroll-contain flex-1 min-h-0">
            {description}
          </div>
        )}
        <div className={`shrink-0 ${actionsLayout === 'stack' ? 'mt-4 flex flex-col gap-2' : 'mt-4 flex justify-end gap-2'}`}>
          {actions.map((action, idx) => (
            <button
              key={action.label}
              ref={(el) => { buttonRefs.current[idx] = el; }}
              className={`${defaultActionClass(action.variant)} ${action.className ?? ''} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900`.trim()}
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

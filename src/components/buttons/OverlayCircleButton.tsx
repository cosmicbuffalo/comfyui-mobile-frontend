import type { ReactNode } from 'react';

const overlayCircleBaseClassName =
  'pointer-events-auto w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
// The translucent disc backing, applied unless the button is `bare`.
const overlayCircleDiscClassName =
  'bg-black/40 hover:bg-black/60 disabled:hover:bg-black/40';

interface OverlayCircleButtonProps {
  icon: ReactNode;
  ariaLabel: string;
  onClick: () => void;
  disabled?: boolean;
  /** Native tooltip, useful to explain why a button is disabled. */
  title?: string;
  /** Extra classes appended to the base button class (e.g. text tone). */
  className?: string;
  /** aria-pressed state for toggle-style buttons. */
  ariaPressed?: boolean;
  /** Drop the translucent disc background — render just the bare icon. */
  bare?: boolean;
}

/**
 * Shared circular overlay icon-button used across media/output overlays.
 * Differs only by icon, aria-label, text color/tone, and optional state.
 */
export function OverlayCircleButton({
  icon,
  ariaLabel,
  onClick,
  disabled,
  title,
  className,
  ariaPressed,
  bare,
}: OverlayCircleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      disabled={disabled}
      title={title}
      className={`${overlayCircleBaseClassName}${bare ? '' : ` ${overlayCircleDiscClassName}`}${className ? ` ${className}` : ''}`}
    >
      {icon}
    </button>
  );
}

import type { ReactNode } from 'react';

const overlayCircleBaseClassName =
  'pointer-events-auto w-9 h-9 rounded-full bg-black/40 flex items-center justify-center hover:bg-black/60 transition-colors';

interface OverlayCircleButtonProps {
  icon: ReactNode;
  ariaLabel: string;
  onClick: () => void;
  disabled?: boolean;
  /** Extra classes appended to the base button class (e.g. text tone). */
  className?: string;
  /** aria-pressed state for toggle-style buttons. */
  ariaPressed?: boolean;
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
  className,
  ariaPressed,
}: OverlayCircleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      disabled={disabled}
      className={`${overlayCircleBaseClassName}${className ? ` ${className}` : ''}`}
    >
      {icon}
    </button>
  );
}

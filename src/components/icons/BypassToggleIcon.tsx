import type { IconProps } from './types';

export interface BypassToggleIconProps extends IconProps {
  isBypassed: boolean;
}

export function BypassToggleIcon({ isBypassed, ...props }: BypassToggleIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      {isBypassed ? (
        <>
          <path d="M5 12h14" />
          <path d="M12 5l7 7-7 7" />
        </>
      ) : (
        <path d="M18 6L6 18M6 6l12 12" />
      )}
    </svg>
  );
}

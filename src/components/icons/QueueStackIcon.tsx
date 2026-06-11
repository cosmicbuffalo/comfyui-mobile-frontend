import type { IconProps } from './types';

export interface QueueStackIconProps extends IconProps {
  showSlash?: boolean;
}

export function QueueStackIcon({ showSlash = false, ...props }: QueueStackIconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" overflow="visible" {...props}>
      {/* Nudged down 2 units; kept at x=0 so the (already symmetric) icon
          stays horizontally centered in the square. */}
      <g transform="translate(0 2)">
        <path d="M3.1 21.25V26.35" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M28.9 21.25V26.35" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <rect x="1.5" y="25.5" width="29" height="3" rx="1.5" fill="currentColor" />
        <rect x="7" y="5.4" width="18" height="2.5" rx="1.25" fill="currentColor" />
        <rect x="7" y="12.3" width="18" height="2.5" rx="1.25" fill="currentColor" />
        <rect x="7" y="19.1" width="18" height="2.5" rx="1.25" fill="currentColor" />
        <path d="M16 -4l6.5 5H9.5l6.5-5Z" fill="currentColor" />
        {showSlash && (
          <line x1="2" y1="30" x2="28" y2="4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        )}
      </g>
    </svg>
  );
}

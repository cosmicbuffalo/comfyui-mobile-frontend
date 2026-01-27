import type { IconProps } from './types';

export interface QueueStackIconProps extends IconProps {
  showSlash?: boolean;
}

export function QueueStackIcon({ showSlash = false, ...props }: QueueStackIconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" overflow="visible" {...props}>
      <path d="M28 28H4a2.002 2.002 0 0 1-2-2V21h2v5h24v-5h2v5a2.002 2.002 0 0 1-2 2Z" fill="currentColor" />
      <rect x="7" y="21" width="18" height="2" fill="currentColor" />
      <rect x="7" y="16" width="18" height="2" fill="currentColor" />
      <rect x="7" y="11" width="18" height="2" fill="currentColor" />
      <rect x="7" y="6" width="18" height="2" fill="currentColor" />
      <path d="M16 -3l5 4H11l5-4Z" fill="currentColor" />
      {showSlash && (
        <line x1="2" y1="30" x2="28" y2="4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      )}
    </svg>
  );
}

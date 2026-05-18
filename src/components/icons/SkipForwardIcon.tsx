import type { IconProps } from './types';

export function SkipForwardIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M3 6 L3 18 L11 12 Z" fill="currentColor" />
      <path d="M11 6 L11 18 L19 12 Z" fill="currentColor" />
      <rect x="19" y="5" width="2" height="14" rx="0.5" fill="currentColor" />
    </svg>
  );
}

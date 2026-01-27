import type { IconProps } from './types';

export function SaveDiskIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M5 4h12l3 3v13H4V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="7" y="4" width="8" height="4" fill="currentColor" />
      <rect x="7" y="13" width="10" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

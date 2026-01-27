import type { IconProps } from './types';

export function VideoCameraIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="3" y="7" width="12" height="10" rx="2" />
      <path d="M15 10l5-3v10l-5-3z" />
    </svg>
  );
}

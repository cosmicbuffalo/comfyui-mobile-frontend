import type { IconProps } from './types';

export function FunnelArrowsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {/* Funnel */}
      <path d="M19 4H5L10.5 10.5V17L13.5 19V10.5L19 4Z" />
      {/* Arrows */}
      <path d="M2.5 9L4.5 7L6.5 9" />
      <path d="M4.5 7V17" />
      <path d="M2.5 15L4.5 17L6.5 15" />
    </svg>
  );
}

import type { IconProps } from './types';

export function FunnelArrowsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      {/* Sort */}
      <path
        d="M3.6 11.4V21.2M1.4 19L3.6 21.2L5.8 19"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Funnel */}
      <path fill="currentColor" d="M22.62 0.65H1.33L10.25 10.89V21.81L14.24 24.02V10.89L22.62 0.65Z" />
    </svg>
  );
}

import type { IconProps } from './types';

export function XSmallIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path d="M4.2 4.2l7.6 7.6m0-7.6l-7.6 7.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

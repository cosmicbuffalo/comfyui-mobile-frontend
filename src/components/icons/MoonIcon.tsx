import type { IconProps } from './types';

export function MoonIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M21 14.5A9 9 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5Z" fill="currentColor" />
    </svg>
  );
}

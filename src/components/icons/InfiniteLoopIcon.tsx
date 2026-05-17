import type { IconProps } from './types';

export function InfiniteLoopIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" fill="none" {...props}>
      <path
        d="M16 16C12.7 10.8 10.3 9 7.5 9 4.5 9 2.5 11.6 2.5 16s2 7 5 7c2.8 0 5.2-1.8 8.5-7Zm0 0c3.3-5.2 5.7-7 8.5-7 3 0 5 2.6 5 7s-2 7-5 7c-2.8 0-5.2-1.8-8.5-7Z"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

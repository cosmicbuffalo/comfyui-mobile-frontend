import type { IconProps } from './types';

export function NodeConnectionsLegendIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <defs>
        <clipPath id="legend-trace-left">
          <rect x="0" y="0" width="12" height="24" />
        </clipPath>
        <clipPath id="legend-trace-right">
          <rect x="12" y="0" width="12" height="24" />
        </clipPath>
      </defs>
      <rect
        x="7"
        y="7"
        width="10"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        clipPath="url(#legend-trace-left)"
        className="text-gray-400"
      />
      <rect
        x="7"
        y="7"
        width="10"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        clipPath="url(#legend-trace-right)"
        className="text-orange-500"
      />
      <line x1="7" y1="12" x2="-4.25" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-gray-400" />
      <line x1="17" y1="12" x2="28.25" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-orange-500" />
    </svg>
  );
}

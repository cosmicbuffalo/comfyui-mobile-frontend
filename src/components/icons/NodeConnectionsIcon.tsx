import type { IconProps } from './types';

export interface NodeConnectionsIconProps extends IconProps {
  nodeId: number;
  connectionHighlightMode: 'off' | 'inputs' | 'outputs' | 'both';
  leftLineCount: number;
  rightLineCount: number;
}

export function NodeConnectionsIcon({
  nodeId,
  connectionHighlightMode,
  leftLineCount,
  rightLineCount,
  ...props
}: NodeConnectionsIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <defs>
        <clipPath id={`node-rect-left-${nodeId}`}>
          <rect x="0" y="0" width="12" height="24" />
        </clipPath>
        <clipPath id={`node-rect-right-${nodeId}`}>
          <rect x="12" y="0" width="12" height="24" />
        </clipPath>
      </defs>
      {connectionHighlightMode === 'off' ? (
        <rect x="7" y="7" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" fill="none" className="text-gray-500" />
      ) : (
        <>
          <rect
            x="7"
            y="7"
            width="10"
            height="10"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.6"
            fill="none"
            strokeLinejoin="round"
            clipPath={`url(#node-rect-left-${nodeId})`}
            className={connectionHighlightMode === 'inputs' || connectionHighlightMode === 'both' ? 'text-orange-500' : 'text-gray-500'}
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
            strokeLinejoin="round"
            clipPath={`url(#node-rect-right-${nodeId})`}
            className={connectionHighlightMode === 'outputs' || connectionHighlightMode === 'both' ? 'text-orange-500' : 'text-gray-500'}
          />
        </>
      )}
      <g className={connectionHighlightMode === 'inputs' || connectionHighlightMode === 'both' ? 'text-orange-500' : 'text-gray-500'}>
        {leftLineCount === 1 && (
          <line x1="7" y1="12" x2="-4.25" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        )}
        {leftLineCount === 2 && (
          <>
            <line x1="7" y1="12" x2="-4.25" y2="8.625" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="7" y1="12" x2="-4.25" y2="15.375" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </>
        )}
        {leftLineCount >= 3 && (
          <>
            <line x1="7" y1="12" x2="-4.25" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="7" y1="12" x2="-2.743" y2="6.375" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="7" y1="12" x2="-2.743" y2="17.625" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </>
        )}
      </g>
      <g className={connectionHighlightMode === 'outputs' || connectionHighlightMode === 'both' ? 'text-orange-500' : 'text-gray-500'}>
        {rightLineCount === 1 && (
          <line x1="17" y1="12" x2="28.25" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        )}
        {rightLineCount === 2 && (
          <>
            <line x1="17" y1="12" x2="28.25" y2="8.625" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="17" y1="12" x2="28.25" y2="15.375" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </>
        )}
        {rightLineCount >= 3 && (
          <>
            <line x1="17" y1="12" x2="28.25" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="17" y1="12" x2="26.743" y2="6.375" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="17" y1="12" x2="26.743" y2="17.625" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </>
        )}
      </g>
    </svg>
  );
}

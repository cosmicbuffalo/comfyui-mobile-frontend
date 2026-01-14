import type { SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement>;

export function InfoCircleIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 11V16M12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21ZM12.0498 8V8.1L11.9502 8.1002V8H12.0498Z" />
    </svg>
  );
}

export function DocumentIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M6 4h9l3 3v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M9 10h6M9 14h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function DocumentLinesIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M6 4h9l3 3v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M9 10h6M9 14h6M9 18h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyWorkflowIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M4 20h16M6 16l4-4m0 0l4-4m-4 4l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function InboxIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

export function EllipsisVerticalIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="12" cy="5" r="2" fill="currentColor" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="19" r="2" fill="currentColor" />
    </svg>
  );
}

export function CaretRightIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M10 17l5-5-5-5v10z" />
    </svg>
  );
}

export function CaretDownIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M7 10l5 5 5-5H7z" />
    </svg>
  );
}

export function XMarkIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M6 6l12 12M18 6l-12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path d="M6.4 11.2L3.2 8l1.1-1.1 2.1 2.1 5-5L12.5 5l-6.1 6.2Z" fill="currentColor" />
    </svg>
  );
}

export function XSmallIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path d="M4.2 4.2l7.6 7.6m0-7.6l-7.6 7.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function CloudDownloadIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M7 18a4 4 0 0 1 0-8 6 6 0 0 1 11.3-2.2A4.5 4.5 0 0 1 18 18H7Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 10v7m0 0l-3-3m3 3l3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      <path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function CancelCircleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  );
}

export function ReloadIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      <path d="M23 4v6h-6M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

export function WorkflowLoadIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" d="M9.18613 3.09999H6.81377M9.18613 12.9H7.55288c-3.08678 0-5.35171-2.99581-4.60305-6.08843l.3054-1.26158M14.7486 2.1721l-.5931 2.45c-.132.54533-.6065.92789-1.1508.92789h-2.2993c-.77173 0-1.33797-.74895-1.1508-1.5221l.5931-2.45c.132-.54533.6065-.9279 1.1508-.9279h2.2993c.7717 0 1.3379.74896 1.1508 1.52211Zm-8.3033 0-.59309 2.45c-.13201.54533-.60646.92789-1.15076.92789H2.4021c-.7717 0-1.33793-.74895-1.15077-1.5221l.59309-2.45c.13201-.54533.60647-.9279 1.15077-.9279h2.29935c.77169 0 1.33792.74896 1.15076 1.52211Zm8.3033 9.8-.5931 2.45c-.132.5453-.6065.9279-1.1508.9279h-2.2993c-.77173 0-1.33797-.749-1.1508-1.5221l.5931-2.45c.132-.5453.6065-.9279 1.1508-.9279h2.2993c.7717 0 1.3379.7489 1.1508 1.5221Z"/>
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path d="M10.667 2.667c1.45.008 2.235.072 2.748.585C14 3.837 14 4.78 14 6.666v4c0 1.885 0 2.828-.585 3.414-.586.585-1.529.585-3.415.585H6c-1.886 0-2.829 0-3.414-.585C2 13.494 2 12.55 2 10.666v-4c0-1.886 0-2.829.586-3.414.512-.513 1.297-.577 2.747-.585" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M5.333 2.333c0-.552.448-1 1-1h3.334c.552 0 1 .448 1 1v.667c0 .553-.448 1-1 1H6.333c-.552 0-1-.447-1-1v-.667Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}

export function ClipboardIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <rect x="9" y="9" width="10" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

export function MinusCircleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M7 12h10" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M6 8l4 4 4-4" />
    </svg>
  );
}

export function BookmarkIconSvg(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export interface QueueStackIconProps extends IconProps {
  showSlash?: boolean;
}

export function QueueStackIcon({ showSlash = false, ...props }: QueueStackIconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" overflow="visible" {...props}>
      <path d="M28 28H4a2.002 2.002 0 0 1-2-2V21h2v5h24v-5h2v5a2.002 2.002 0 0 1-2 2Z" fill="currentColor" />
      <rect x="7" y="21" width="18" height="2" fill="currentColor" />
      <rect x="7" y="16" width="18" height="2" fill="currentColor" />
      <rect x="7" y="11" width="18" height="2" fill="currentColor" />
      <rect x="7" y="6" width="18" height="2" fill="currentColor" />
      <path d="M16 -3l5 4H11l5-4Z" fill="currentColor" />
      {showSlash && (
        <line x1="2" y1="30" x2="28" y2="4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      )}
    </svg>
  );
}

export interface ProgressRingProps extends IconProps {
  progress: number;
  radius?: number;
}

export function ProgressRing({ progress, radius = 11, ...props }: ProgressRingProps) {
  const normalized = Math.min(100, Math.max(0, progress));
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - normalized / 100);
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke="rgba(34,197,94,0.9)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function XIconSolid(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
    </svg>
  );
}

export function DiceIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="9" cy="9" r="1.5" fill="currentColor" />
      <circle cx="15" cy="15" r="1.5" fill="currentColor" />
      <circle cx="15" cy="9" r="1.5" fill="currentColor" />
      <circle cx="9" cy="15" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export function WarningTriangleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2L1 21h22L12 2zm0 3.5L19.5 19h-15L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
    </svg>
  );
}

export function BookmarkOutlineIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ChevronLeftBoldIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M15 19l-7-7 7-7" />
    </svg>
  );
}

export interface BypassToggleIconProps extends IconProps {
  isBypassed: boolean;
}

export function BypassToggleIcon({ isBypassed, ...props }: BypassToggleIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" {...props}>
      {isBypassed ? (
        <>
          <path d="M5 12h14" />
          <path d="M12 5l7 7-7 7" />
        </>
      ) : (
        <path d="M18 6L6 18M6 6l12 12" />
      )}
    </svg>
  );
}

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

export function TemplateIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" d="m14.6685 5.7416.6425-2.57c.2028-.811-.4106-1.5967-1.2466-1.5967H2.5782a1.285 1.285 0 0 0-1.2467.9733l-.6425 2.57c-.2027.8111.4107 1.5968 1.2467 1.5968h11.4861a1.285 1.285 0 0 0 1.2467-.9734Zm0 7.7102.6425-2.5701c.2028-.811-.4106-1.5967-1.2466-1.5967h-5.061a1.285 1.285 0 0 0-1.2467.9734l-.6425 2.5701c-.2028.811.4106 1.5966 1.2466 1.5966h5.061a1.285 1.285 0 0 0 1.2467-.9733Zm-10.2802 0 .6425-2.5701c.2027-.811-.4107-1.5967-1.2467-1.5967H2.5782a1.285 1.285 0 0 0-1.2467.9734L.689 12.8285c-.2027.811.4107 1.5966 1.2467 1.5966h1.206a1.285 1.285 0 0 0 1.2466-.9733Z"/>
    </svg>
  );
}

export function DownloadDeviceIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M12 3v10m0 0l-4-4m4 4l4-4M5 19h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function ClipboardDownloadIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path d="M10.667 2.667c1.45.008 2.235.072 2.748.585C14 3.837 14 4.78 14 6.666v4c0 1.885 0 2.828-.585 3.414-.586.585-1.529.585-3.415.585H6c-1.886 0-2.829 0-3.414-.585C2 13.494 2 12.55 2 10.666v-4c0-1.886 0-2.829.586-3.414.512-.513 1.297-.577 2.747-.585" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M5.333 2.333c0-.552.448-1 1-1h3.334c.552 0 1 .448 1 1v.667c0 .553-.448 1-1 1H6.333c-.552 0-1-.447-1-1v-.667Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M8 6.667v4.666m0 0L5.667 9m2.333 2.333L10.333 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M3 9h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SaveDiskIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M5 4h12l3 3v13H4V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <rect x="7" y="4" width="8" height="4" fill="currentColor" />
      <rect x="7" y="13" width="10" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

export function SaveAsIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path d="M12.667 14H3.333C2.597 14 2 13.403 2 12.667V3.333C2 2.597 2.597 2 3.333 2h7.334L14 5.333v7.334c0 .736-.597 1.333-1.333 1.333Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M11.333 14v-4H4.667v4M4.667 2v3.333h5.333" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M21 14.5A9 9 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5Z" fill="currentColor" />
    </svg>
  );
}

export function GithubIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

export function InfoCircleOutlineIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  );
}

export function HourglassIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M8 4h8M8 20h8M9 6h6l-1 4 1 4H9l1-4-1-4Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export interface ProgressRingWithTrackProps extends IconProps {
  progress: number;
  radius?: number;
  trackColor?: string;
  progressColor?: string;
}

export function ProgressRingWithTrack({
  progress,
  radius = 10,
  trackColor = '#e5e7eb',
  progressColor = '#3b82f6',
  ...props
}: ProgressRingWithTrackProps) {
  const normalized = Math.min(100, Math.max(0, progress));
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - normalized / 100);
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r={radius} fill="none" stroke={trackColor} strokeWidth="2" />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke={progressColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

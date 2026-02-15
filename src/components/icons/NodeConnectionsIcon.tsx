import type { IconProps } from "./types";
import { themeColors } from "@/theme/colors";

export interface NodeConnectionsIconProps extends IconProps {
  nodeId: number;
  connectionHighlightMode: "off" | "inputs" | "outputs" | "both";
  leftLineCount: number;
  rightLineCount: number;
  inactiveColor?: string;
  inputHighlightColor?: string;
  outputHighlightColor?: string;
  offLineColor?: string;
}

export function NodeConnectionsIcon({
  nodeId,
  connectionHighlightMode,
  leftLineCount,
  rightLineCount,
  inactiveColor = themeColors.text.secondary,
  inputHighlightColor = themeColors.status.danger,
  outputHighlightColor = themeColors.status.danger,
  offLineColor = inactiveColor,
  ...props
}: NodeConnectionsIconProps) {
  const inputActive =
    connectionHighlightMode === "inputs" || connectionHighlightMode === "both";
  const outputActive =
    connectionHighlightMode === "outputs" || connectionHighlightMode === "both";
  const leftColor = inputActive ? inputHighlightColor : offLineColor;
  const rightColor = outputActive ? outputHighlightColor : offLineColor;

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
      <>
        <rect
          x="7"
          y="7"
          width="10"
          height="10"
          rx="2"
          stroke={leftColor}
          strokeWidth="1.6"
          fill="none"
          strokeLinejoin="round"
          clipPath={`url(#node-rect-left-${nodeId})`}
        />
        <rect
          x="7"
          y="7"
          width="10"
          height="10"
          rx="2"
          stroke={rightColor}
          strokeWidth="1.6"
          fill="none"
          strokeLinejoin="round"
          clipPath={`url(#node-rect-right-${nodeId})`}
        />
      </>
      <g style={{ color: leftColor }}>
        {leftLineCount === 1 && (
          <line
            x1="7"
            y1="12"
            x2="-4.25"
            y2="12"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        )}
        {leftLineCount === 2 && (
          <>
            <line
              x1="7"
              y1="12"
              x2="-4.25"
              y2="8.625"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <line
              x1="7"
              y1="12"
              x2="-4.25"
              y2="15.375"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </>
        )}
        {leftLineCount >= 3 && (
          <>
            <line
              x1="7"
              y1="12"
              x2="-4.25"
              y2="12"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <line
              x1="7"
              y1="12"
              x2="-2.743"
              y2="6.375"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <line
              x1="7"
              y1="12"
              x2="-2.743"
              y2="17.625"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </>
        )}
      </g>
      <g style={{ color: rightColor }}>
        {rightLineCount === 1 && (
          <line
            x1="17"
            y1="12"
            x2="28.25"
            y2="12"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        )}
        {rightLineCount === 2 && (
          <>
            <line
              x1="17"
              y1="12"
              x2="28.25"
              y2="8.625"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <line
              x1="17"
              y1="12"
              x2="28.25"
              y2="15.375"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </>
        )}
        {rightLineCount >= 3 && (
          <>
            <line
              x1="17"
              y1="12"
              x2="28.25"
              y2="12"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <line
              x1="17"
              y1="12"
              x2="26.743"
              y2="6.375"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <line
              x1="17"
              y1="12"
              x2="26.743"
              y2="17.625"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </>
        )}
      </g>
    </svg>
  );
}

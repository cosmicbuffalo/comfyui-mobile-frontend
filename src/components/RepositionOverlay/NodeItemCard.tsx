import type { CSSProperties } from "react";
import { MenuIcon } from "@/components/icons";

interface NodeItemCardProps {
  dataKey: string;
  nodeId: number;
  displayName: string;
  isTarget: boolean;
  isBypassed: boolean;
  isDragging: boolean;
  borderClass: string;
  borderStyle?: CSSProperties;
  isHighlighted: boolean;
}

export function NodeItemCard({
  dataKey,
  nodeId,
  displayName,
  isTarget,
  isBypassed,
  isDragging,
  borderClass,
  borderStyle,
  isHighlighted,
}: NodeItemCardProps) {
  return (
    <div
      key={dataKey}
      className={`flex min-h-10 items-center gap-1 rounded-xl border-2 px-3 py-1 mb-3 shadow-md select-none ${borderClass} ${
        isBypassed ? "bg-purple-200" : "bg-white"
      } ${isHighlighted && !isTarget ? "ring-2 ring-blue-500 transition-all" : ""}`}
      style={
        isTarget
          ? {
              ...(borderStyle ?? {}),
              touchAction: "none",
              animation: isDragging
                ? "none"
                : "node-card-wiggle 180ms ease-in-out infinite alternate",
            }
          : borderStyle
      }
      data-reposition-item={dataKey}
    >
      <span
        data-reposition-handle={dataKey}
        className="touch-none flex h-8 w-8 items-center justify-center -ml-2 shrink-0"
      >
        <MenuIcon
          className={`w-5 h-5 ${isTarget ? "text-blue-500" : "text-gray-300"}`}
        />
      </span>
      <span className="font-semibold min-w-0 flex-1 truncate text-gray-900">
        {displayName}
      </span>
      <span className="text-xs text-gray-400 shrink-0">#{nodeId}</span>
    </div>
  );
}

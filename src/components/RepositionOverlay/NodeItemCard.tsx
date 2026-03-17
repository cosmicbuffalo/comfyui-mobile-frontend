import type { CSSProperties, ReactNode } from "react";
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
  rightIcon?: ReactNode;
  bgClassName?: string;
  /** Inline background color (e.g. node tint). Overrides bgClassName when set. */
  tintColor?: string;
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
  rightIcon,
  bgClassName,
  tintColor,
}: NodeItemCardProps) {
  const bg = bgClassName ?? (isBypassed ? "bg-purple-200" : "bg-white");
  const combinedStyle: CSSProperties = {
    ...(borderStyle ?? {}),
    ...(tintColor ? { backgroundColor: tintColor } : {}),
    ...(isTarget
      ? {
          touchAction: "none" as const,
          animation: isDragging
            ? "none"
            : "node-card-wiggle 180ms ease-in-out infinite alternate",
        }
      : {}),
  };
  return (
    <div
      className="rounded-xl mb-3 bg-white dark:bg-neutral-900"
      data-reposition-item={dataKey}
    >
      <div
        key={dataKey}
        className={`flex min-h-10 items-center gap-1 rounded-xl border-2 px-3 py-1 shadow-md select-none ${borderClass} ${bg} ${isHighlighted && !isTarget ? "ring-2 ring-blue-500 transition-all" : ""}`}
        style={Object.keys(combinedStyle).length > 0 ? combinedStyle : undefined}
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
        {rightIcon && (
          <span className="shrink-0 ml-1">{rightIcon}</span>
        )}
        <span className="text-xs text-gray-400 shrink-0">#{nodeId}</span>
      </div>
    </div>
  );
}

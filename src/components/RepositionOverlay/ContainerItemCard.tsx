import type { ReactNode } from "react";
import { CaretDownIcon, MenuIcon } from "@/components/icons";
import { FoldIcon } from "@/components/FoldIcon";
import { themeColors } from "@/theme/colors";
import { hexToRgba } from "@/utils/grouping";

interface ContainerItemCardProps {
  containerType: "group" | "subgraph";
  containerDataKey: string;
  dataKey: string;
  title: string;
  nodeCount: number;
  isTarget: boolean;
  isCollapsed: boolean;
  canToggleCollapse: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  isHighlighted: boolean;
  color: string;
  allBypassed?: boolean;
  onToggleCollapse: () => void;
  childrenContent: ReactNode;
}

export function ContainerItemCard({
  containerType,
  containerDataKey,
  dataKey,
  title,
  nodeCount,
  isTarget,
  isCollapsed,
  canToggleCollapse,
  isDragging,
  isDropTarget,
  isHighlighted,
  color,
  allBypassed,
  onToggleCollapse,
  childrenContent,
}: ContainerItemCardProps) {
  const bypassPurple = themeColors.brand.bypassPurple;
  const backgroundColor = allBypassed ? hexToRgba(bypassPurple, 0.12) : hexToRgba(color, 0.15);
  const borderColor = allBypassed ? hexToRgba(bypassPurple, 0.3) : hexToRgba(color, 0.3);
  const headerBackgroundColor = allBypassed ? hexToRgba(bypassPurple, 0.12) : hexToRgba(color, 0.15);
  const nodeCountLabel = `${nodeCount} node${nodeCount !== 1 ? "s" : ""}${
    containerType === "subgraph" ? " (subgraph)" : ""
  }`;

  return (
    <div
      className="rounded-xl mb-3 bg-slate-950/40"
      data-reposition-item={dataKey}
    >
      <div
        data-container-type={containerType}
        className={`rounded-xl shadow-md ${isDragging ? "overflow-visible" : "overflow-hidden"} transition-shadow ${
          isTarget ? "border-cyan-400 border-2 ring-2 ring-cyan-400/70" : "border"
        } ${isHighlighted && !isTarget ? "ring-2 ring-cyan-400 transition-all" : ""} ${
          isDropTarget ? "ring-2 ring-cyan-300 ring-dashed" : ""
        }`}
        style={{
          backgroundColor,
          borderColor,
          ...(isTarget ? { touchAction: "none" } : {}),
          ...(isTarget
            ? {
                animation: isDragging
                  ? "none"
                  : "node-card-wiggle 180ms ease-in-out infinite alternate",
              }
            : {}),
        }}
      >
        <div
          data-reposition-header={containerDataKey}
          className={`flex items-center justify-between cursor-pointer gap-1 px-3 py-2 ${
            isCollapsed ? "rounded-xl" : "rounded-t-xl mb-2"
          }`}
          style={{
            backgroundColor: headerBackgroundColor,
            borderColor,
          }}
          onClick={(e) => {
            if (!canToggleCollapse) return;
            e.stopPropagation();
            onToggleCollapse();
          }}
        >
          <span
            data-reposition-handle={dataKey}
            className="touch-none w-5 h-5 flex items-center justify-center shrink-0"
          >
            <MenuIcon className={`w-5 h-5 ${isTarget ? "text-cyan-300" : "text-slate-400"}`} />
          </span>
          <span className="font-semibold text-slate-100 flex-1 min-w-0 truncate">
            {title}
          </span>
          <span className="ml-auto text-sm shrink-0 text-slate-400">
            {nodeCountLabel}
          </span>
          <FoldIcon
            open={!isCollapsed}
            className={`w-6 h-6 shrink-0 ${canToggleCollapse ? "text-slate-400" : "text-slate-500 opacity-50"}`}
          />
        </div>
        {childrenContent}
        {!isCollapsed && (
          <div
            data-reposition-footer={containerDataKey}
            className={`px-3 py-1.5 rounded-b-xl select-none ${canToggleCollapse ? "cursor-pointer" : ""}`}
            style={{
              backgroundColor: headerBackgroundColor,
              borderColor,
            }}
            onClick={(e) => {
              if (!canToggleCollapse) return;
              e.stopPropagation();
              onToggleCollapse();
            }}
          >
            <div className="flex items-center">
              <span className="text-xs flex-1 min-w-0 truncate text-slate-400">
                {title}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <span className="text-xs shrink-0 text-slate-400">
                  {nodeCountLabel}
                </span>
                <CaretDownIcon className={`w-6 h-6 shrink-0 rotate-180 ${canToggleCollapse ? "text-slate-400" : "text-slate-500 opacity-50"}`} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

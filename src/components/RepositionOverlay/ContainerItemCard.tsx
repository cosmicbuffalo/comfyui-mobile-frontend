import type { ReactNode } from "react";
import { CaretDownIcon, CaretRightIcon, MenuIcon } from "@/components/icons";

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
  backgroundColor: string;
  borderColor?: string;
  headerBackgroundColor: string;
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
  backgroundColor,
  borderColor,
  headerBackgroundColor,
  onToggleCollapse,
  childrenContent,
}: ContainerItemCardProps) {
  const nodeCountLabel = `${nodeCount} node${nodeCount !== 1 ? "s" : ""}${
    containerType === "subgraph" ? " (subgraph)" : ""
  }`;

  return (
    <div
      data-container-type={containerType}
      className={`rounded-xl mb-3 shadow-md ${isDragging ? "overflow-visible" : "overflow-hidden"} transition-shadow ${
        isTarget ? "border-blue-500 border-2 ring-2 ring-blue-400" : "border"
      } ${isHighlighted && !isTarget ? "ring-2 ring-blue-500 transition-all" : ""} ${
        isDropTarget ? "ring-2 ring-blue-300 ring-dashed" : ""
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
      data-reposition-item={dataKey}
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
          className="touch-none w-8 h-8 -ml-2 flex items-center justify-center shrink-0"
        >
          <MenuIcon className={`w-5 h-5 ${isTarget ? "text-blue-500" : "text-gray-500"}`} />
        </span>
        <span className="font-semibold text-gray-900 flex-1 min-w-0 truncate">
          {title}
        </span>
        <span className="ml-auto text-sm shrink-0 text-gray-500">
          {nodeCountLabel}
        </span>
        {isCollapsed ? (
          <CaretRightIcon className={`w-6 h-6 shrink-0 ${canToggleCollapse ? "text-gray-500" : "text-gray-500 opacity-50"}`} />
        ) : (
          <CaretDownIcon className={`w-6 h-6 shrink-0 text-gray-500`} />
        )}
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
            <span className="text-xs flex-1 min-w-0 truncate text-gray-500">
              {title}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <span className="text-xs shrink-0 text-gray-500">
                {nodeCountLabel}
              </span>
              <CaretDownIcon className={`w-6 h-6 shrink-0 rotate-180 ${canToggleCollapse ? "text-gray-500" : "text-gray-500 opacity-50"}`} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

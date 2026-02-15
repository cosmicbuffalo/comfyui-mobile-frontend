import { NodeConnectionsIcon } from "@/components/icons";
import { themeColors } from "@/theme/colors";

interface RepositionOverlayTopBarProps {
  nodeId: number;
  canShowConnectionsToggle: boolean;
  connectionHighlightEnabled: boolean;
  onToggleConnections: () => void;
  connectionMode: "off" | "inputs" | "outputs" | "both";
  leftLineCount: number;
  rightLineCount: number;
  inputHighlightColor: string;
  outputHighlightColor: string;
}

export function RepositionOverlayTopBar({
  nodeId,
  canShowConnectionsToggle,
  connectionHighlightEnabled,
  onToggleConnections,
  connectionMode,
  leftLineCount,
  rightLineCount,
  inputHighlightColor,
  outputHighlightColor,
}: RepositionOverlayTopBarProps) {
  return (
    <div
      className="bg-white border-b border-gray-200"
      style={{ height: "var(--top-bar-offset, 69px)" }}
    >
      <div className="h-full px-4 flex items-center justify-between">
        <div className="w-10 h-10" />
        <h2 className="text-lg font-semibold text-gray-900 text-center">
          Reposition Nodes
        </h2>
        <div className="w-10 h-10 flex items-center justify-center">
          {canShowConnectionsToggle && (
            <button
              type="button"
              className="w-8 h-8 flex items-center justify-center"
              aria-label="Highlight node connections"
              aria-pressed={connectionHighlightEnabled}
              onClick={onToggleConnections}
            >
              <NodeConnectionsIcon
                className="w-6 h-6 overflow-visible"
                nodeId={nodeId}
                connectionHighlightMode={connectionMode}
                leftLineCount={leftLineCount}
                rightLineCount={rightLineCount}
                inactiveColor={themeColors.text.secondary}
                offLineColor={themeColors.text.secondary}
                inputHighlightColor={inputHighlightColor}
                outputHighlightColor={outputHighlightColor}
              />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

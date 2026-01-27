import { InfoIcon } from "@/components/icons/InfoIcon";
import { ThickArrowRightIcon, TrashIcon, WorkflowLoadIcon } from "@/components/icons";
import type { ViewerImage } from "@/utils/viewerImages";

interface MediaViewerActionsProps {
  isVideo: boolean;
  onDelete?: (item: ViewerImage) => void;
  onLoadWorkflow?: (item: ViewerImage) => void;
  onLoadInWorkflow?: (item: ViewerImage) => void;
  showMetadataToggle?: boolean;
  canToggleMetadata: boolean;
  onDeleteClick: () => void;
  onLoadWorkflowClick: () => void;
  onLoadInWorkflowClick: () => void;
  onToggleMetadata: () => void;
}

export function MediaViewerActions({
  isVideo,
  onDelete,
  onLoadWorkflow,
  onLoadInWorkflow,
  showMetadataToggle,
  canToggleMetadata,
  onDeleteClick,
  onLoadWorkflowClick,
  onLoadInWorkflowClick,
  onToggleMetadata,
}: MediaViewerActionsProps) {
  return (
    <div
      className="absolute inset-x-0 px-3 pb-2 pt-2 flex items-center justify-between"
      style={{ bottom: "calc(var(--bottom-bar-offset, 0px) + 4px)" }}
    >
      <button
        className={`pointer-events-auto w-9 h-9 rounded-full bg-black/40 text-red-500 flex items-center justify-center hover:bg-black/60 transition-colors ${
          onDelete ? "" : "opacity-40 pointer-events-none"
        }`}
        onClick={onDeleteClick}
        aria-label="Delete output"
      >
        <TrashIcon className="w-5 h-5" />
      </button>
      {!isVideo && (
        <div className="flex items-center gap-2">
          <button
            className={`pointer-events-auto w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition-colors ${
              onLoadWorkflow ? "" : "opacity-40 pointer-events-none"
            }`}
            onClick={onLoadWorkflowClick}
            aria-label="Load workflow"
          >
            <WorkflowLoadIcon className="w-5 h-5" />
          </button>
          <button
            className={`pointer-events-auto w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition-colors ${
              onLoadInWorkflow ? "" : "opacity-40 pointer-events-none"
            }`}
            onClick={onLoadInWorkflowClick}
            aria-label="Use in workflow"
          >
            <ThickArrowRightIcon className="w-5 h-5" />
          </button>
          {showMetadataToggle && (
            <button
              className={`pointer-events-auto w-9 h-9 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60 transition-colors ${
                canToggleMetadata ? "" : "opacity-40 pointer-events-none"
              }`}
              onClick={onToggleMetadata}
              aria-label="Toggle metadata"
            >
              <InfoIcon className="w-5 h-5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

import { DeleteButton } from "@/components/buttons/DeleteButton";
import { LoadWorkflowButton } from "@/components/buttons/LoadWorkflowButton";
import { UseInWorkflowButton } from "@/components/buttons/UseInWorkflowButton";
import { MetadataButton } from "@/components/buttons/MetadataButton";

interface MediaViewerActionsProps {
  isVideo: boolean;
  canLoadWorkflow: boolean;
  showMetadataToggle?: boolean;
  canToggleMetadata: boolean;
  onDelete: () => void;
  onLoadWorkflow: () => void;
  onUseInWorkflow: () => void;
  onToggleMetadata: () => void;
}

export function MediaViewerActions({
  isVideo,
  canLoadWorkflow,
  showMetadataToggle,
  canToggleMetadata,
  onDelete,
  onLoadWorkflow,
  onUseInWorkflow,
  onToggleMetadata,
}: MediaViewerActionsProps) {
  return (
    <div
      className="absolute inset-x-0 px-3 pb-2 pt-2 flex items-center justify-between"
      style={{ bottom: "calc(var(--bottom-bar-offset, 0px) + 4px)" }}
    >
      <DeleteButton onClick={onDelete} />
      <div className="flex items-center gap-2">
        {canLoadWorkflow && <LoadWorkflowButton onClick={onLoadWorkflow} />}
        {!isVideo && (
          <>
          <UseInWorkflowButton onClick={onUseInWorkflow} />
          {showMetadataToggle && (
            <MetadataButton
              onClick={onToggleMetadata}
              disabled={!canToggleMetadata}
            />
          )}
          </>
        )}
      </div>
    </div>
  );
}

import { DeleteButton } from "@/components/buttons/DeleteButton";
import { FavoriteButton } from "@/components/buttons/FavoriteButton";
import { LoadWorkflowButton } from "@/components/buttons/LoadWorkflowButton";
import { UseInWorkflowButton } from "@/components/buttons/UseInWorkflowButton";
import { MetadataButton } from "@/components/buttons/MetadataButton";

interface MediaViewerActionsProps {
  isVideo: boolean;
  canLoadWorkflow: boolean;
  showMetadataToggle?: boolean;
  canToggleMetadata: boolean;
  canFavorite: boolean;
  isFavorited: boolean;
  onDelete: () => void;
  onLoadWorkflow: () => void;
  onUseInWorkflow: () => void;
  onToggleMetadata: () => void;
  onToggleFavorite: () => void;
}

export function MediaViewerActions({
  isVideo,
  canLoadWorkflow,
  showMetadataToggle,
  canToggleMetadata,
  canFavorite,
  isFavorited,
  onDelete,
  onLoadWorkflow,
  onUseInWorkflow,
  onToggleMetadata,
  onToggleFavorite,
}: MediaViewerActionsProps) {
  return (
    <div
      className="absolute inset-x-0 px-3 pb-2 pt-2 flex items-center justify-between"
      style={{ bottom: "calc(var(--bottom-bar-offset, 0px) + 4px)" }}
    >
      <DeleteButton onClick={onDelete} />
      <div className="flex items-center gap-2">
        {canFavorite && (
          <FavoriteButton onClick={onToggleFavorite} isFavorited={isFavorited} />
        )}
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

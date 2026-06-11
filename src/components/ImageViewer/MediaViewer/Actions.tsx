import { DeleteButton } from "@/components/buttons/DeleteButton";
import { DownloadButton } from "@/components/buttons/DownloadButton";
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
  canDownload: boolean;
  loadWorkflowProgress?: number | null;
  onDelete: () => void;
  onLoadWorkflow: () => void;
  onUseInWorkflow: () => void;
  onToggleMetadata: () => void;
  onToggleFavorite: () => void;
  onDownload: () => void;
}

export function MediaViewerActions({
  isVideo,
  canLoadWorkflow,
  showMetadataToggle,
  canToggleMetadata,
  canFavorite,
  isFavorited,
  canDownload,
  loadWorkflowProgress,
  onDelete,
  onLoadWorkflow,
  onUseInWorkflow,
  onToggleMetadata,
  onToggleFavorite,
  onDownload,
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
        {canDownload && <DownloadButton onClick={onDownload} />}
        {canLoadWorkflow && (
          <LoadWorkflowButton
            onClick={onLoadWorkflow}
            progress={loadWorkflowProgress}
          />
        )}
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

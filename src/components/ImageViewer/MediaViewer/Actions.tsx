import { DeleteButton } from "@/components/buttons/DeleteButton";
import { DownloadButton } from "@/components/buttons/DownloadButton";
import { FavoriteButton } from "@/components/buttons/FavoriteButton";
import { RejectButton } from "@/components/buttons/RejectButton";
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
  canReject: boolean;
  isRejected: boolean;
  canDownload: boolean;
  deleteDisabled?: boolean;
  loadWorkflowProgress?: number | null;
  onDelete: () => void;
  onLoadWorkflow: () => void;
  onUseInWorkflow: () => void;
  onToggleMetadata: () => void;
  onToggleFavorite: () => void;
  onReject: () => void;
  onDownload: () => void | Promise<void>;
  // Forwarded to the download button for the per-device download-history badge
  // (disk icon -> cloud "downloaded" indicator). That store ships with download
  // history in 3.1.1; in this release the id is threaded but nothing renders a
  // badge from it.
  downloadFileId?: string | null;
  // Bubbled from the DownloadButton: true while a save is in flight, so the
  // MediaViewer can pause its idle/auto-hide timer for the chrome overlay.
  onDownloadLoadingChange?: (loading: boolean) => void;
  // Inward shift for the right-side button group so it clears the pinned widget
  // sidebar. The left group (delete/reject) doesn't move.
  rightInset?: string;
}

export function MediaViewerActions({
  isVideo,
  canLoadWorkflow,
  showMetadataToggle,
  canToggleMetadata,
  canFavorite,
  isFavorited,
  canReject,
  isRejected,
  canDownload,
  deleteDisabled,
  loadWorkflowProgress,
  onDelete,
  onLoadWorkflow,
  onUseInWorkflow,
  onToggleMetadata,
  onToggleFavorite,
  onReject,
  onDownload,
  downloadFileId,
  onDownloadLoadingChange,
  rightInset,
}: MediaViewerActionsProps) {
  return (
    <div
      className="absolute inset-x-0 px-3 pb-2 pt-2 flex items-center justify-between"
      style={{ bottom: "calc(var(--bottom-bar-offset, 0px) + 4px)" }}
    >
      <div className="flex items-center gap-2">
        <DeleteButton onClick={onDelete} disabled={deleteDisabled} />
        {canReject && (
          <RejectButton
            onClick={onReject}
            isRejected={isRejected}
            isFavorited={isFavorited}
          />
        )}
      </div>
      <div className="flex items-center gap-2" style={{ marginRight: rightInset }}>
        {canFavorite && (
          <FavoriteButton onClick={onToggleFavorite} isFavorited={isFavorited} />
        )}
        {canDownload && (
          <DownloadButton
            onClick={onDownload}
            fileId={downloadFileId}
            onLoadingChange={onDownloadLoadingChange}
          />
        )}
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

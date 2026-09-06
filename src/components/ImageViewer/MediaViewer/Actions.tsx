import { DeleteButton } from "@/components/buttons/DeleteButton";
import { DownloadButton } from "@/components/buttons/DownloadButton";
import { FavoriteButton } from "@/components/buttons/FavoriteButton";
import { RejectButton } from "@/components/buttons/RejectButton";
import { LoadWorkflowButton } from "@/components/buttons/LoadWorkflowButton";
import { UseInWorkflowButton } from "@/components/buttons/UseInWorkflowButton";
import { MetadataButton } from "@/components/buttons/MetadataButton";
import { SelectionCheckMark } from '@/components/buttons/SelectionCheckbox';
import { OverlayCircleButton } from '@/components/buttons/OverlayCircleButton';
import { useI18n } from '@/i18n';

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
  /** Omitted when the item cannot be masked (a video, or no file behind it). */
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
  /**
   * Select mode strips this row back to the controls that make sense while
   * picking items: reject, favorite, the metadata toggle, and the selection
   * checkbox. Everything that acts on a single file (delete, download, load
   * into a workflow, mask) is hidden, because in select mode the bottom bar's
   * selection actions operate on the whole set instead.
   */
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: () => void;
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
  selectionMode = false,
  isSelected = false,
  onToggleSelection,
}: MediaViewerActionsProps) {
  const { t } = useI18n();
  return (
    <div
      className="absolute inset-x-0 px-3 pb-2 pt-2 flex items-center justify-between"
      style={{ bottom: "calc(var(--bottom-bar-offset, 0px) + 4px)" }}
    >
      <div className="flex items-center gap-2">
        {!selectionMode && <DeleteButton onClick={onDelete} disabled={deleteDisabled} />}
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
        {!selectionMode && canDownload && (
          <DownloadButton
            onClick={onDownload}
            fileId={downloadFileId}
            onLoadingChange={onDownloadLoadingChange}
          />
        )}
        {!selectionMode && canLoadWorkflow && (
          <LoadWorkflowButton
            onClick={onLoadWorkflow}
            progress={loadWorkflowProgress}
          />
        )}
        {!isVideo && (
          <>
          {!selectionMode && <UseInWorkflowButton onClick={onUseInWorkflow} />}
          {showMetadataToggle && (
            <MetadataButton
              onClick={onToggleMetadata}
              disabled={!canToggleMetadata}
            />
          )}
          </>
        )}
        {/* Rightmost in this corner, so the checkbox sits where the thumb
            already is for selection work. Built on OverlayCircleButton like
            every other control here: that is what supplies the matching 36px
            disc and, crucially, pointer-events-auto — the chrome layer above
            is pointer-events-none, so a bare button here is unclickable. */}
        {selectionMode && onToggleSelection && (
          <OverlayCircleButton
            onClick={onToggleSelection}
            ariaLabel={isSelected ? t('Deselect image') : t('Select image')}
            ariaPressed={isSelected}
            className="text-white"
            icon={<SelectionCheckMark selected={isSelected} unselectedBorderClassName="border-white/80" />}
          />
        )}
      </div>
    </div>
  );
}

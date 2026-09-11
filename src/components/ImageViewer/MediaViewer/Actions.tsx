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
  /**
   * Label for the "take this one" button offered by whatever opened the viewer
   * (the input picker). Absent for an ordinary viewing session.
   */
  pickLabel?: string;
  /** Absent when the item on screen isn't something the picker can accept. */
  onPick?: () => void;
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
  pickLabel,
  onPick,
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
  // Picking is a mode, the way select mode is, and it strips the row for the
  // same reason: the viewer has been opened to answer one question, so the
  // controls that act on the file as a destination — delete, download, and the
  // two "take this into the workflow" buttons the pick button supersedes — are
  // noise in front of it, and the room they take is what stops the answer being
  // centred. Reject, favourite and the metadata toggle stay: triaging and
  // checking what made a file are part of choosing between them.
  const picking = !selectionMode && Boolean(pickLabel && onPick);
  return (
    <div
      className="absolute inset-x-0 px-3 pb-2 pt-2 flex items-center justify-between"
      style={{ bottom: "calc(var(--bottom-bar-offset, 0px) + 4px)" }}
    >
      <div className="flex items-center gap-2">
        {!selectionMode && !picking && (
          <DeleteButton onClick={onDelete} disabled={deleteDisabled} />
        )}
        {canReject && (
          <RejectButton
            onClick={onReject}
            isRejected={isRejected}
            isFavorited={isFavorited}
          />
        )}
      </div>
      {/* Centred on the ROW, not between the two groups: absolute positioning
          is what keeps it on the screen's midline however wide the side groups
          happen to be, which a middle flex child cannot promise. */}
      {picking && (
        <button
          type="button"
          onClick={onPick}
          className="viewer-pick-action pointer-events-auto absolute left-1/2 -translate-x-1/2 h-9 rounded-full bg-cyan-500 px-5 text-sm font-semibold text-slate-950 shadow-lg transition-colors hover:bg-cyan-400"
        >
          {pickLabel}
        </button>
      )}
      <div className="flex items-center gap-2" style={{ marginRight: rightInset }}>
        {canFavorite && (
          <FavoriteButton onClick={onToggleFavorite} isFavorited={isFavorited} />
        )}
        {!selectionMode && !picking && canDownload && (
          <DownloadButton
            onClick={onDownload}
            fileId={downloadFileId}
            onLoadingChange={onDownloadLoadingChange}
          />
        )}
        {!selectionMode && !picking && canLoadWorkflow && (
          <LoadWorkflowButton
            onClick={onLoadWorkflow}
            progress={loadWorkflowProgress}
          />
        )}
        {!isVideo && !selectionMode && !picking && (
          <UseInWorkflowButton onClick={onUseInWorkflow} />
        )}
        {/* Not image-only: a video whose item carries its own run metadata
            gets the toggle too — the caller passes showMetadataToggle=false
            for a video with nothing of its own to show. */}
        {showMetadataToggle && (
          <MetadataButton
            onClick={onToggleMetadata}
            disabled={!canToggleMetadata}
          />
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

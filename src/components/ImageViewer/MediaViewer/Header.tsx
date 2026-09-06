import { useI18n } from '@/i18n';

interface MediaViewerHeaderProps {
  index: number;
  total: number;
  displayName: string;
  resolution?: { width: number; height: number } | null;
  // Inward shift for the right-side cell so it clears the pinned widget sidebar.
  rightInset?: string;
  /**
   * Live selection count while select mode is active. Shown under the filename
   * so the tally stays visible without leaving the viewer.
   */
  selectionCount?: number | null;
}

export function MediaViewerHeader({
  index, total, displayName, resolution, rightInset, selectionCount,
}: MediaViewerHeaderProps) {
  const { t } = useI18n();
  return (
    <div
      id="media-viewer-header"
      className="absolute top-0 inset-x-0 px-3 pt-3 pb-8 bg-gradient-to-b from-black/85 via-black/45 to-transparent"
    >
      <div className="grid grid-cols-3 items-start">
        <div className="flex items-center gap-3 text-white text-sm">
          {index + 1} / {total}
        </div>
        <div className="justify-self-center text-center max-w-[70vw] min-w-0">
          <div className="text-white/90 text-sm font-medium truncate">
            {displayName}
          </div>
          {resolution && (
            <div className="media-viewer-resolution text-white/55 text-xs mt-0.5">
              {resolution.width} × {resolution.height}
            </div>
          )}
          {selectionCount !== null && selectionCount !== undefined && (
            <div className="media-viewer-selection-count text-cyan-300 text-xs mt-0.5 font-medium">
              {selectionCount === 1
                ? t('1 item selected')
                : t('{count} items selected', { count: selectionCount })}
            </div>
          )}
        </div>
        {/* Right cell intentionally empty — the DownloadedBadge used to live
            here but it overlapped the floating Close (X) button, swallowing
            taps on the X once a file was marked downloaded. The downloaded
            state is now surfaced on the DownloadButton in the action row;
            tapping that button opens the same DownloadInfoModal. */}
        <div className="justify-self-end pointer-events-auto" style={{ marginRight: rightInset }} />
      </div>
    </div>
  );
}

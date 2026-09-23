import { useI18n } from '@/i18n';
import { isVideoFormatError } from '@/utils/mediaDiagnostics';

interface VideoPlaybackUnavailableProps {
  /** `MediaError.code` from the failed element; null when the browser gave none. */
  errorCode: number | null;
  /** The file itself is gone (a 404 probe), so its format is beside the point. */
  missing?: boolean;
  className?: string;
}

/**
 * Shown after a video element reports a playback error. Videos are served in
 * their original format with no server-side conversion, so when the failure
 * looks like a format problem the notice points at the fix the user controls:
 * the format their workflow saves.
 */
export function VideoPlaybackUnavailable({
  errorCode,
  missing = false,
  className = '',
}: VideoPlaybackUnavailableProps) {
  const { t } = useI18n();
  const detail = missing
    ? t('It may have been moved, renamed, or deleted.')
    : isVideoFormatError(errorCode)
      ? t("Your browser can't play this video format. Save videos as H.264 MP4 to play them here.")
      : null;

  return (
    <div className={className} role="status">
      <div>{t('Unable to play this video.')}</div>
      {detail && <div className="mt-1 text-xs text-white/75">{detail}</div>}
    </div>
  );
}

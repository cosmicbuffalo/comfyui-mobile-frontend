import { PauseIcon, PlayIcon } from '@/components/icons';
import { useI18n } from '@/i18n';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

interface VideoPlaybackControlsProps {
  playing: boolean;
  currentTime: number;
  duration: number;
  videoWidth?: number;
  /**
   * True while the viewer chrome is faded out. The parent overlay hides these
   * controls with opacity only, and opacity does not disable hit-testing — an
   * invisible play/pause disc at screen centre would swallow the tap meant to
   * bring the chrome back (and centre-starting swipes with it).
   */
  isIdle: boolean;
  onTogglePlayback: () => void;
  onSeek: (seconds: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
}

function formatPlaybackTime(seconds: number): string {
  const wholeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = wholeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function VideoPlaybackControls({
  playing,
  currentTime,
  duration,
  videoWidth,
  isIdle,
  onTogglePlayback,
  onSeek,
  onInteractionStart,
  onInteractionEnd,
}: VideoPlaybackControlsProps) {
  const { t } = useI18n();
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const scrubbingRef = useRef(false);
  const scrubTimeRef = useRef(0);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime = Math.min(
    safeDuration || Math.max(0, currentTime),
    Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0,
  );
  const displayedTime = scrubbing ? scrubTime : safeCurrentTime;
  const timelineStyle = {
    '--video-progress': `${safeDuration > 0 ? (displayedTime / safeDuration) * 100 : 0}%`,
  } as CSSProperties;

  const finishScrub = useCallback(() => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    setScrubbing(false);
    // Commit exactly once on release. Repeatedly assigning video.currentTime
    // for every pointer move can overwhelm a remote/large video's decoder and
    // leave it indefinitely seeking.
    onSeek(scrubTimeRef.current);
    onInteractionEnd();
  }, [onInteractionEnd, onSeek]);

  useEffect(() => {
    if (!scrubbing) return;
    window.addEventListener('pointerup', finishScrub, { once: true });
    window.addEventListener('pointercancel', finishScrub, { once: true });
    return () => {
      window.removeEventListener('pointerup', finishScrub);
      window.removeEventListener('pointercancel', finishScrub);
    };
  }, [finishScrub, scrubbing]);

  const beginScrub = (event: React.PointerEvent<HTMLInputElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    scrubTimeRef.current = safeCurrentTime;
    setScrubTime(safeCurrentTime);
    scrubbingRef.current = true;
    setScrubbing(true);
    onInteractionStart();
  };

  const changeScrubTime = (nextTime: number) => {
    if (!Number.isFinite(nextTime)) return;
    const clampedTime = Math.max(0, Math.min(nextTime, safeDuration || nextTime));
    scrubTimeRef.current = clampedTime;
    if (scrubbingRef.current) {
      // Keep the thumb owned by the gesture. Live timeupdate events may still
      // arrive from the video, but they cannot pull a controlled range back
      // underneath the user's finger.
      setScrubTime(clampedTime);
      return;
    }
    // Keyboard changes do not have a pointer lifecycle, so commit immediately.
    onInteractionStart();
    onSeek(clampedTime);
    onInteractionEnd();
  };

  return (
    <>
      <button
        type="button"
        className={`video-playback-toggle ${isIdle ? 'pointer-events-none' : 'pointer-events-auto'} absolute left-1/2 top-[calc((100vh-var(--bottom-bar-offset,0px))/2)] flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/65`}
        aria-label={playing ? t('Pause') : t('Play')}
        aria-pressed={!playing}
        onClick={onTogglePlayback}
      >
        {playing
          ? <PauseIcon className="h-8 w-8" />
          : <PlayIcon className="ml-1 h-8 w-8" />}
      </button>

      <div
        className={`video-scrubber ${isIdle ? 'pointer-events-none' : 'pointer-events-auto'} absolute left-1/2 grid -translate-x-1/2 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 py-1.5 text-xs font-medium text-white/90 tabular-nums drop-shadow-lg`}
        style={{
          bottom: 'calc(var(--bottom-bar-offset, 0px) + 58px)',
          width: videoWidth && videoWidth > 0 ? `${videoWidth * 0.9}px` : '90%',
        }}
      >
        <span className="min-w-[3ch] text-right">{formatPlaybackTime(displayedTime)}</span>
        <input
          type="range"
          min={0}
          max={safeDuration || 0}
          step={0.01}
          value={displayedTime}
          disabled={safeDuration === 0}
          aria-label={t('Video timeline')}
          className="video-timeline-input h-6 min-w-0 cursor-pointer disabled:cursor-default disabled:opacity-50"
          style={timelineStyle}
          onPointerDown={beginScrub}
          onPointerUp={finishScrub}
          onPointerCancel={finishScrub}
          onChange={(event) => changeScrubTime(Number(event.currentTarget.value))}
        />
        <span className="min-w-[3ch]">{formatPlaybackTime(safeDuration)}</span>
      </div>
    </>
  );
}

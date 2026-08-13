import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import {
  getImagePreviewUrl,
  getImageUrl,
  getMediaThumbnailUrl,
  getPlayableVideoUrl,
} from '@/api/client';
import { useGenerationSettingsStore } from '@/hooks/useGenerationSettings';
import { useImageViewerStore } from '@/hooks/useImageViewer';
import type { FrontendNodeMediaItem, FrontendNodeMediaPreview } from '@/utils/nodeFrontendPreviews';
import { isVideoFilename } from '@/utils/media';
import {
  reportVideoAutoplayRejection,
  reportVideoPlaybackIssue,
} from '@/utils/mediaDiagnostics';

export interface NodeCardBatchPreview {
  displaySrc: string;
  alt: string;
  mediaType?: 'image' | 'video';
  poster?: string;
}

interface NodeCardOutputPreviewProps {
  show: boolean;
  previewImage: {
    filename: string;
    subfolder: string;
    type: string;
    cacheToken?: string | number;
    frame_rate?: number;
    width?: number;
    height?: number;
    frame_count?: number;
    has_audio?: boolean;
  } | null;
  // When the node produced more than one output (a batch), these thumbnails are
  // tiled into two columns so the whole batch is visible at once. null/empty
  // falls back to the single-image preview below.
  previewImages?: NodeCardBatchPreview[] | null;
  frontendPreview?: FrontendNodeMediaPreview | null;
  latentPreviewUrl?: string | null;
  previewText?: string | null;
  displayName: string;
  onImageClick?: () => void;
  onPreviewImageClick?: (index: number) => void;
  isExecuting: boolean;
  overallProgress: number | null;
  displayNodeProgress: number;
  videoAutoPlay?: boolean;
  videoLoop?: boolean;
  videoPlaybackRate?: number;
  onFrontendPreviewStateChange?: (change: {
    activeIndex?: number;
    playMode?: 'off' | 'loop' | 'cycle';
  }) => void;
}

function pauseOtherWorkflowPreviews(current: HTMLVideoElement): void {
  document.querySelectorAll<HTMLVideoElement>('video[data-workflow-output-video]').forEach((video) => {
    if (video !== current) video.pause();
  });
}

function WorkflowVideoPreview({
  src,
  poster,
  label,
  autoPlay,
  loop = false,
  playbackRate = 1,
  onEnded,
}: {
  src: string;
  poster: string;
  label: string;
  autoPlay: boolean;
  loop?: boolean;
  playbackRate?: number;
  onEnded?: () => void;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackError, setPlaybackError] = useState(false);
  const viewerOpen = useImageViewerStore((state) => state.viewerOpen);

  useEffect(() => {
    if (viewerOpen) videoRef.current?.pause();
  }, [viewerOpen]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // A single visible video output mirrors the queue's arrival behavior: start
  // muted and inline when the browser permits it. The first intersection is the
  // arrival decision; a video produced in another panel or a folded/off-screen
  // card does not unexpectedly start later when the user returns. Any preview
  // is paused when it becomes hidden. Batch videos stay user-driven so one node
  // cannot start a wall of decoders.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const attemptAutoPlay = () => {
      if (useImageViewerStore.getState().viewerOpen) return;
      video.currentTime = 0;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((error) => {
          reportVideoAutoplayRejection('workflow output preview', src, error);
        });
      }
    };

    if (typeof IntersectionObserver !== 'function') {
      if (autoPlay) attemptAutoPlay();
      return;
    }

    let arrivalObserved = false;
    const observer = new IntersectionObserver(([entry]) => {
      const visible = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0);
      if (!visible) video.pause();
      if (arrivalObserved) return;
      arrivalObserved = true;
      if (visible && autoPlay) attemptAutoPlay();
    }, { threshold: 0.01 });
    observer.observe(video);
    return () => observer.disconnect();
  }, [autoPlay, src]);

  // WebKit can retain a decoder and its response after React removes a video.
  // Release both promptly when an output is replaced or its card unmounts.
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      if (!video) return;
      video.pause();
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        // Older WebKit builds can throw once the element has left the document.
      }
    };
  }, [src]);

  return (
    <div className="relative">
      <video
        key={src}
        ref={videoRef}
        data-workflow-output-video
        src={src}
        poster={poster}
        aria-label={label}
        className="w-full h-auto rounded-lg border border-white/10 bg-black"
        controls
        muted
        playsInline
        loop={loop}
        preload={autoPlay ? 'metadata' : 'none'}
        onCanPlay={() => setPlaybackError(false)}
        onPlay={(event) => {
          setPlaybackError(false);
          pauseOtherWorkflowPreviews(event.currentTarget);
        }}
        onError={(event) => {
          reportVideoPlaybackIssue('workflow output preview', 'error', event.currentTarget);
          setPlaybackError(true);
        }}
        onStalled={(event) => {
          reportVideoPlaybackIssue('workflow output preview', 'stalled', event.currentTarget);
        }}
        onEnded={onEnded}
      />
      {playbackError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-black/65 px-4 text-center text-sm text-white">
          {t('Unable to play this video.')}
        </div>
      )}
    </div>
  );
}

function FrontendMediaPlaylist({
  preview,
  displayName,
  onStateChange,
}: {
  preview: FrontendNodeMediaPreview;
  displayName: string;
  onStateChange?: NodeCardOutputPreviewProps['onFrontendPreviewStateChange'];
}) {
  const t = useT();
  const items = preview.playlist?.length ? preview.playlist : [preview];
  const requestedIndex = preview.activeIndex ?? 0;
  const initialIndex = Math.max(0, Math.min(items.length - 1, requestedIndex));
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [autoPlaySelection, setAutoPlaySelection] = useState(preview.autoPlay);
  const [playMode, setPlayMode] = useState(preview.playMode);
  const selected: FrontendNodeMediaItem = items[selectedIndex] ?? items[0];

  // Follow persisted widget state that changes underneath an unchanged
  // playlist (undo/redo of a scene selection). Guarded on the previous prop
  // value so only an *external* change syncs: a local tap round-trips through
  // the store and arrives back equal, and must not cancel its own autoplay.
  const [syncedIndex, setSyncedIndex] = useState(initialIndex);
  if (syncedIndex !== initialIndex) {
    setSyncedIndex(initialIndex);
    if (initialIndex !== selectedIndex) {
      setSelectedIndex(initialIndex);
      setAutoPlaySelection(false);
    }
  }
  const [syncedPlayMode, setSyncedPlayMode] = useState(preview.playMode);
  if (syncedPlayMode !== preview.playMode) {
    setSyncedPlayMode(preview.playMode);
    setPlayMode(preview.playMode);
  }

  const select = (index: number, autoPlay = true) => {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setSelectedIndex(next);
    setAutoPlaySelection(autoPlay);
    onStateChange?.({ activeIndex: next });
  };

  const advanceCycle = () => {
    if (playMode !== 'cycle' || items.length <= 1) return;
    select((selectedIndex + 1) % items.length);
  };

  const rotatePlayMode = () => {
    const modes = ['off', 'loop', 'cycle'] as const;
    const current = Math.max(0, modes.indexOf(playMode ?? 'off'));
    const next = modes[(current + 1) % modes.length];
    setPlayMode(next);
    onStateChange?.({ playMode: next });
  };

  return (
    <div>
      {selected.mediaType === 'video' ? (
        <WorkflowVideoPreview
          key={selected.src}
          src={selected.src}
          poster={selected.poster ?? ''}
          label={t('{name} video preview', { name: displayName })}
          autoPlay={autoPlaySelection || selected.autoPlay}
          loop={playMode === 'loop' || (playMode === 'cycle' && items.length === 1)
            || (playMode == null && selected.loop)}
          playbackRate={selected.playbackRate}
          onEnded={advanceCycle}
        />
      ) : (
        <img
          src={selected.src}
          alt={t('{name} preview', { name: displayName })}
          className="w-full h-auto rounded-lg border border-white/10"
          loading="lazy"
        />
      )}
      {playMode && (
        <button
          type="button"
          className="mt-2 rounded border border-white/15 px-2 py-1 text-xs text-slate-300"
          onClick={rotatePlayMode}
          aria-label={t('Playback mode: {mode}', { mode: playMode })}
        >
          {playMode === 'off' ? t('Play once') : playMode === 'loop' ? t('Loop clip') : t('Cycle scenes')}
        </button>
      )}
      {items.length > 1 && (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1" aria-label={t('{name} preview history', { name: displayName })}>
          {items.map((item, index) => (
            <button
              key={`${item.src}:${index}`}
              type="button"
              className={`relative h-12 w-16 shrink-0 overflow-hidden rounded border ${index === selectedIndex ? 'border-emerald-300' : 'border-white/15'}`}
              aria-label={t('Show preview {index}', { index: index + 1 })}
              aria-pressed={index === selectedIndex}
              onClick={() => select(index)}
            >
              {item.poster ? (
                <img src={item.poster} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <span className="flex h-full items-center justify-center text-xs text-slate-300">{index + 1}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NodeCardOutputPreview({
  show,
  previewImage,
  previewImages = null,
  frontendPreview = null,
  latentPreviewUrl = null,
  previewText = null,
  displayName,
  onImageClick,
  onPreviewImageClick,
  isExecuting,
  overallProgress,
  displayNodeProgress,
  videoAutoPlay = true,
  videoLoop = false,
  videoPlaybackRate = 1,
  onFrontendPreviewStateChange,
}: NodeCardOutputPreviewProps) {
  const t = useT();
  // Subscribe so the preview refreshes immediately when the WebP preference is
  // toggled (must run before the early return to satisfy the rules of hooks).
  useGenerationSettingsStore((s) => s.webpPreviewEnabled);
  const isTiled = Boolean(previewImages && previewImages.length > 1);
  if (!show || (
    !previewImage && !previewText && !latentPreviewUrl && !isTiled && !frontendPreview
  )) return null;

  const previewIsVideo = Boolean(previewImage && isVideoFilename(previewImage.filename));
  const displaySrc = previewImage && !previewIsVideo
    ? getImagePreviewUrl(previewImage.filename, previewImage.subfolder, previewImage.type)
    : latentPreviewUrl;
  const videoSrc = previewImage && previewIsVideo
    ? getPlayableVideoUrl(getImageUrl(
      previewImage.filename,
      previewImage.subfolder,
      previewImage.type,
      previewImage.cacheToken,
    ))
    : null;
  const videoPoster = previewImage && previewIsVideo
    ? getMediaThumbnailUrl(
      previewImage.filename,
      previewImage.subfolder,
      previewImage.type,
      previewImage.cacheToken,
    )
    : null;

  return (
    <div className="output-preview mb-3">
      <div className="text-xs text-slate-500 mb-1.5 uppercase tracking-wide">
        {t('Output Preview')}
      </div>
      {isTiled ? (
        <div className="output-batch-grid grid grid-cols-2 gap-2">
          {previewImages!.map((media, i) => (
            media.mediaType === 'video' ? (
              <WorkflowVideoPreview
                key={media.displaySrc}
                src={media.displaySrc}
                poster={media.poster ?? ''}
                label={t('{name} output {index}', { name: media.alt, index: i + 1 })}
                autoPlay={false}
              />
            ) : (
              <img
                key={media.displaySrc}
                src={media.displaySrc}
                alt={media.alt}
                className="w-full h-auto rounded-lg border border-white/10"
                loading="lazy"
                onClick={() => onPreviewImageClick?.(i)}
              />
            )
          ))}
        </div>
      ) : videoSrc && videoPoster ? (
        <WorkflowVideoPreview
          key={videoSrc}
          src={videoSrc}
          poster={videoPoster}
          label={t('{name} video output', { name: displayName })}
          autoPlay={videoAutoPlay}
          loop={videoLoop}
          playbackRate={videoPlaybackRate}
        />
      ) : frontendPreview?.mediaType === 'video' ? (
        <FrontendMediaPlaylist
          key={(frontendPreview.playlist ?? [frontendPreview]).map((item) => item.src).join('|')}
          preview={frontendPreview}
          displayName={displayName}
          onStateChange={onFrontendPreviewStateChange}
        />
      ) : frontendPreview?.mediaType === 'image' ? (
        <img
          src={frontendPreview.src}
          alt={t('{name} preview', { name: displayName })}
          className="w-full h-auto rounded-lg border border-white/10"
          loading="lazy"
        />
      ) : displaySrc && (
        <div className="relative">
          <img
            key={previewImage ? 'preview' : 'latent'}
            src={displaySrc}
            alt={t('{name} output', { name: displayName })}
            className="w-full h-auto rounded-lg border border-white/10"
            loading="lazy"
            onClick={onImageClick}
          />
          {isExecuting && overallProgress !== null && (
            <div className="absolute inset-0 bg-black/40 rounded-lg flex items-end p-3">
              <div className="w-full">
                <div className="flex items-center justify-between text-xs text-white/90 mb-1">
                  <span>{t('Progress')}</span>
                  <span>{displayNodeProgress}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/30 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-none"
                    style={{ width: `${Math.min(100, Math.max(0, displayNodeProgress))}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-white/90 mt-2 mb-1">
                  <span>{t('Overall')}</span>
                  <span>{overallProgress}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/30 overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 transition-none"
                    style={{ width: `${Math.min(100, Math.max(0, overallProgress))}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {previewImage && previewIsVideo && (
        <div className="mt-1.5 flex flex-wrap gap-x-2 text-[10px] text-slate-500">
          {Number(previewImage.width) > 0 && Number(previewImage.height) > 0 && (
            <span>{previewImage.width}×{previewImage.height}</span>
          )}
          {Number(previewImage.frame_count) > 0 && <span>{t('{count} frames', { count: previewImage.frame_count ?? 0 })}</span>}
          {Number(previewImage.frame_rate) > 0 && <span>{previewImage.frame_rate} fps</span>}
          {previewImage.has_audio === true && <span>{t('audio')}</span>}
        </div>
      )}
      {previewText && (
        <div className={`${previewImage ? "mt-3" : ""}`}>
          <pre
            className="w-full p-3 comfy-input text-base text-slate-300 opacity-60 whitespace-pre-wrap break-words font-sans"
            style={{ overflowAnchor: "none" }}
          >
            {previewText}
          </pre>
        </div>
      )}
    </div>
  );
}

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { getImageUrl, getQueueImagePreviewUrl, getMediaThumbnailUrl, getPlayableVideoUrl, getFileDimensions, QUEUE_PREVIEW_MAX_EDGE } from '@/api/client';
import type { Workflow } from '@/api/types';
import { useQueueStore } from '@/hooks/useQueue';
import { t as globalT, useI18n } from '@/i18n';
import { useOutputsStore } from '@/hooks/useOutputs';
import { useWorkflowStore, type WorkflowSource } from '@/hooks/useWorkflow';
import { isWorkflowHidden } from '@/utils/workflowHidden';
import { getEmbeddedQueueWorkflowLabel } from '@/utils/queueWorkflowLabel';
import { extractMetadata } from '@/utils/metadata';
import { CheckIcon, CornerDownRightIcon, EyeOffIcon, XSmallIcon } from '@/components/icons';
import { FavoriteButton } from '@/components/buttons/FavoriteButton';
import { RejectButton } from '@/components/buttons/RejectButton';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import type { HistoryOutputImage } from '@/api/types';
import { isHistoryEntryData, type ItemStatus, type QueueItemData, type UnifiedItem, type ViewerImage } from './types';
import { getMediaType, isVideoFilename } from '@/utils/media';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { Collapsible } from '@/components/Collapsible';
import { FoldIcon } from '@/components/FoldIcon';
import { formatBytes } from '@/utils/formatBytes';
import {
  dedupeQueueImages,
  getDisplayableQueueOutputs,
  getPromptInputImages,
  getQueueImageKey,
  preserveQueueImageOrder,
} from './queueUtils';
import { PromptPreview, type PromptPreviewInputImage } from './PromptPreview';
import { getDisplayName } from '@/components/AppMenu/userWorkflowHelpers';
import { getQueueCardHeaderGridClass, getQueueCardHeaderLabel } from './queueCardHeader';
import { getHistoryImageFileId } from '@/utils/viewerImages';
import { preloadQueueMedia } from './queueMediaHandoff';
import {
  reportQueueAutoplayDecision,
  reportVideoAutoplayRejection,
  reportVideoPlaybackIssue,
} from '@/utils/mediaDiagnostics';

const IMAGE_RETRY_DELAYS_MS = [300, 900] as const;

function withMediaRetryToken(url: string, token: string | number): string {
  return `${url}${url.includes('?') ? '&' : '?'}mobile_retry=${encodeURIComponent(token)}`;
}

// One entry in the queue item's image slot / tab bar.
interface MediaTab {
  key: string;
  img: HistoryOutputImage;
  index: number;
  isPreview: boolean;
  label: string;
  // Set for the live latent-preview tab: a blob: URL rendered directly instead
  // of resolving `img` to a server file. `img` is then a placeholder.
  rawSrc?: string;
  isLatent?: boolean;
}

// Placeholder media descriptor for the synthetic latent tab. Code paths that
// read `img` (favorite/reject gating, video check, etc.) treat it as a non-
// output, non-video temp image; the actual pixels come from `rawSrc`.
const LATENT_PLACEHOLDER_IMG: HistoryOutputImage = {
  filename: '',
  subfolder: '',
  type: 'temp',
};

interface QueueMediaEntryProps {
  entry: MediaTab;
  anchorId: string;
  hasCompleted: boolean;
  durationLabel: string | null;
  success: boolean;
  shouldShowRunningProgress: boolean;
  favorited: boolean;
  rejected: boolean;
  sizeLabel: string | null;
  dims: { w: number; h: number; exact?: boolean } | undefined;
  metadata: ReturnType<typeof extractMetadata> | null;
  isTopDoneItem: boolean;
  // Only one queue-card video should be live at a time. Inactive cards render a
  // still poster and do not create a video request or decoder.
  videoActive: boolean;
  endedVideoSources: Set<string>;
  // Extra style applied to the <img>/<video> element (used for the desktop row
  // layout's aspect-ratio sizing).
  mediaStyle?: React.CSSProperties;
  onMediaClick: (src: string, index: number, isTop: boolean) => (event: React.MouseEvent) => void;
  registerVideoRef: (src: string, el: HTMLVideoElement | null) => void;
  onVideoEnded: (src: string) => () => void;
  onVideoPlay: (src: string) => () => void;
  onReplay: (src: string) => (event: React.MouseEvent<HTMLButtonElement>) => void;
  recordDimensions: (
    src: string,
    w: number,
    h: number,
    confidence?: 'exact' | 'measured' | 'aspect-only',
  ) => void;
  onToggleFavorite: () => void;
  onToggleReject: () => void;
  // Fired the moment this entry's <img>/<video> reports loaded — used by the
  // single-slot tabbed layout to promote a back-staging entry to the front
  // only once its bytes are actually paintable, so the previous image stays
  // on screen until the new one is ready.
  onMediaReady?: () => void;
}

// Renders one finished/preview media item with all its overlay badges. Shared by
// the tabbed single slot and the stacked column/row layouts; owns its own
// download-status read so each stacked entry stays reactive.
function QueueMediaEntry({
  entry,
  anchorId,
  hasCompleted,
  durationLabel,
  success,
  shouldShowRunningProgress,
  favorited,
  rejected,
  sizeLabel,
  dims,
  metadata,
  isTopDoneItem,
  videoActive,
  endedVideoSources,
  mediaStyle,
  onMediaClick,
  registerVideoRef,
  onVideoEnded,
  onVideoPlay,
  onReplay,
  recordDimensions,
  onToggleFavorite,
  onToggleReject,
  onMediaReady,
}: QueueMediaEntryProps) {
  const { t } = useI18n();
  const { img, index, isPreview } = entry;
  const isLatent = Boolean(entry.rawSrc);
  // The latent preview is a streamed blob: URL, not a server file or video.
  const isVideo = !isLatent && isVideoFilename(img.filename);
  // Both durable outputs and completed temp media are real server files the
  // viewer can favorite/reject/delete. Prompt-input thumbnails and the live
  // latent blob are not queue outputs and must not get those actions.
  const isManageableOutput = !isLatent && (
    img.type === 'output' || (hasCompleted && img.type === 'temp')
  );
  const showDurationLabel = !isLatent && hasCompleted && img.type === 'output' && durationLabel;
  // Reserve the media's vertical space so it doesn't collapse to nothing while
  // loading (which both leaves an empty unfolded card and makes the list jump as
  // images decode in). When we already know the dimensions, reserve the exact
  // aspect ratio so there's no shift at all; otherwise hold a min height and show
  // a spinner placeholder until the media reports its size. Keyed remount (see the
  // call sites) resets this per distinct media.
  const [mediaLoaded, setMediaLoaded] = useState(false);
  // Set when the media fails to load (e.g. the file was deleted out-of-band —
  // from the filesystem or another tool — so no in-app delete hook could have
  // reconciled it). Renders a placeholder instead of the browser's broken-image
  // glyph. A display failure never mutates history: a transient network or
  // browser decoding failure is not proof that the underlying output is gone.
  const [mediaError, setMediaError] = useState(false);
  const src = entry.rawSrc ?? getImageUrl(img.filename, img.subfolder, img.type);
  const videoPosterSrc = isVideo
    ? getMediaThumbnailUrl(img.filename, img.subfolder, img.type)
    : null;
  const baseDisplaySrc = isLatent
    ? entry.rawSrc!
    : isVideo
      ? videoPosterSrc!
      : getQueueImagePreviewUrl(img.filename, img.subfolder, img.type);
  const [imageRetryAttempt, setImageRetryAttempt] = useState(0);
  const [usingOriginalFallback, setUsingOriginalFallback] = useState(false);
  const retryTimerRef = useRef<number | null>(null);
  const retryScheduledRef = useRef(false);
  const mediaGenerationRef = useRef(0);
  const displaySrc = usingOriginalFallback
    ? withMediaRetryToken(src, 'original')
    : imageRetryAttempt > 0
      ? withMediaRetryToken(baseDisplaySrc, imageRetryAttempt)
      : baseDisplaySrc;

  // Entries can refresh IN PLACE (latent frames, preview→final flips). Reset the
  // retry state for a genuinely new source and invalidate retry work belonging
  // to the previous one.
  useEffect(() => {
    mediaGenerationRef.current += 1;
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    retryScheduledRef.current = false;
    setImageRetryAttempt(0);
    setUsingOriginalFallback(false);
    // Not for a latent frame: its blob URL changes on EVERY arriving frame, so
    // clearing this re-shows the spinner overlay on top of an image that is
    // already painted — the card strobes once per sampler step. A latent stream
    // is a continuous update of the same picture, not a new source to load.
    if (!isLatent) setMediaLoaded(false);
    setMediaError(false);
    return () => {
      mediaGenerationRef.current += 1;
      retryScheduledRef.current = false;
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    };
  }, [baseDisplaySrc, isLatent]);
  // Ref to the visible <img> so we can detect, before paint, that the browser
  // already had this src cached and decoded (typical after the slot's preload
  // step ran). When that's the case, flip mediaLoaded to true synchronously so
  // the spinner overlay never shows over an image that's already on screen.
  const imgRef = useRef<HTMLImageElement | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  useLayoutEffect(() => {
    if (mediaLoaded || mediaError) return;
    const el = imgRef.current;
    if (!el || !el.complete) return;
    if (el.naturalWidth > 0 && el.naturalHeight > 0) {
      if (!isLatent) {
        recordDimensions(
          src,
          el.naturalWidth,
          el.naturalHeight,
          isVideo ? 'aspect-only' : 'measured',
        );
      }
      setMediaLoaded(true);
      onMediaReady?.();
    }
    // intentionally one-shot per mount — once mediaLoaded flips we never re-check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a newer card becomes the active video, stop decoding the previous
  // one. Switching preload to "none" prevents new transfers; pause releases
  // ongoing playback without discarding the already-painted poster.
  useEffect(() => {
    if (!isVideo || videoActive) return;
    videoElementRef.current?.pause();
  }, [isVideo, videoActive]);

  // Removing a playing <video> is not enough for every WebKit build to promptly
  // abandon its range request. Explicitly clear + reload the element when this
  // card loses ownership, the Queue panel hides, the viewer opens, or the entry
  // unmounts. The replacement poster remains paintable throughout.
  useEffect(() => {
    if (!isVideo || !videoActive) return;
    const video = videoElementRef.current;
    if (!video) return;
    return () => {
      video.pause();
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        // The element may already be detached; removing src still releases it.
      }
    };
  }, [isVideo, src, videoActive]);

  // A failed poster thumbnail must not block the actual <video>: the thumbnail
  // endpoint can 404 for a container it cannot extract a still from while the
  // browser plays the file fine. Give the surface a fresh start when this entry
  // becomes the live player; a genuine <video> failure re-sets the error state.
  useEffect(() => {
    if (!isVideo || !videoActive) return;
    setMediaError(false);
    setMediaLoaded(false);
  }, [isVideo, videoActive]);

  const finalizeMediaError = useCallback(() => {
    setMediaLoaded(true); // clear the loading spinner
    setMediaError(true);
    // A failed BACK-slot load must still settle the swap: without this the
    // promote never fires, the swap spinner spins forever, and the tapped tab
    // is unreachable until the item changes. Promoting shows the honest
    // "unavailable" placeholder instead.
    onMediaReady?.();
  }, [onMediaReady]);

  const handleMediaError = (recoverableImage: boolean) => {
    // Blob previews and video elements have different lifecycles. Only an
    // actual <img> receives request-cancellation recovery; this includes the
    // lightweight poster used by inactive video cards.
    if (isLatent || !recoverableImage) {
      finalizeMediaError();
      return;
    }
    if (retryScheduledRef.current || mediaError) return;
    retryScheduledRef.current = true;
    const generation = mediaGenerationRef.current;

    const canRetryPreview = imageRetryAttempt < IMAGE_RETRY_DELAYS_MS.length;
    // A regular preview can fall back to the original image endpoint. A video
    // poster cannot use the video file itself as an <img>, so it only retries
    // the thumbnail endpoint with cache-busting tokens.
    const canFallBackToOriginal = !isVideo && baseDisplaySrc !== src && !usingOriginalFallback;
    if (!canRetryPreview && !canFallBackToOriginal) {
      retryScheduledRef.current = false;
      finalizeMediaError();
      return;
    }

    const delay = canRetryPreview
      ? IMAGE_RETRY_DELAYS_MS[imageRetryAttempt]
      : 0;
    retryTimerRef.current = window.setTimeout(() => {
      if (generation !== mediaGenerationRef.current) return;
      retryTimerRef.current = null;
      retryScheduledRef.current = false;
      setMediaLoaded(false);
      setMediaError(false);
      if (canRetryPreview) {
        setImageRetryAttempt((attempt) => attempt + 1);
      } else {
        setUsingOriginalFallback(true);
      }
    }, delay);
  };

  const knownAspect = dims && dims.h > 0 ? dims.w / dims.h : undefined;
  // Only label the resolution when the measurement is trustworthy: the server's
  // header read, or an element measurement that came in under the preview cap
  // (where the endpoint doesn't downscale). Otherwise the number would be the
  // preview's — a 1920x1080 output reported as 1280x720. Aspect-ratio placement
  // above uses the dims regardless: downscaling preserves the ratio.
  const dimsAreExact = Boolean(dims?.exact);
  const mediaElementStyle: React.CSSProperties = { ...(mediaStyle ?? {}) };
  if (knownAspect != null && mediaElementStyle.aspectRatio == null) {
    mediaElementStyle.aspectRatio = String(knownAspect);
  }

  // Hover always exposes both actions. A chosen state also gets a persistent
  // bare corner indicator, which fades while the full hover controls are shown.
  // Keeping the actions consistent avoids making a viewed/favorited/rejected
  // image look as though its controls have disappeared.
  const hoverRevealClass =
    'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto';
  return (
    <div
      key={entry.key}
      data-scroll-anchor-id={`${anchorId}::media::${isLatent ? 'latent' : img.filename}`}
      className={`group relative ${!mediaLoaded && knownAspect == null ? 'min-h-40' : ''}`}
    >
      {!mediaLoaded && (
        <div className="queue-media-loading-overlay absolute inset-0 z-[5] flex items-center justify-center bg-slate-950/60">
          <LoadingSpinner size="md" color="gray" />
        </div>
      )}
      {isPreview && (
        <div className={`absolute left-2 z-10 rounded bg-black/60 px-2 py-1 text-xs font-semibold text-white backdrop-blur-sm shadow-sm ${
          shouldShowRunningProgress ? 'top-14' : 'top-2'
        }`}>
          {isLatent ? t('LATENT') : t('PREVIEW')}
        </div>
      )}
      {showDurationLabel && (
        <div
          className={`absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold ${
            success ? 'bg-emerald-600/90 text-white' : 'bg-red-600/90 text-white'
          }`}
        >
          {success ? (
            <CheckIcon className="w-3.5 h-3.5" />
          ) : (
            <XSmallIcon className="w-3.5 h-3.5" />
          )}
          <span>{durationLabel}</span>
        </div>
      )}
      {mediaError ? (
        // A video whose poster failed is still perfectly openable — keep the
        // tap-through to the viewer so the output isn't stranded behind a
        // thumbnail endpoint failure.
        <div
          className="queue-media-unavailable flex min-h-40 w-full items-center justify-center bg-slate-900 text-xs text-slate-500"
          style={mediaElementStyle}
          onClick={isVideo ? onMediaClick(src, index, isTopDoneItem) : undefined}
        >
          {isVideo ? t('Video preview unavailable') : t('Image unavailable')}
        </div>
      ) : isVideo && !videoActive ? (
        <>
          <img
            ref={imgRef}
            src={displaySrc}
            alt={t('Generation video poster')}
            className="w-full h-auto block"
            style={mediaElementStyle}
            loading="lazy"
            decoding="async"
            onLoad={(event) => {
              // Aspect only: the poster is a thumbnail-capped still, so its
              // size is never the video's and must not reach the badge — but
              // it does share the aspect ratio the stacked layout sizes by.
              recordDimensions(
                src,
                event.currentTarget.naturalWidth,
                event.currentTarget.naturalHeight,
                'aspect-only',
              );
              setMediaLoaded(true);
              onMediaReady?.();
            }}
            onError={() => handleMediaError(true)}
            onClick={onMediaClick(src, index, isTopDoneItem)}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-white"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 pl-0.5 text-xl">
              ▶
            </span>
          </span>
        </>
      ) : isVideo ? (
        <>
          <video
            src={getPlayableVideoUrl(src)}
            poster={getMediaThumbnailUrl(img.filename, img.subfolder, img.type)}
            className="w-full h-auto block"
            style={mediaElementStyle}
            muted
            playsInline
            preload={videoActive ? 'metadata' : 'none'}
            ref={(el) => {
              videoElementRef.current = el;
              registerVideoRef(src, el);
            }}
            onEnded={onVideoEnded(src)}
            onPlay={onVideoPlay(src)}
            onError={(event) => {
              reportVideoPlaybackIssue('queue card', 'error', event.currentTarget);
              handleMediaError(false);
            }}
            onStalled={(event) => {
              reportVideoPlaybackIssue('queue card', 'stalled', event.currentTarget);
            }}
            onLoadedMetadata={(e) => {
              // Exact: the playback gateway only rounds odd dimensions to even
              // for H.264, it never downscales, so the element reports the real
              // size even for a 4K source.
              recordDimensions(src, e.currentTarget.videoWidth, e.currentTarget.videoHeight, 'exact');
              setMediaLoaded(true);
              onMediaReady?.();
            }}
            onClick={onMediaClick(src, index, isTopDoneItem)}
          />
          {endedVideoSources.has(src) && (
            <button
              type="button"
              className="absolute inset-0 flex items-center justify-center bg-black/35 text-white"
              onClick={onReplay(src)}
              aria-label={t('Replay video')}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-2xl">
                ↻
              </span>
            </button>
          )}
        </>
      ) : (
        <img
          ref={imgRef}
          src={displaySrc}
          alt={t('Generation')}
          className="w-full h-auto block"
          style={mediaElementStyle}
          loading="lazy"
          onLoad={(e) => {
            // Skip the latent preview: its blob: URL changes every frame, which
            // would flood the dimensions map.
            if (!isLatent) {
              recordDimensions(src, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
            }
            setMediaLoaded(true);
            onMediaReady?.();
          }}
          onError={() => handleMediaError(true)}
          onClick={isLatent ? undefined : onMediaClick(src, index, isTopDoneItem)}
        />
      )}
      {/* Favorite/reject affordances for completed output/temp server files,
          never input prompt-previews or the live latent blob. */}
      {isManageableOutput && (
        <>
          {/* Reject hover-button (left). */}
          <div
            className={`rejected-badge-container absolute bottom-2 right-12 z-20 transition-opacity ${hoverRevealClass}`}
          >
            <RejectButton onClick={onToggleReject} isRejected={rejected} isFavorited={favorited} />
          </div>
          {/* Favorite hover-button (right). */}
          <div
            className={`favorite-badge-container absolute bottom-2 right-2 z-20 transition-opacity ${hoverRevealClass}`}
          >
            <FavoriteButton onClick={onToggleFavorite} isFavorited={favorited} />
          </div>
          {favorited && (
            <div className="favorite-state-indicator pointer-events-none absolute bottom-2 right-2 z-10 transition-opacity group-hover:opacity-0">
              <FavoriteButton onClick={onToggleFavorite} isFavorited bare />
            </div>
          )}
          {rejected && (
            <div className="rejected-state-indicator pointer-events-none absolute bottom-2 right-2 z-10 transition-opacity group-hover:opacity-0">
              <RejectButton onClick={onToggleReject} isRejected isFavorited={false} bare />
            </div>
          )}
        </>
      )}
      {(sizeLabel || dimsAreExact) && (
        <div className="absolute bottom-2 left-2 flex items-center gap-1 pointer-events-none">
          {sizeLabel && (
            <span className="px-2 py-1 text-xs font-semibold rounded bg-black/60 text-white backdrop-blur-sm shadow-sm">
              {sizeLabel}
            </span>
          )}
          {dimsAreExact && dims && (
            <span className="resolution-badge inline-flex items-center px-2 py-1 text-xs font-semibold rounded bg-black/60 text-white backdrop-blur-sm shadow-sm">
              {dims.w}
              <span aria-hidden="true" className="relative -top-[0.1em] mx-0.5 text-[0.85em] opacity-80">x</span>
              {dims.h}
            </span>
          )}
        </div>
      )}
      {metadata && (
        <div className={`absolute right-2 flex flex-col-reverse items-end gap-1 pointer-events-none ${
          favorited ? 'bottom-10' : 'bottom-2'
        }`}>
          {metadata.model && <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">model: {metadata.model}</div>}
          {metadata.sampler && <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">sampler: {metadata.sampler}</div>}
          {metadata.steps && <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">steps: {metadata.steps}</div>}
          {metadata.cfg && <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">cfg: {metadata.cfg}</div>}
        </div>
      )}
    </div>
  );
}

interface QueueCardProps {
  item: UnifiedItem;
  isActuallyRunning: boolean;
  progress: number;
  overallProgress?: number | null;
  executingNodeLabel?: string | null;
  onImageClick?: (images: Array<ViewerImage>, index: number, enableFollowQueue?: boolean) => void;
  viewerImages: Array<ViewerImage>;
  runningImages: HistoryOutputImage[];
  onOpenMenu: (payload: {
    top: number;
    right: number;
    imageSrc: string;
    imageSources: string[];
    status: ItemStatus;
    workflow?: Workflow;
    openWorkflowSessionId?: string;
    workflowLabel?: string;
    promptId?: string;
    hasVideoOutputs?: boolean;
    hasImageOutputs?: boolean;
    canReenqueue?: boolean;
  }) => void;
  isTopDoneItem: boolean;
  // QueuePanel coordinates these props so at most one card can create a live
  // <video>. They remain optional for isolated QueueCard consumers/tests.
  // Ownership is claimed two ways: the user tapping a video tab (a pinned
  // claim, via onRequestQueueVideoPlayback) or an eligible generation arriving
  // (an auto claim, via onRequestAutoQueueVideoPlayback, which the panel
  // refuses while a pinned claim is held).
  queueVideoPlaybackEnabled?: boolean;
  queueVideoOwnerId?: string | null;
  onRequestQueueVideoPlayback?: (itemId: string) => void;
  onRequestAutoQueueVideoPlayback?: (itemId: string) => void;
  onReleaseQueueVideoPlayback?: (itemId: string) => void;
  // Lets the list reveal additional history cards only after this card's first
  // media has settled, avoiding a burst of preview requests on initial open.
  onMediaReady?: (itemId: string) => void;
}

function getQueuedWorkflow(data: UnifiedItem['data']): Workflow | undefined {
  if (isHistoryEntryData(data)) return data.workflow;
  const extra = (data as QueueItemData).extra as {
    extra_pnginfo?: { workflow?: Workflow };
  } | undefined;
  return extra?.extra_pnginfo?.workflow;
}

function getQueuedWorkflowLabel(data: UnifiedItem['data']): string | null {
  const extraData = isHistoryEntryData(data)
    ? data.queueRequest?.extra_data
    : data.extra;
  return getEmbeddedQueueWorkflowLabel(extraData);
}

function sessionDisplayLabel(
  filename: string | null,
  source: WorkflowSource | null,
): string {
  if (filename) return getDisplayName(filename);
  if (source && source.type === 'template') return source.templateName;
  return globalT('Untitled');
}

function getPreferredOutputFilename(images: HistoryOutputImage[]): string | null {
  // Prefer durable outputs when present. A PreviewImage or Image Compare run
  // only has completed temp media; its filename is still meaningful and was
  // previously the reason those cards had a blank second header line.
  const durable = images.filter((img) => img.type === 'output');
  const generated = (durable.length > 0
    ? durable
    : images.filter((img) => img.type === 'temp')).reverse();
  const videoOutput = generated.find((img) => isVideoFilename(img.filename));
  if (videoOutput) return videoOutput.filename;
  const imageOutput = generated.find((img) => !isVideoFilename(img.filename));
  return imageOutput?.filename ?? null;
}

function QueueCardComponent({
  item,
  isActuallyRunning,
  progress,
  overallProgress,
  executingNodeLabel,
  onImageClick,
  viewerImages,
  runningImages,
  onOpenMenu,
  isTopDoneItem,
  queueVideoPlaybackEnabled = true,
  queueVideoOwnerId,
  onRequestQueueVideoPlayback,
  onRequestAutoQueueVideoPlayback,
  onReleaseQueueVideoPlayback,
  onMediaReady,
}: QueueCardProps) {
  const { t } = useI18n();
  const previewVisibility = useQueueStore((s) => s.previewVisibility);
  const previewVisibilityDefault = useQueueStore((s) => s.previewVisibilityDefault);
  const showQueueMetadata = useQueueStore((s) => s.showQueueMetadata);
  const showQueueTimestamps = useQueueStore((s) => s.showQueueTimestamps);
  const showPromptPreview = useQueueStore((s) => s.showPromptPreview);
  const queueOutputLayout = useQueueStore((s) => s.queueOutputLayout);
  // Standalone consumers (tests) own their playback implicitly.
  const effectiveQueueVideoOwnerId = queueVideoOwnerId === undefined ? item.id : queueVideoOwnerId;
  const isDesktop = useIsDesktop();
  const queueItemExpanded = useQueueStore((s) => s.queueItemExpanded[item.id]);
  const setQueueItemExpanded = useQueueStore((s) => s.setQueueItemExpanded);
  const queueItemUserToggled = useQueueStore((s) => s.queueItemUserToggled[item.id]);
  const setQueueItemUserToggled = useQueueStore((s) => s.setQueueItemUserToggled);
  const queueItemHideImages = useQueueStore((s) => s.queueItemHideImages[item.id]);
  const completionDurationSeconds = useQueueStore((s) => s.completionDurations[item.id]);
  const isCompleting = useQueueStore((s) => (
    s.completing.some((candidate) => candidate.prompt_id === item.id)
  ));
  const wasAutoRestored = useQueueStore((s) => Boolean(s.autoRestoredPromptIds[item.id]));
  const serverMetadata = useQueueStore((s) => s.queueMetadata[item.id]);
  const favorites = useOutputsStore((s) => s.favorites);
  const favoriteIds = useMemo(() => new Set(favorites), [favorites]);
  const rejected = useOutputsStore((s) => s.rejected);
  const rejectedIds = useMemo(() => new Set(rejected), [rejected]);
  const toggleFavorite = useOutputsStore((s) => s.toggleFavorite);
  const toggleRejected = useOutputsStore((s) => s.toggleRejected);
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const playedVideoSources = useRef(new Set<string>());
  const cardMediaReadyRef = useRef(false);
  const notifyCardMediaReady = useCallback(() => {
    if (cardMediaReadyRef.current) return;
    cardMediaReadyRef.current = true;
    onMediaReady?.(item.id);
  }, [item.id, onMediaReady]);
  const mediaOrderRef = useRef<string[]>([]);
  const mediaOrderPromptIdRef = useRef(item.id);
  const [endedVideoSources, setEndedVideoSources] = useState<Set<string>>(new Set());
  // Mirrored synchronously (not via an effect): teardown cleanups read this ref
  // in the same commit that an `ended` update lands, and an effect-synced
  // mirror would still hold the previous set at that point.
  const endedVideoSourcesRef = useRef(endedVideoSources);
  const updateEndedVideoSources = useCallback(
    (mutate: (next: Set<string>) => void) => {
      setEndedVideoSources((prev) => {
        const next = new Set(prev);
        mutate(next);
        endedVideoSourcesRef.current = next;
        return next;
      });
    },
    [],
  );
  // Root element, used for the on-screen check when this item finishes.
  const cardRootRef = useRef<HTMLDivElement | null>(null);
  // Latched when this item's completion was eligible for autoplay. Never
  // cleared while the item is shown: it only ever grants playback together
  // with queue-wide ownership, and ownership is what arrivals/gating revoke.
  const [autoplayArmed, setAutoplayArmed] = useState(false);
  // Single image slot + tab bar: which media entry is shown. `mediaTabPinned`
  // means the user explicitly tapped a tab; until then the slot auto-follows the
  // newest/highest-priority entry (latest output, or latest preview if no output
  // yet) so it doesn't fight live preview streaming.
  const [activeMediaKey, setActiveMediaKey] = useState<string | null>(null);
  const [mediaTabPinned, setMediaTabPinned] = useState(false);
  // Two-position slot model. The slot has a stable A and B; at any moment one
  // is "front" (visible, painted) and the other is "back" (offscreen, loading
  // the next entry). When a new target arrives that differs from the front,
  // we route it to the back slot so the front keeps painting the current
  // image undisturbed. The back's <img>/<video> goes through its full load
  // cycle invisibly, and only when it fires `onMediaReady` do we flip `frontSlot`
  // — the previously-back QueueMediaEntry stays mounted and becomes the
  // visible one without ever clearing the previous image. Result: zero
  // transition during which the user sees a blank or spinner over the slot.
  type SlotKey = 'A' | 'B';
  const [slotA, setSlotA] = useState<MediaTab | null>(null);
  const [slotB, setSlotB] = useState<MediaTab | null>(null);
  const [frontSlot, setFrontSlot] = useState<SlotKey>('A');
  const frontEntry = frontSlot === 'A' ? slotA : slotB;
  const backEntry = frontSlot === 'A' ? slotB : slotA;
  const backSlotKey: SlotKey = frontSlot === 'A' ? 'B' : 'A';
  const setSlot = useCallback((key: SlotKey, tab: MediaTab | null) => {
    if (key === 'A') setSlotA(tab); else setSlotB(tab);
  }, []);
  const [outputFileSizes, setOutputFileSizes] = useState<Record<string, number>>({});
  const sizeFetchRef = useRef<Set<string>>(new Set());
  // Pixel dimensions per output src, captured from the loaded media (images via
  // naturalWidth/Height, videos via videoWidth/Height) for the resolution badge.
  const [outputDimensions, setOutputDimensions] = useState<
    Record<string, { w: number; h: number; exact?: boolean }>
  >({});
  // `exact` marks a measurement we can stand behind for the resolution badge.
  // Anything read off the rendered element is the 1280-capped preview's size
  // for a larger output, so only the server's header read (below) or a
  // measurement that came in under the cap qualifies.
  const recordDimensions = (
    src: string,
    w: number,
    h: number,
    confidence: 'exact' | 'measured' | 'aspect-only' = 'measured',
  ) => {
    if (w <= 0 || h <= 0) return;
    setOutputDimensions((prev) => {
      const current = prev[src];
      const exact =
        confidence === 'exact' ||
        // A measurement that came in under the preview cap can't be a
        // downscale, so it is the real size. An aspect-only source (a video
        // poster) is a thumbnail at any size — never a size we can quote.
        (confidence === 'measured' && Math.max(w, h) < QUEUE_PREVIEW_MAX_EDGE);
      if (current && (current.exact || !exact)) return prev;
      return { ...prev, [src]: { w, h, exact } };
    });
  };
  // True dimensions for saved outputs, read from the file header server-side.
  // The card renders a capped preview, so this is the only way to label a
  // 1920x1080 output correctly. One batched request per card, only for outputs
  // whose size we can't already vouch for.
  const historyImages = isHistoryEntryData(item.data) ? item.data.outputs.images : null;
  const hasStoredExpanded = queueItemExpanded !== undefined;
  const expanded = hasStoredExpanded ? queueItemExpanded : false;
  useEffect(() => {
    // Only for a card the user can actually see the badge on. A long history
    // is mostly collapsed cards, and each would otherwise cost a request.
    if (!expanded) return;
    if (!historyImages || historyImages.length === 0) return;
    // Any still the card can label, not just type 'output': PreviewImage nodes
    // write 'temp', and those cards showed a correct badge before this gating.
    const wanted = historyImages.filter(
      (img) => img.type !== 'input' && !isVideoFilename(img.filename),
    );
    if (wanted.length === 0) return;
    const missing = wanted.filter((img) => {
      const src = getImageUrl(img.filename, img.subfolder, img.type);
      return !outputDimensions[src]?.exact;
    });
    if (missing.length === 0) return;
    let cancelled = false;
    const bySource = new Map<string, typeof missing>();
    for (const img of missing) {
      const list = bySource.get(img.type) ?? [];
      list.push(img);
      bySource.set(img.type, list);
    }
    void Promise.all(
      Array.from(bySource, ([type, imgs]) =>
        getFileDimensions(
          type as 'output' | 'input' | 'temp',
          imgs.map((img) => (img.subfolder ? `${img.subfolder}/${img.filename}` : img.filename)),
        )
          .then((byPath) => ({ imgs, byPath }))
          // A dimension is a label, never a reason to fail the card.
          .catch(() => ({ imgs, byPath: {} as Record<string, { width: number; height: number }> })),
      ),
    ).then((groups) => {
      if (cancelled) return;
      for (const { imgs, byPath } of groups) {
        for (const img of imgs) {
          const rel = img.subfolder ? `${img.subfolder}/${img.filename}` : img.filename;
          const size = byPath[rel];
          if (!size) continue;
          recordDimensions(
            getImageUrl(img.filename, img.subfolder, img.type),
            size.width,
            size.height,
            'exact',
          );
        }
      }
    });
    return () => { cancelled = true; };
    // outputDimensions is deliberately absent: recording results would re-run
    // this and it already skips what it has.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyImages, expanded]);

  const isPending = item.status === 'pending' && !isActuallyRunning;
  const isRunning = item.status === 'running' || isActuallyRunning;
  const isGenerating = isRunning && !isCompleting;
  const isDone = item.status === 'done';
  const queuedWorkflow = useMemo(() => getQueuedWorkflow(item.data), [item.data]);
  const queuedWorkflowLabel = useMemo(() => getQueuedWorkflowLabel(item.data), [item.data]);
  const owningWorkflow = useWorkflowStore(
    useShallow((s) => {
      const promptId = item.data.prompt_id || item.id;
      const sessionId = s.promptToSession[promptId];
      if (!sessionId) {
        return { sessionId: null, label: null, hidden: false };
      }
      if (!s.sessions.some((session) => session.id === sessionId)) {
        return { sessionId: null, label: null, hidden: false };
      }
      const isActive = sessionId === s.activeSessionId;
      const parked = s.parkedSessions[sessionId];
      const filename = isActive
        ? s.currentFilename
        : parked?.currentFilename ?? null;
      const source = isActive
        ? s.workflowSource
        : parked?.workflowSource ?? null;
      return {
        sessionId,
        label: sessionDisplayLabel(filename, source),
        hidden: isWorkflowHidden(source, filename),
      };
    }),
  );
  // The server record is the queued-time snapshot. The prompt-embedded label
  // covers legacy history, other clients, and transient metadata failures;
  // the live owning tab is only a last fallback because it may have since
  // loaded a different workflow.
  const workflowLabel =
    serverMetadata?.workflowLabel
    ?? queuedWorkflowLabel
    ?? owningWorkflow.label
    ?? t('Untitled');

  const prevIsDoneRef = useRef(isDone);
  // The default below is written at most once per mounted card. Without this,
  // losing the stored entry makes the card write it straight back — and since
  // the store caps these maps, a queue with more mounted cards than the cap
  // turns that into an unterminating evict/rewrite cycle across every card.
  const wroteDefaultExpandedRef = useRef(false);

  useEffect(() => {
    if (!hasStoredExpanded && !wroteDefaultExpandedRef.current) {
      wroteDefaultExpandedRef.current = true;
      // History entries already default open when they are hydrated. Do the
      // same for a newly observed pending/running item so its progress, prompt
      // preview, and inputs are visible before completion when that feature is
      // enabled. Preserve the previous compact default otherwise, and once a
      // value is stored leave explicit per-card / "Collapse all" choices alone.
      setQueueItemExpanded(item.id, showPromptPreview);
    } else if (
      hasStoredExpanded &&
      showPromptPreview &&
      !isDone &&
      !expanded &&
      !queueItemUserToggled
    ) {
      // The card may have mounted while the preference was off (including
      // before async persisted-state hydration finished), which stores the
      // automatic compact default above. Reveal active prompt content when the
      // preference subsequently turns on, but never override an explicit fold.
      setQueueItemExpanded(item.id, true);
    }
  }, [
    expanded,
    hasStoredExpanded,
    isDone,
    item.id,
    queueItemUserToggled,
    setQueueItemExpanded,
    showPromptPreview,
  ]);

  useEffect(() => {
    if (!prevIsDoneRef.current && isDone && !queueItemUserToggled) {
      setQueueItemExpanded(item.id, true);
    }
    prevIsDoneRef.current = isDone;
  }, [isDone, item.id, queueItemUserToggled, setQueueItemExpanded]);

  useEffect(() => {
    playedVideoSources.current.clear();
    const empty = new Set<string>();
    endedVideoSourcesRef.current = empty;
    setEndedVideoSources(empty);
    setAutoplayArmed(false);
  }, [item.id]);

  const handleToggle = () => {
    setQueueItemUserToggled(item.id, true);
    setQueueItemExpanded(item.id, !expanded);
  };

  const previewPromptId = item.data.prompt_id || item.id;
  // Live latent preview for this prompt (global store, keyed by prompt_id so it
  // also works for runs started in a parked tab). Only while generating.
  const latentEntry = useWorkflowStore((s) => s.latentPreviewByPrompt?.[previewPromptId]);
  const latentUrl = isGenerating ? latentEntry?.url ?? null : null;
  const latentSeq = latentEntry?.seq ?? 0;
  const historyData = isDone && isHistoryEntryData(item.data) ? item.data : null;
  const isFailedDoneItem = isDone && historyData?.success === false;
  // A failed run is either a user interruption / didn't-finish (STOPPED) or a
  // genuine execution error (ERROR). Both render red, but the label distinguishes
  // them so an interruption isn't mislabeled as an error and vice versa.
  const isInterruptedItem = isFailedDoneItem && Boolean(historyData?.interrupted);
  const isErroredItem = isFailedDoneItem && !historyData?.interrupted;
  // A queue item belongs to a hidden workflow if its still-open owning session
  // is hidden (running/pending items) or the finished entry was tagged hidden at
  // enqueue (done items). Mirrors the top bar's italic + eye-off treatment.
  const isHiddenWorkflowItem = owningWorkflow.hidden || Boolean(historyData?.hidden);
  // The prompt walk depends only on the prompt itself — keep it out of the
  // sourceImages memo, which re-runs on every arriving preview frame. A
  // recovered/malformed entry can lack data.prompt entirely (the metadata memo
  // below guards the same way); degrade to no input thumbnails, not a throw.
  const promptSourceInputImages = useMemo(
    () => (showPromptPreview && item.data.prompt ? getPromptInputImages(item.data.prompt) : []),
    [item.data.prompt, showPromptPreview],
  );
  const sourceImages = useMemo(() => {
    if (mediaOrderPromptIdRef.current !== item.id) {
      mediaOrderPromptIdRef.current = item.id;
      mediaOrderRef.current = [];
    }
    const nextImages = getDisplayableQueueOutputs(dedupeQueueImages([
      ...promptSourceInputImages,
      ...(historyData ? historyData.outputs.images : (isRunning ? runningImages : [])),
    ]), { includeInputImages: showPromptPreview });
    const orderedImages = preserveQueueImageOrder(mediaOrderRef.current, nextImages);
    mediaOrderRef.current = orderedImages.map(getQueueImageKey);
    return orderedImages;
  }, [historyData, isRunning, item.id, promptSourceInputImages, runningImages, showPromptPreview]);
  const previewsVisible = Boolean(
    item.data.prompt_id
      ? previewVisibility[item.data.prompt_id] ?? previewVisibilityDefault
      : previewVisibilityDefault
  );
  const { savedImages, displayImages } = useMemo(() => {
    const saved = sourceImages.filter((img: HistoryOutputImage) => img.type === 'output');
    const showPreviews = previewsVisible || saved.length === 0;
    return {
      savedImages: saved,
      displayImages: sourceImages.filter((img: HistoryOutputImage) => (
        img.type === 'output' ||
        img.type === 'input' ||
        showPreviews
      ))
    };
  }, [previewsVisible, sourceImages]);
  const hasVideoOutputs = useMemo(() => (
    sourceImages.some((img: HistoryOutputImage) => isVideoFilename(img.filename))
  ), [sourceImages]);
  const hasImageOutputs = useMemo(() => (
    sourceImages.some((img: HistoryOutputImage) => !isVideoFilename(img.filename))
  ), [sourceImages]);
  const preferredOutputFilename = useMemo(
    () => getPreferredOutputFilename(sourceImages),
    [sourceImages],
  );
  const headerLabel = getQueueCardHeaderLabel({
    isGenerating,
    isCompleting,
    isPending,
    isStopped: isInterruptedItem,
    isErrored: isErroredItem,
    preferredOutputFilename,
  });
  const headerGridClass = getQueueCardHeaderGridClass(isDone);
  // The slot renders a single image at a time, so it no longer needs the
  // list-level "hold the whole previous set until everything preloads" dance —
  // `displayedEntry` below holds the currently shown media and swaps to the next
  // one only after it has decoded, which smooths both tab switches and the
  // preview→output handoff at completion without flashing or layout shift.
  const visibleImages = useMemo(() => {
    if (!queueItemHideImages || !hasVideoOutputs) return displayImages;
    return displayImages.filter((img: HistoryOutputImage) => isVideoFilename(img.filename));
  }, [displayImages, hasVideoOutputs, queueItemHideImages]);

  useEffect(() => {
    setActiveMediaKey(null);
    setMediaTabPinned(false);
    setSlotA(null);
    setSlotB(null);
    setFrontSlot('A');
    if (promoteTimerRef.current) {
      clearTimeout(promoteTimerRef.current);
      promoteTimerRef.current = null;
    }
  }, [item.id]);

  useEffect(() => {
    if (!isRunning || (visibleImages.length === 0 && !latentUrl) || expanded || queueItemUserToggled) return;
    setQueueItemExpanded(item.id, true);
  }, [expanded, isRunning, item.id, latentUrl, queueItemUserToggled, setQueueItemExpanded, visibleImages.length]);

  const placeholderClass ='aspect-square w-full bg-slate-950/80 flex flex-col items-center justify-center text-slate-400';
  const durationSeconds = historyData?.durationSeconds ?? completionDurationSeconds;
  const hasCompleted = isDone || completionDurationSeconds !== undefined;
  const success = historyData ? historyData.success !== false : true;
  const donePlaceholderMessage = isFailedDoneItem
    ? historyData?.errorMessage || t('Execution failed')
    : t('No images saved');
  const donePlaceholderClass = isFailedDoneItem
    ? 'text-sm text-red-600 px-4 text-center'
    : 'text-sm';
  const durationLabel = formatDuration(durationSeconds);
  const displayNodeProgress = overallProgress === 100 ? 100 : progress;

  const metadata = useMemo(() => {
    if (!showQueueMetadata || !item.data.prompt) return null;
    return extractMetadata(item.data.prompt);
  }, [showQueueMetadata, item.data.prompt]);

  const cardViewerImages = useMemo(() => (
    visibleImages.map((img: HistoryOutputImage) => ({
      src: getImageUrl(img.filename, img.subfolder, img.type),
      displaySrc: isVideoFilename(img.filename)
        ? undefined
        : getQueueImagePreviewUrl(img.filename, img.subfolder, img.type),
      alt: t('Generation'),
      mediaType: getMediaType(img.filename)
    }))
  ), [visibleImages, t]);
  const queueViewerImages = useMemo(() => (
    isRunning ? cardViewerImages : viewerImages
  ), [cardViewerImages, isRunning, viewerImages]);

  // Fetch file sizes (not in history data) via a HEAD request so the size badge
  // can show for every shown image — previews and final outputs alike. Only runs
  // while expanded.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    visibleImages.forEach((img: HistoryOutputImage) => {
      const src = getImageUrl(img.filename, img.subfolder, img.type);
      if (sizeFetchRef.current.has(src)) return;
      sizeFetchRef.current.add(src);
      fetch(src, { method: 'HEAD' })
        .then((res) => {
          const len = res.headers.get('content-length');
          const bytes = len ? Number(len) : NaN;
          if (cancelled || !Number.isFinite(bytes)) return;
          setOutputFileSizes((prev) => ({ ...prev, [src]: bytes }));
        })
        .catch(() => {
          sizeFetchRef.current.delete(src);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, visibleImages]);

  const handleToggleButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    handleToggle();
  };

  const handleOpenMenuClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - rect.right);
    const menuSourceImages = savedImages.length > 0 ? savedImages : visibleImages;
    const menuImages = menuSourceImages.map(
      (img: HistoryOutputImage) => getImageUrl(img.filename, img.subfolder, img.type),
    );
    const firstSrc = menuImages[0] || '';
    onOpenMenu({
      top: rect.bottom + 6,
      right,
      imageSrc: firstSrc,
      imageSources: menuImages,
      status: item.status,
      workflow: queuedWorkflow,
      openWorkflowSessionId: owningWorkflow.sessionId ?? undefined,
      workflowLabel: workflowLabel ?? undefined,
      promptId: item.data.prompt_id || item.id,
      hasVideoOutputs,
      hasImageOutputs,
      canReenqueue: isFailedDoneItem && Boolean(historyData?.queueRequest),
    });
  };

  const handleVideoEnded = (src: string) => () => {
    updateEndedVideoSources((next) => next.add(src));
  };

  const handleVideoPlay = (src: string) => () => {
    updateEndedVideoSources((next) => next.delete(src));
  };

  const handleMediaClick = (src: string, index: number, isTop: boolean) => () => {
    const resolvedIndex = queueViewerImages.findIndex((entry: ViewerImage) => entry.src === src);
    if (resolvedIndex >= 0) {
      onImageClick?.(queueViewerImages, resolvedIndex, isTop);
      return;
    }
    const cardIndex = cardViewerImages.findIndex((entry: ViewerImage) => entry.src === src);
    onImageClick?.(cardViewerImages, cardIndex >= 0 ? cardIndex : index, isTop);
  };

  const handleReplayClick = (src: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const videoEl = videoRefs.current.get(src);
    if (!videoEl) return;
    // An explicit replay is user intent, like selecting the tab: pin the
    // queue-wide slot so an arriving generation cannot steal it mid-watch.
    onRequestQueueVideoPlayback?.(item.id);
    videoEl.currentTime = 0;
    const playPromise = videoEl.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((error) => reportVideoAutoplayRejection('queue card replay', src, error));
    }
  };

  const shouldShowRunningProgress = isRunning && isActuallyRunning;
  const visibleMediaEntries = useMemo(
    () => visibleImages.map((img, index) => ({ img, index })),
    [visibleImages],
  );
  const inputMediaEntries = useMemo(
    () => visibleMediaEntries.filter(({ img }) => img.type === 'input'),
    [visibleMediaEntries],
  );
  const fullWidthMediaEntries = useMemo(
    () => visibleMediaEntries.filter(({ img }) => img.type !== 'input'),
    [visibleMediaEntries],
  );
  // One tab per full-width media entry, labelled "Preview #n" / "Output #n".
  const realMediaTabs = useMemo<MediaTab[]>(() => {
    let previewIndex = 0;
    let outputIndex = 0;
    return fullWidthMediaEntries.map(({ img, index }) => {
      const isPreview = !hasCompleted || img.type !== 'output';
      const labelIndex = isPreview ? ++previewIndex : ++outputIndex;
      return {
        key: getQueueImageKey(img),
        img,
        index,
        isPreview,
        label: isPreview
          ? t('Preview #{index}', { index: labelIndex })
          : t('Output #{index}', { index: labelIndex }),
      };
    });
  }, [fullWidthMediaEntries, hasCompleted, t]);

  // Recency: capture the latent's seq at the moment a new real media entry
  // arrives, synchronously during render so the switch is immediate (an effect
  // would lag a render and let a continuing latent stream skip the new preview).
  // The latent is "newest" iff a frame has streamed in since then — so the slot
  // auto-follows latent → real preview/output → newer latent → …
  const realMediaCount = realMediaTabs.length;
  const seqAtLastRealMediaRef = useRef(0);
  const prevRealMediaCountRef = useRef(0);
  if (realMediaCount !== prevRealMediaCountRef.current) {
    prevRealMediaCountRef.current = realMediaCount;
    seqAtLastRealMediaRef.current = latentSeq;
  }
  const latentIsNewest = Boolean(latentUrl) && latentSeq > seqAtLastRealMediaRef.current;

  const latentTab = useMemo<MediaTab | null>(() => {
    if (!latentUrl) return null;
    return {
      key: 'latent',
      img: LATENT_PLACEHOLDER_IMG,
      index: -1,
      isPreview: true,
      isLatent: true,
      rawSrc: latentUrl,
      label: t('Latent'),
    };
  }, [latentUrl, t]);

  // Latent appended last so it sits at the end of the thumbnail tab bar; the bar
  // appears whenever there's more than one entry (e.g. a latent + a real preview).
  const mediaTabs = useMemo<MediaTab[]>(
    () => (latentTab ? [...realMediaTabs, latentTab] : realMediaTabs),
    [realMediaTabs, latentTab],
  );
  useEffect(() => {
    // Collapsed and media-less cards create no <img>/<video> load event, so
    // they are already settled from the list's perspective.
    if (!expanded || mediaTabs.length === 0) notifyCardMediaReady();
  }, [expanded, mediaTabs.length, notifyCardMediaReady]);
  // Auto-target (when the user hasn't pinned a tab). The live latent wins while
  // it's the most recent frame; otherwise video wins (once a video shows, a
  // later image output never auto-steals the slot), then the latest output,
  // falling back to the latest preview before any output exists.
  const autoMediaTab = useMemo(() => {
    if (latentTab && latentIsNewest) return latentTab;
    if (realMediaTabs.length === 0) return latentTab;
    const videos = realMediaTabs.filter((tab) => isVideoFilename(tab.img.filename));
    if (videos.length > 0) return videos[videos.length - 1];
    const outputs = realMediaTabs.filter((tab) => !tab.isPreview);
    const pool = outputs.length > 0 ? outputs : realMediaTabs;
    return pool[pool.length - 1];
  }, [realMediaTabs, latentTab, latentIsNewest]);
  const activeMediaTab = useMemo(() => {
    if (mediaTabPinned && activeMediaKey) {
      const pinned = mediaTabs.find((tab) => tab.key === activeMediaKey);
      if (pinned) return pinned;
    }
    return autoMediaTab;
  }, [mediaTabPinned, activeMediaKey, mediaTabs, autoMediaTab]);
  const activeMediaIsVideo = Boolean(
    activeMediaTab &&
    !activeMediaTab.rawSrc &&
    isVideoFilename(activeMediaTab.img.filename),
  );
  const activeQueueVideoSrc = activeMediaIsVideo && activeMediaTab
    ? getImageUrl(
      activeMediaTab.img.filename,
      activeMediaTab.img.subfolder,
      activeMediaTab.img.type,
    )
    : null;
  const wantsQueueVideoPlayback = Boolean(
    expanded &&
    activeMediaIsVideo &&
    (mediaTabPinned || autoplayArmed),
  );
  const shouldActivateQueueVideo = Boolean(
    queueVideoPlaybackEnabled &&
    wantsQueueVideoPlayback &&
    effectiveQueueVideoOwnerId === item.id,
  );

  // Autoplay is an arrival event, not a standing state: exactly when this item
  // transitions to done, decide once whether its video may claim the queue-wide
  // playback slot. An item that completes while the user is elsewhere — panel
  // hidden, viewer open, card scrolled off screen or explicitly collapsed —
  // never auto-plays; its video renders as a poster until explicitly selected.
  // The claim is auto-flavored, so the panel refuses it while the user has a
  // video pinned on another card.
  const autoplayPrevDoneRef = useRef(isDone);
  useEffect(() => {
    const wasDone = autoplayPrevDoneRef.current;
    autoplayPrevDoneRef.current = isDone;
    if (wasDone || !isDone) return;
    const rect = cardRootRef.current?.getBoundingClientRect();
    const onScreen = Boolean(
      rect && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight,
    );
    const userCollapsed = Boolean(queueItemUserToggled) && !expanded;
    const pinnedToNonVideoTab = mediaTabPinned && !activeMediaIsVideo;
    const eligible =
      queueVideoPlaybackEnabled &&
      hasVideoOutputs &&
      onScreen &&
      !userCollapsed &&
      !pinnedToNonVideoTab;
    reportQueueAutoplayDecision(item.id, eligible, {
      panelActive: queueVideoPlaybackEnabled,
      hasVideoOutput: hasVideoOutputs,
      onScreen,
      userCollapsed,
      pinnedToNonVideoTab,
      ownerId: queueVideoOwnerId ?? null,
    });
    if (!eligible) return;
    setAutoplayArmed(true);
    onRequestAutoQueueVideoPlayback?.(item.id);
  }, [
    isDone,
    item.id,
    queueVideoPlaybackEnabled,
    hasVideoOutputs,
    mediaTabPinned,
    activeMediaIsVideo,
    expanded,
    queueItemUserToggled,
    queueVideoOwnerId,
    onRequestAutoQueueVideoPlayback,
  ]);

  // A collapsed card or one switched back to an image must relinquish the slot.
  // Panel/viewer gating happens at the panel level instead: it keeps a pinned
  // owner (so the user's selected video resumes when the overlay closes) and
  // drops an automatic one (so an auto-played video never resumes on return).
  useEffect(() => {
    if (effectiveQueueVideoOwnerId === item.id && !wantsQueueVideoPlayback) {
      onReleaseQueueVideoPlayback?.(item.id);
    }
  }, [
    effectiveQueueVideoOwnerId,
    item.id,
    onReleaseQueueVideoPlayback,
    wantsQueueVideoPlayback,
  ]);

  const selectMediaTab = (tab: MediaTab) => {
    setActiveMediaKey(tab.key);
    setMediaTabPinned(true);
    if (!tab.rawSrc && isVideoFilename(tab.img.filename)) {
      if (queueVideoPlaybackEnabled) onRequestQueueVideoPlayback?.(item.id);
    } else if (effectiveQueueVideoOwnerId === item.id) {
      onReleaseQueueVideoPlayback?.(item.id);
    }
  };
  // True while the front slot is still showing the previous entry because the
  // back slot is still loading the newly-selected one. Used to show a subtle
  // progress hint so a slow tap on a tab doesn't look unresponsive.
  const isSwappingMedia = Boolean(
    activeMediaTab && frontEntry && activeMediaTab.key !== frontEntry.key,
  );

  // Short grace period between the back slot reporting it's loaded and the
  // actual flip to "front". onLoad fires when the browser has decoded the
  // bytes, but compositing the new image onto the page can still take a
  // beat — without the delay, the swap can look like a tiny pop. The
  // isSwappingMedia spinner stays on screen for the whole window because the
  // slot keys don't equalize until the flip lands.
  const PROMOTE_DELAY_MS = 200;
  const promoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (promoteTimerRef.current) clearTimeout(promoteTimerRef.current);
  }, []);

  // Live slot state for the promote timer below. The timer fires 200ms after
  // the render that scheduled it, so it must read the slots as they are THEN —
  // guarding against render-time captures let a stale timer promote a slot
  // that had since been cleared (blanking both slots) or one holding a
  // different, not-yet-ready entry.
  const slotsRef = useRef({ slotA, slotB, frontSlot });
  slotsRef.current = { slotA, slotB, frontSlot };

  // Promote the back slot to front. Stalemate guard: only promote if the back
  // slot is still holding the entry whose load triggered this — otherwise an
  // older "ready" callback from a since-replaced target would steal the front.
  const promoteBack = useCallback((expectedKey: string) => {
    if (promoteTimerRef.current) clearTimeout(promoteTimerRef.current);
    promoteTimerRef.current = setTimeout(() => {
      promoteTimerRef.current = null;
      const { slotA: liveA, slotB: liveB, frontSlot: liveFront } = slotsRef.current;
      const back = liveFront === 'A' ? liveB : liveA;
      if (back?.key !== expectedKey) return;
      setFrontSlot(liveFront === 'A' ? 'B' : 'A');
      setSlot(liveFront, null);
    }, PROMOTE_DELAY_MS);
  }, [setSlot]);

  // Promote a video stuck staging in the hidden back slot when playback will
  // not start (replay-guarded revisit, rejected autoplay). Promotion normally
  // waits for the back element's loadedmetadata, but a hidden preload=metadata
  // video that never gets a successful play() may never fetch on mobile WebKit
  // — the exact stall the staging rework works around for the autoplay case.
  // Making the element visible restores normal loading and tap-to-play.
  const promoteStagedVideo = useCallback((src: string) => {
    const { slotA: liveA, slotB: liveB, frontSlot: liveFront } = slotsRef.current;
    const back = liveFront === 'A' ? liveB : liveA;
    if (!back || back.rawSrc || !isVideoFilename(back.img.filename)) return;
    if (getImageUrl(back.img.filename, back.img.subfolder, back.img.type) !== src) return;
    promoteBack(back.key);
  }, [promoteBack]);

  // Route activeMediaTab to one of the two slots. The front slot keeps painting
  // the previous entry while the back slot loads the next one invisibly; we
  // only flip which slot is "front" once the back has fired onMediaReady.
  useEffect(() => {
    // Collapsed cards keep their children mounted (Collapsible animates via
    // grid rows), so staging media here would fetch + decode a preview for
    // every folded card scrolled past. Route only while expanded; the effect
    // re-runs on expand and stages whatever is current then.
    if (!expanded) return;
    const target = activeMediaTab;
    if (!target) {
      if (slotA !== null) setSlotA(null);
      if (slotB !== null) setSlotB(null);
      return;
    }
    if (frontEntry?.key === target.key) {
      // Same media as currently displayed. Refresh in place for metadata
      // changes (preview→final flip on the same filename, latent frame's
      // new blob URL, etc.) without going through a swap — same JSX key, no
      // remount, no spinner flash.
      if (
        frontEntry.isPreview !== target.isPreview ||
        frontEntry.index !== target.index ||
        frontEntry.rawSrc !== target.rawSrc
      ) {
        setSlot(frontSlot, target);
      }
      // Cancel any in-flight stage on the back slot — the user has snapped
      // back to what's currently displayed, no swap needed.
      if (backEntry !== null) setSlot(backSlotKey, null);
      return;
    }
    // First load — drop the target straight onto the front, nothing to hold.
    if (frontEntry === null) {
      setSlot(frontSlot, target);
      if (backEntry !== null) setSlot(backSlotKey, null);
      return;
    }
    // Already staging this exact target — refresh the staged entry in place
    // when its payload moved on (a latent's blob URL streams new frames; the
    // stale one gets revoked under the <img> and errors out), otherwise just
    // let the load finish. Same key → same JSX key, no remount.
    if (backEntry?.key === target.key) {
      if (
        backEntry.isPreview !== target.isPreview ||
        backEntry.index !== target.index ||
        backEntry.rawSrc !== target.rawSrc
      ) {
        setSlot(backSlotKey, target);
      }
      return;
    }
    // Latent previews are already-decoded blobs. Videos must also stage
    // immediately: waiting for a separate poster preload serializes thumbnail
    // recovery (up to six seconds) ahead of the actual playable-video request.
    // QueueMediaEntry loads/retries the poster itself when the video is
    // inactive, while an active video can fetch its poster and metadata in
    // parallel and still stays behind the old front until onLoadedMetadata.
    if (target.rawSrc || isVideoFilename(target.img.filename)) {
      setSlot(backSlotKey, target);
      return;
    }
    let cancelled = false;
    void preloadQueueMedia([target.img]).then((results) => {
      if (cancelled) return;
      // Record dims before the back slot mounts so its QueueMediaEntry sizes
      // its container at the right aspect ratio on first paint, instead of
      // starting at min-h-40 and snapping later.
      for (const result of results) {
        if (result.dims) {
          recordDimensions(result.url, result.dims.w, result.dims.h);
        }
      }
      setSlot(backSlotKey, target);
    });
    return () => {
      cancelled = true;
    };
  }, [expanded, activeMediaTab, frontEntry, backEntry, frontSlot, backSlotKey, slotA, slotB, setSlot]);

  // Start the active video as soon as its element mounts, including while it is
  // staged in the hidden back slot behind the previous preview/image. Waiting
  // until that video is promoted creates a circular dependency on mobile
  // WebKit: promotion waits for loadedmetadata, while a hidden preload=metadata
  // video may defer its request until play() is called.
  useEffect(() => {
    if (!shouldActivateQueueVideo) return;
    const slotImg = activeMediaTab?.img;
    if (!slotImg || !isVideoFilename(slotImg.filename)) return;
    const src = getImageUrl(slotImg.filename, slotImg.subfolder, slotImg.type);
    if (playedVideoSources.current.has(src)) {
      // play() is skipped (typically a naturally-ended video being revisited,
      // which keeps its guard so the replay overlay shows). Nothing will fire
      // loadedmetadata for it while it sits hidden, so promote it directly —
      // promoteStagedVideo no-ops unless this src is the staged back entry.
      promoteStagedVideo(src);
      return;
    }
    const videoEl = videoRefs.current.get(src);
    if (!videoEl) return;
    playedVideoSources.current.add(src);
    videoEl.currentTime = 0;
    updateEndedVideoSources((next) => next.delete(src));
    const playPromise = videoEl.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((error) => {
        reportVideoAutoplayRejection('queue card', src, error);
        // Roll the guard back so a later pass (or explicit tap) may retry, and
        // settle the swap: a hidden video whose play() was rejected never
        // reaches loadedmetadata, which would leave the spinner forever.
        playedVideoSources.current.delete(src);
        promoteStagedVideo(src);
      });
    }
    // slotA/slotB are dependencies because the ref callback itself does not
    // trigger a render. Staging a video in either slot is what reruns this
    // effect with the ref ready. The per-src guard above prevents restarts on
    // later slot renders.
  }, [
    shouldActivateQueueVideo,
    activeMediaTab,
    slotA,
    slotB,
    promoteStagedVideo,
    updateEndedVideoSources,
  ]);

  // Losing the queue-wide slot replaces the <video> with a poster and destroys
  // that media element. Let the next element autoplay even though its source is
  // unchanged. A video that naturally ended keeps its guard so it still shows
  // the explicit replay affordance when this card becomes active again.
  useEffect(() => {
    if (!shouldActivateQueueVideo || !activeQueueVideoSrc) return;
    const playedSources = playedVideoSources.current;
    return () => {
      if (!endedVideoSourcesRef.current.has(activeQueueVideoSrc)) {
        playedSources.delete(activeQueueVideoSrc);
      }
    };
  }, [activeQueueVideoSrc, shouldActivateQueueVideo]);

  // Un-guard a video once it leaves both slots so revisiting its tab
  // autoplays again — swapping away mid-play unmounts the <video> without an
  // `ended` event, and the played-guard otherwise left the revisited tab
  // frozen at frame 0 with no replay overlay and no controls. Videos that
  // finished keep their guard: they show the explicit replay overlay instead.
  useEffect(() => {
    const liveSrcs = new Set<string>();
    // Stacked layout paints entries immediately, before the tabbed A/B slot
    // state is initialized. Count its selected video as live so this cleanup
    // cannot remove the just-added play guard and start it a second time on the
    // slot-state render.
    if (
      queueOutputLayout === 'stacked' &&
      activeMediaTab &&
      !activeMediaTab.rawSrc &&
      isVideoFilename(activeMediaTab.img.filename)
    ) {
      liveSrcs.add(getImageUrl(
        activeMediaTab.img.filename,
        activeMediaTab.img.subfolder,
        activeMediaTab.img.type,
      ));
    }
    for (const entry of [slotA, slotB]) {
      if (!entry || entry.rawSrc || !isVideoFilename(entry.img.filename)) continue;
      liveSrcs.add(getImageUrl(entry.img.filename, entry.img.subfolder, entry.img.type));
    }
    for (const src of [...playedVideoSources.current]) {
      if (!liveSrcs.has(src) && !endedVideoSources.has(src)) {
        playedVideoSources.current.delete(src);
      }
    }
  }, [slotA, slotB, endedVideoSources, queueOutputLayout, activeMediaTab]);
  const promptInputImages = useMemo<PromptPreviewInputImage[]>(
    () => inputMediaEntries.map(({ img, index }) => {
      const src = getImageUrl(img.filename, img.subfolder, img.type);
      return {
        key: `input-${index}`,
        src,
        displaySrc: getQueueImagePreviewUrl(img.filename, img.subfolder, img.type),
        fileId: getHistoryImageFileId(img),
        index,
      };
    }),
    [inputMediaEntries],
  );
  const renderRunningProgress = () => (
    <div className="pointer-events-none absolute inset-x-3 top-2 z-20 text-slate-300">
      {isActuallyRunning && overallProgress != null ? (
        <div className="mx-auto w-full rounded-lg bg-slate-950/45 px-2.5 py-1.5 shadow-sm backdrop-blur-[2px]">
          <div className="mb-1 flex min-w-0 items-center justify-between gap-2 text-[10px] leading-none">
            <span className="min-w-0 truncate font-semibold text-slate-100">
              {executingNodeLabel || t('Running')}
            </span>
            <span className="shrink-0 font-semibold text-cyan-200">{overallProgress}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-slate-800/75">
            <div
              className="h-full bg-cyan-400 transition-none"
              style={{ width: `${Math.min(100, Math.max(0, overallProgress))}%` }}
            />
          </div>
          {displayNodeProgress !== overallProgress && (
            <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-slate-800/60">
              <div
                className="h-full bg-emerald-400/90 transition-none"
                style={{ width: `${Math.min(100, Math.max(0, displayNodeProgress))}%` }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="mx-auto flex w-full items-center gap-2 rounded-lg bg-slate-950/45 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-200 shadow-sm backdrop-blur-[2px]">
          <div className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-cyan-500/25 border-t-cyan-300" />
          <span>{t('Generating...')}</span>
        </div>
      )}
    </div>
  );

  const registerVideoRef = (src: string, el: HTMLVideoElement | null) => {
    if (el) {
      videoRefs.current.set(src, el);
    } else {
      videoRefs.current.delete(src);
    }
  };

  // The props every QueueMediaEntry needs, derived per media tab. Shared by the
  // tabbed slot and the stacked column/row so the overlay badges stay identical.
  const mediaEntryCommonProps = (tab: MediaTab) => {
    const src = getImageUrl(tab.img.filename, tab.img.subfolder, tab.img.type);
    const fileId = getHistoryImageFileId(tab.img);
    const sizeBytes = outputFileSizes[src];
    return {
      // Desktop: keep a whole card on one page. The media is the only part that
      // grows without bound (a portrait video at full card width is taller than
      // the screen), so it takes the page height minus the bars and the card's
      // own rows; `contain` shrinks the picture inside that box instead of
      // cropping it. Mobile scrolls as before.
      mediaStyle: isDesktop
        ? { maxHeight: 'var(--queue-media-max-height)', objectFit: 'contain' as const }
        : undefined,
      anchorId: item.id,
      hasCompleted,
      durationLabel,
      success,
      shouldShowRunningProgress,
      favorited: favoriteIds.has(fileId),
      rejected: rejectedIds.has(fileId),
      sizeLabel: sizeBytes !== undefined ? formatBytes(sizeBytes) : null,
      dims: outputDimensions[src],
      metadata,
      isTopDoneItem,
      videoActive: tab.key === activeMediaTab?.key && shouldActivateQueueVideo,
      endedVideoSources,
      onMediaClick: handleMediaClick,
      registerVideoRef,
      onVideoEnded: handleVideoEnded,
      onVideoPlay: handleVideoPlay,
      onReplay: handleReplayClick,
      recordDimensions,
      // The heart is an enter-only action (matching the viewer and outputs
      // panel). A favorited item is cleared through the contextual X action.
      onToggleFavorite: () => {
        if (!favoriteIds.has(fileId)) toggleFavorite(fileId);
      },
      onToggleReject: () => {
        if (favoriteIds.has(fileId)) toggleFavorite(fileId);
        else toggleRejected(fileId);
      },
    };
  };

  return (
    <div ref={cardRootRef} className="bg-slate-900/95 rounded-xl shadow-sm border border-white/10 overflow-hidden transition-all duration-300">
      <div onClick={handleToggle} data-scroll-anchor-id={`${item.id}::header`} className={`px-3 py-2 border-b transition-colors duration-200 grid ${headerGridClass} items-center gap-2 cursor-pointer select-none ${isGenerating ? `bg-cyan-500/10 ${expanded ? 'border-cyan-400/20' : 'border-transparent'}` : `bg-slate-900/95 ${expanded ? 'border-white/10' : 'border-transparent'}`}`}>
        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
          <button
            onClick={handleToggleButtonClick}
            className="w-8 h-8 -ml-2 flex items-center justify-center text-slate-400 hover:text-slate-100 shrink-0"
          >
            <FoldIcon open={expanded} className="w-6 h-6" />
          </button>
          {isGenerating && <span className="w-2 h-2 bg-cyan-300 rounded-full animate-pulse" />}
          {wasAutoRestored && (
            <span className="rounded border border-cyan-300/30 bg-cyan-400/15 px-1.5 py-0.5 text-[10px] font-bold text-cyan-200">
              AUTO-RESTORED
            </span>
          )}
          {isRunning && isActuallyRunning && overallProgress != null && (
            <span className="ml-1 text-xs font-semibold text-cyan-300">{Math.min(100, Math.max(0, overallProgress))}%</span>
          )}
        </div>
        <div className="pointer-events-none flex w-full min-w-0 max-w-full flex-col items-center justify-center overflow-hidden text-center leading-tight">
          {(workflowLabel || (isDone && showQueueTimestamps)) && (
            <span className="flex w-full min-w-0 items-baseline justify-center gap-1 text-xs font-medium text-slate-300">
              {workflowLabel && (
                <span className={`flex min-w-0 items-center gap-1 ${isHiddenWorkflowItem ? 'italic text-slate-400' : ''}`}>
                  {isHiddenWorkflowItem && <EyeOffIcon className="h-3 w-3 shrink-0" />}
                  <span className="min-w-0 truncate">{workflowLabel}</span>
                </span>
              )}
              {isDone && showQueueTimestamps && (
                <span className="shrink-0 text-[11px] font-medium text-slate-500">
                  ({new Date(item.timestamp || 0).toLocaleTimeString()})
                </span>
              )}
            </span>
          )}
          {headerLabel && (
            <span className={`mt-0.5 flex w-full min-w-0 items-center justify-center gap-1 text-[11px] font-medium ${
              isGenerating
                ? 'text-cyan-300'
                : isFailedDoneItem
                  ? 'text-red-400'
                  : isPending || isCompleting
                    ? 'text-slate-400'
                    : 'text-slate-500'
            }`}>
              <CornerDownRightIcon className="h-3 w-3 shrink-0 text-slate-600" />
              <span className={`min-w-0 truncate ${isGenerating || isPending || isCompleting || isFailedDoneItem ? 'font-bold' : ''}`}>
                {headerLabel}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 min-w-0 overflow-hidden justify-end justify-self-end">
          {(isRunning || isPending || isDone) && (
            <ContextMenuButton
              onClick={handleOpenMenuClick}
              ariaLabel={t('Image options')}
              buttonSize={7}
              iconSize={4}
            />
          )}
        </div>
      </div>

      <Collapsible open={expanded}>
        <div className="relative w-full">
          {showPromptPreview && (
            <PromptPreview
              promptId={previewPromptId}
              anchorBaseId={item.id}
              workflow={queuedWorkflow}
              inputImages={promptInputImages}
              onInputImageClick={(src, index) => handleMediaClick(src, index, isTopDoneItem)()}
            />
          )}
          <div className={`relative ${isRunning && mediaTabs.length === 0 ? 'min-h-16 bg-slate-950/80' : ''}`}>
            {shouldShowRunningProgress && renderRunningProgress()}
            {mediaTabs.length > 0 ? (
              queueOutputLayout === 'stacked' ? (
                // Stacked: every output at once. Desktop lays them in a single
                // centered row sized to fit the width or 70vh tall (uniform
                // shrink, no horizontal scroll); mobile stacks them in a column.
                <div className={isDesktop ? 'flex flex-nowrap items-start justify-center gap-1' : 'flex flex-col gap-1'}>
                  {mediaTabs.map((tab) => {
                    const stackSrc = tab.rawSrc ?? getImageUrl(tab.img.filename, tab.img.subfolder, tab.img.type);
                    const stackDims = outputDimensions[stackSrc];
                    const aspect = stackDims && stackDims.h > 0 ? stackDims.w / stackDims.h : 1;
                    if (isDesktop) {
                      return (
                        <div
                          key={tab.key}
                          className="relative min-w-0"
                          // basis ∝ aspect → flex-shrink scales every item by the
                          // same factor, so heights stay equal and cap at the
                          // same one-page budget the single-slot layout uses.
                          style={{
                            flexGrow: 0,
                            flexShrink: 1,
                            flexBasis: `calc(${aspect} * var(--queue-media-max-height))`,
                          }}
                        >
                          <QueueMediaEntry
                            entry={tab}
                            {...mediaEntryCommonProps(tab)}
                            mediaStyle={{ aspectRatio: String(aspect) }}
                            onMediaReady={notifyCardMediaReady}
                          />
                        </div>
                      );
                    }
                    return (
                      <QueueMediaEntry
                        key={tab.key}
                        entry={tab}
                        {...mediaEntryCommonProps(tab)}
                        onMediaReady={notifyCardMediaReady}
                      />
                    );
                  })}
                </div>
              ) : (
              <div className="flex flex-col">
                {/* Single image slot — uses a two-position model (A/B). The
                    "front" slot is the visible one; the "back" slot is the
                    next entry, mounted invisibly so its <img> can fully load
                    behind the scenes. When the back's onMediaReady fires we
                    flip `frontSlot`, so the previously-back QueueMediaEntry
                    becomes visible without ever remounting — guaranteeing
                    the previous image stays painted until the new one is
                    ready. */}
                <div className="relative">
                  {slotA && (
                    <div
                      className={frontSlot === 'A'
                        ? 'relative z-10'
                        : 'absolute inset-0 z-0 opacity-0 pointer-events-none'}
                      aria-hidden={frontSlot !== 'A'}
                    >
                      <QueueMediaEntry
                        key={`A:${slotA.key}`}
                        entry={slotA}
                        {...mediaEntryCommonProps(slotA)}
                        onMediaReady={() => {
                          notifyCardMediaReady();
                          if (frontSlot !== 'A') promoteBack(slotA.key);
                        }}
                      />
                    </div>
                  )}
                  {slotB && (
                    <div
                      className={frontSlot === 'B'
                        ? 'relative z-10'
                        : 'absolute inset-0 z-0 opacity-0 pointer-events-none'}
                      aria-hidden={frontSlot !== 'B'}
                    >
                      <QueueMediaEntry
                        key={`B:${slotB.key}`}
                        entry={slotB}
                        {...mediaEntryCommonProps(slotB)}
                        onMediaReady={() => {
                          notifyCardMediaReady();
                          if (frontSlot !== 'B') promoteBack(slotB.key);
                        }}
                      />
                    </div>
                  )}
                  {/* Subtle progress hint on slow tab taps so the visible image
                      doesn't feel frozen. The QueueMediaEntry's own spinner
                      stays out of view (it's on the hidden back slot). */}
                  {isSwappingMedia && (
                    <div className="queue-media-swap-spinner pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                      <div className="h-[72px] w-[72px] rounded-full border-[6px] border-white/25 border-t-cyan-300 animate-spin" />
                    </div>
                  )}
                </div>
                {/* Thumbnail tab bar under the slot; one thumbnail per media
                    entry with a label badge, tap to pin a preview/output. */}
                {mediaTabs.length > 1 && (
                  <div className="queue-media-tabs flex items-stretch gap-1.5 overflow-x-auto bg-slate-950/80 px-1.5 py-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                    {mediaTabs.map((tab) => {
                      const isActive = activeMediaTab?.key === tab.key;
                      const isVideoThumb = !tab.rawSrc && isVideoFilename(tab.img.filename);
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => selectMediaTab(tab)}
                          aria-label={tab.label}
                          title={tab.label}
                          className={`relative shrink-0 overflow-hidden rounded transition-all ${
                            isActive
                              ? 'ring-2 ring-cyan-400'
                              : 'opacity-60 ring-1 ring-white/10 hover:opacity-100'
                          }`}
                        >
                          {isVideoThumb ? (
                            <img
                              src={getMediaThumbnailUrl(tab.img.filename, tab.img.subfolder, tab.img.type)}
                              alt={tab.label}
                              loading="lazy"
                              decoding="async"
                              className="block h-16 w-20 object-cover"
                            />
                          ) : (
                            <img
                              src={tab.rawSrc ?? getQueueImagePreviewUrl(tab.img.filename, tab.img.subfolder, tab.img.type)}
                              alt={tab.label}
                              loading="lazy"
                              className="block h-16 w-20 object-cover"
                            />
                          )}
                          <span className="absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0.5 text-center text-[9px] font-semibold leading-tight text-white backdrop-blur-sm">
                            {tab.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              )
            ) : isDone ? (
              <div className={placeholderClass}>
                <span className={donePlaceholderClass}>{donePlaceholderMessage}</span>
              </div>
            ) : isRunning ? null : (
              <div className={placeholderClass} style={{ minHeight: '100px' }}>
                <LoadingSpinner size="lg" color="gray" />
                <span className="text-xs mt-2 opacity-40">Waiting to start...</span>
              </div>
            )}
          </div>
        </div>
      </Collapsible>
    </div>
  );
}

function formatDuration(seconds?: number): string | null {
  if (seconds === undefined || Number.isNaN(seconds)) return null;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

// Memoized: the queue list re-renders on every progress tick, but a card only
// needs to re-render when its own props change. The list gates the per-tick
// progress props to the running card only, so idle/done cards stay static.
export const QueueCard = memo(QueueCardComponent);

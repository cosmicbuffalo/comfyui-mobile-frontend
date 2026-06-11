import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { getImageUrl, getImagePreviewUrl } from '@/api/client';
import type { Workflow } from '@/api/types';
import { useQueueStore } from '@/hooks/useQueue';
import { useOutputsStore } from '@/hooks/useOutputs';
import { useWorkflowStore, type WorkflowSource } from '@/hooks/useWorkflow';
import { isWorkflowHidden } from '@/utils/workflowHidden';
import { extractMetadata } from '@/utils/metadata';
import { CheckIcon, CloudDownloadIcon, CornerDownRightIcon, EyeOffIcon, HeartIcon, XSmallIcon } from '@/components/icons';
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

// One entry in the queue item's image slot / tab bar.
interface MediaTab {
  key: string;
  img: HistoryOutputImage;
  index: number;
  isPreview: boolean;
  label: string;
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
  downloaded: Record<string, boolean>;
  isTopDoneItem: boolean;
}

function getQueuedWorkflow(data: UnifiedItem['data']): Workflow | undefined {
  if (isHistoryEntryData(data)) return data.workflow;
  const extra = (data as QueueItemData).extra as {
    extra_pnginfo?: { workflow?: Workflow };
  } | undefined;
  return extra?.extra_pnginfo?.workflow;
}

function sessionDisplayLabel(
  filename: string | null,
  source: WorkflowSource | null,
): string {
  if (filename) return getDisplayName(filename);
  if (source && source.type === 'template') return source.templateName;
  return 'Untitled';
}

function getPreferredOutputFilename(images: HistoryOutputImage[]): string | null {
  // `.filter()` returns a fresh array, so reversing it in place is safe.
  const outputImages = images.filter((img) => img.type === 'output').reverse();
  const videoOutput = outputImages.find((img) => isVideoFilename(img.filename));
  if (videoOutput) return videoOutput.filename;
  const imageOutput = outputImages.find((img) => !isVideoFilename(img.filename));
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
  downloaded,
  isTopDoneItem
}: QueueCardProps) {
  const previewVisibility = useQueueStore((s) => s.previewVisibility);
  const previewVisibilityDefault = useQueueStore((s) => s.previewVisibilityDefault);
  const showQueueMetadata = useQueueStore((s) => s.showQueueMetadata);
  const showQueueTimestamps = useQueueStore((s) => s.showQueueTimestamps);
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
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const playedVideoSources = useRef(new Set<string>());
  const mediaOrderRef = useRef<string[]>([]);
  const mediaOrderPromptIdRef = useRef(item.id);
  const [endedVideoSources, setEndedVideoSources] = useState<Set<string>>(new Set());
  // Single image slot + tab bar: which media entry is shown. `mediaTabPinned`
  // means the user explicitly tapped a tab; until then the slot auto-follows the
  // newest/highest-priority entry (latest output, or latest preview if no output
  // yet) so it doesn't fight live preview streaming.
  const [activeMediaKey, setActiveMediaKey] = useState<string | null>(null);
  const [mediaTabPinned, setMediaTabPinned] = useState(false);
  // The entry the slot is actually rendering. It lags the selected/auto target
  // while the replacement preloads, so the current media keeps painting (no
  // collapse) until the new one is decoded and can swap in without a layout
  // shift. Holding the whole descriptor — not just a key — lets it keep showing
  // a preview even after the preview leaves the list at completion, until the
  // final output is ready.
  const [displayedEntry, setDisplayedEntry] = useState<MediaTab | null>(null);
  const [outputFileSizes, setOutputFileSizes] = useState<Record<string, number>>({});
  const sizeFetchRef = useRef<Set<string>>(new Set());
  // Pixel dimensions per output src, captured from the loaded media (images via
  // naturalWidth/Height, videos via videoWidth/Height) for the resolution badge.
  const [outputDimensions, setOutputDimensions] = useState<
    Record<string, { w: number; h: number }>
  >({});
  const recordDimensions = (src: string, w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    setOutputDimensions((prev) => (prev[src] ? prev : { ...prev, [src]: { w, h } }));
  };
  const isPending = item.status === 'pending' && !isActuallyRunning;
  const isRunning = item.status === 'running' || isActuallyRunning;
  const isGenerating = isRunning && !isCompleting;
  const isDone = item.status === 'done';
  const queuedWorkflow = useMemo(() => getQueuedWorkflow(item.data), [item.data]);
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
  const workflowLabel = owningWorkflow.label ?? serverMetadata?.workflowLabel ?? null;

  const hasStoredExpanded = queueItemExpanded !== undefined;
  const expanded = hasStoredExpanded ? queueItemExpanded : false;
  const prevIsDoneRef = useRef(isDone);

  useEffect(() => {
    if (!hasStoredExpanded) {
      setQueueItemExpanded(item.id, false);
    }
  }, [hasStoredExpanded, item.id, setQueueItemExpanded]);

  useEffect(() => {
    if (!prevIsDoneRef.current && isDone && !queueItemUserToggled) {
      setQueueItemExpanded(item.id, true);
    }
    prevIsDoneRef.current = isDone;
  }, [isDone, item.id, queueItemUserToggled, setQueueItemExpanded]);

  useEffect(() => {
    playedVideoSources.current.clear();
    setEndedVideoSources(new Set());
  }, [item.id]);

  const handleToggle = () => {
    setQueueItemUserToggled(item.id, true);
    setQueueItemExpanded(item.id, !expanded);
  };

  const showPromptPreview = useQueueStore((s) => s.showPromptPreview);
  const previewPromptId = item.data.prompt_id || item.id;
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
  const sourceImages = useMemo(() => {
    if (mediaOrderPromptIdRef.current !== item.id) {
      mediaOrderPromptIdRef.current = item.id;
      mediaOrderRef.current = [];
    }
    const nextImages = getDisplayableQueueOutputs(dedupeQueueImages([
      ...(historyData && showPromptPreview ? getPromptInputImages(historyData.prompt) : []),
      ...(historyData ? historyData.outputs.images : (isRunning ? runningImages : [])),
    ]), { includeInputImages: showPromptPreview });
    const orderedImages = preserveQueueImageOrder(mediaOrderRef.current, nextImages);
    mediaOrderRef.current = orderedImages.map(getQueueImageKey);
    return orderedImages;
  }, [historyData, isRunning, item.id, runningImages, showPromptPreview]);
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
    setDisplayedEntry(null);
  }, [item.id]);

  useEffect(() => {
    if (!isRunning || visibleImages.length === 0 || expanded || queueItemUserToggled) return;
    setQueueItemExpanded(item.id, true);
  }, [expanded, isRunning, item.id, queueItemUserToggled, setQueueItemExpanded, visibleImages.length]);

  const placeholderClass ='aspect-square w-full bg-slate-950/80 flex flex-col items-center justify-center text-slate-400';
  const durationSeconds = historyData?.durationSeconds ?? completionDurationSeconds;
  const hasCompleted = isDone || completionDurationSeconds !== undefined;
  const success = historyData ? historyData.success !== false : true;
  const donePlaceholderMessage = isFailedDoneItem
    ? historyData?.errorMessage || 'Execution failed'
    : 'No images saved';
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
        : getImagePreviewUrl(img.filename, img.subfolder, img.type),
      alt: 'Generation',
      mediaType: getMediaType(img.filename)
    }))
  ), [visibleImages]);
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
    setEndedVideoSources((prev) => new Set(prev).add(src));
  };

  const handleVideoPlay = (src: string) => () => {
    setEndedVideoSources((prev) => {
      const next = new Set(prev);
      next.delete(src);
      return next;
    });
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
    videoEl.currentTime = 0;
    const playPromise = videoEl.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
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
  const mediaTabs = useMemo<MediaTab[]>(() => {
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
        label: `${isPreview ? 'Preview' : 'Output'} #${labelIndex}`,
      };
    });
  }, [fullWidthMediaEntries, hasCompleted]);
  // Auto-target (when the user hasn't pinned a tab). Video wins: if any tab is a
  // video, default to the latest video — so once a video is shown, a later image
  // output never auto-steals the slot. Otherwise default to the latest output,
  // falling back to the latest preview before any output exists. (Tab order is
  // unaffected; this only chooses which one is shown by default.)
  const autoMediaTab = useMemo(() => {
    if (mediaTabs.length === 0) return null;
    const videos = mediaTabs.filter((tab) => isVideoFilename(tab.img.filename));
    if (videos.length > 0) return videos[videos.length - 1];
    const outputs = mediaTabs.filter((tab) => !tab.isPreview);
    const pool = outputs.length > 0 ? outputs : mediaTabs;
    return pool[pool.length - 1];
  }, [mediaTabs]);
  const activeMediaTab = useMemo(() => {
    if (mediaTabPinned && activeMediaKey) {
      const pinned = mediaTabs.find((tab) => tab.key === activeMediaKey);
      if (pinned) return pinned;
    }
    return autoMediaTab;
  }, [mediaTabPinned, activeMediaKey, mediaTabs, autoMediaTab]);
  // The entry the slot actually renders: whatever has finished loading, falling
  // back to the selected tab (first paint, or when the held entry vanishes).
  const slotTab = displayedEntry ?? activeMediaTab;
  const isSwappingMedia = Boolean(
    activeMediaTab && displayedEntry && activeMediaTab.key !== displayedEntry.key,
  );

  // Drive the slot from `displayedEntry`, swapping only once the newly targeted
  // media is decoded. Until then the current media keeps painting (with a
  // spinner over it), so switching tabs — and the preview→output handoff at
  // completion — never collapses the card or flashes empty.
  useEffect(() => {
    const target = activeMediaTab;
    if (!target) {
      if (displayedEntry !== null) setDisplayedEntry(null);
      return;
    }
    if (displayedEntry?.key === target.key) {
      // Same media, but its metadata may have changed (e.g. a preview becoming
      // the final output at completion) — refresh in place without a preload.
      if (
        displayedEntry.isPreview !== target.isPreview ||
        displayedEntry.index !== target.index
      ) {
        setDisplayedEntry(target);
      }
      return;
    }
    // Nothing shown yet → show immediately; there's no current image to hold.
    // Videos manage their own loading via the <video> element, so swap straight
    // away rather than blocking on a background preload.
    if (displayedEntry === null || isVideoFilename(target.img.filename)) {
      setDisplayedEntry(target);
      return;
    }
    let cancelled = false;
    void preloadQueueMedia([target.img]).then(() => {
      if (!cancelled) setDisplayedEntry(target);
    });
    return () => {
      cancelled = true;
    };
  }, [activeMediaTab, displayedEntry]);

  // Autoplay the video occupying the single slot once it mounts. Only the
  // displayed entry is rendered, so this keys on the slot tab rather than every
  // visible image; the per-src guard keeps it from restarting on tab switches.
  useEffect(() => {
    if (!expanded) return;
    const slotImg = slotTab?.img;
    if (!slotImg || !isVideoFilename(slotImg.filename)) return;
    const src = getImageUrl(slotImg.filename, slotImg.subfolder, slotImg.type);
    if (playedVideoSources.current.has(src)) return;
    const videoEl = videoRefs.current.get(src);
    if (!videoEl) return;
    playedVideoSources.current.add(src);
    videoEl.currentTime = 0;
    setEndedVideoSources((prev) => {
      const next = new Set(prev);
      next.delete(src);
      return next;
    });
    const playPromise = videoEl.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }, [expanded, slotTab]);
  const promptInputImages = useMemo<PromptPreviewInputImage[]>(
    () => inputMediaEntries.map(({ img, index }) => {
      const src = getImageUrl(img.filename, img.subfolder, img.type);
      return {
        key: `input-${index}`,
        src,
        displaySrc: getImagePreviewUrl(img.filename, img.subfolder, img.type),
        isDownloaded: Boolean(downloaded[src]),
        index,
      };
    }),
    [inputMediaEntries, downloaded],
  );
  const renderRunningProgress = () => (
    <div className="pointer-events-none absolute inset-x-3 top-2 z-20 text-slate-300">
      {isActuallyRunning && overallProgress != null ? (
        <div className="mx-auto w-full rounded-lg bg-slate-950/45 px-2.5 py-1.5 shadow-sm backdrop-blur-[2px]">
          <div className="mb-1 flex min-w-0 items-center justify-between gap-2 text-[10px] leading-none">
            <span className="min-w-0 truncate font-semibold text-slate-100">
              {executingNodeLabel || 'Running'}
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
          <span>Generating...</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="bg-slate-900/95 rounded-xl shadow-sm border border-white/10 overflow-hidden transition-all duration-300">
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
              ariaLabel="Image options"
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
          <div className={`relative ${isRunning && fullWidthMediaEntries.length === 0 ? 'min-h-16 bg-slate-950/80' : ''}`}>
            {shouldShowRunningProgress && renderRunningProgress()}
            {fullWidthMediaEntries.length > 0 ? (
              <div className="flex flex-col">
                {/* Single image slot — shows one entry at a time so streaming
                    previews and the final output swap in place instead of
                    stacking and resizing the card. */}
                <div className="relative">
                  {slotTab && (() => {
                    const { img, index, isPreview } = slotTab;
                    // The completion websocket event arrives before history, so
                    // use its locally measured duration during that handoff.
                    const showDurationLabel = hasCompleted && img.type === 'output' && durationLabel;
                    const src = getImageUrl(img.filename, img.subfolder, img.type);
                    // Display the fast WebP; keep `src` (PNG) for click/download/identity.
                    const displaySrc = isVideoFilename(img.filename)
                      ? src
                      : getImagePreviewUrl(img.filename, img.subfolder, img.type);
                    const isDownloaded = downloaded[src];
                    const isFavorited = favoriteIds.has(getHistoryImageFileId(img));
                    const sizeBytes = outputFileSizes[src];
                    const sizeLabel = sizeBytes !== undefined ? formatBytes(sizeBytes) : null;
                    const dims = outputDimensions[src];

                    return (
                      <div key={getQueueImageKey(img)} data-scroll-anchor-id={`${item.id}::media::${img.filename}`} className="relative">
                        {isPreview && (
                          <div className={`absolute left-2 z-10 rounded bg-black/60 px-2 py-1 text-xs font-semibold text-white backdrop-blur-sm shadow-sm ${
                            shouldShowRunningProgress ? 'top-14' : 'top-2'
                          }`}>
                            PREVIEW
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
                        {isVideoFilename(img.filename) ? (
                          <>
                            <video
                              src={src}
                              className="w-full h-auto block"
                              muted
                              playsInline
                              preload="metadata"
                              ref={(el) => {
                                if (el) {
                                  videoRefs.current.set(src, el);
                                } else {
                                  videoRefs.current.delete(src);
                                }
                              }}
                              onEnded={handleVideoEnded(src)}
                              onPlay={handleVideoPlay(src)}
                              onLoadedMetadata={(e) =>
                                recordDimensions(src, e.currentTarget.videoWidth, e.currentTarget.videoHeight)
                              }
                              onClick={handleMediaClick(src, index, isTopDoneItem)}
                            />
                            {endedVideoSources.has(src) && (
                              <button
                                type="button"
                                className="absolute inset-0 flex items-center justify-center bg-black/35 text-white"
                                onClick={handleReplayClick(src)}
                                aria-label="Replay video"
                              >
                                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-2xl">
                                  ↻
                                </span>
                              </button>
                            )}
                          </>
                        ) : (
                          <img
                            src={displaySrc}
                            alt="Generation"
                            className="w-full h-auto block"
                            loading="lazy"
                            onLoad={(e) =>
                              recordDimensions(src, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)
                            }
                            onClick={handleMediaClick(src, index, isTopDoneItem)}
                          />
                        )}
                        {isDownloaded && (
                          <div className={`absolute right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center ${
                            isFavorited ? 'bottom-10' : 'bottom-2'
                          }`}>
                            <CloudDownloadIcon className="w-4 h-4" />
                          </div>
                        )}
                        {isFavorited && (
                          <div className="favorite-badge-container absolute bottom-2 right-2 pointer-events-none">
                            <HeartIcon className="w-6 h-6 text-red-500 drop-shadow" />
                          </div>
                        )}
                        {(sizeLabel || dims) && (
                          <div className="absolute bottom-2 left-2 flex items-center gap-1 pointer-events-none">
                            {sizeLabel && (
                              <span className="px-2 py-1 text-xs font-semibold rounded bg-black/60 text-white backdrop-blur-sm shadow-sm">
                                {sizeLabel}
                              </span>
                            )}
                            {dims && (
                              <span className="resolution-badge inline-flex items-center px-2 py-1 text-xs font-semibold rounded bg-black/60 text-white backdrop-blur-sm shadow-sm">
                                {dims.w}
                                {/* Lift the separator off the baseline so it sits at
                                    the vertical center of the digits' cap height. */}
                                <span aria-hidden="true" className="relative -top-[0.1em] mx-0.5 text-[0.85em] opacity-80">x</span>
                                {dims.h}
                              </span>
                            )}
                          </div>
                        )}
                        {metadata && (
                          <div className={`absolute right-2 flex flex-col-reverse items-end gap-1 pointer-events-none ${
                            isDownloaded && isFavorited
                              ? 'bottom-[4.5rem]'
                              : isDownloaded || isFavorited
                                ? 'bottom-10'
                                : 'bottom-2'
                          }`}>
                            {metadata.model && <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">model: {metadata.model}</div>}
                            {metadata.sampler && <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">sampler: {metadata.sampler}</div>}
                            {metadata.steps && <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">steps: {metadata.steps}</div>}
                            {metadata.cfg && <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">cfg: {metadata.cfg}</div>}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* Spinner over the current image while the newly selected
                      one decodes in the background, before it swaps in. */}
                  {isSwappingMedia && (
                    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 pointer-events-none">
                      <div className="h-10 w-10 rounded-full border-4 border-white/25 border-t-cyan-300 animate-spin" />
                    </div>
                  )}
                </div>
                {/* Tab bar grows sideways under the slot; one tab per media
                    entry, tap to pin a specific preview/output. */}
                {mediaTabs.length > 1 && (
                  <div className="queue-media-tabs flex items-stretch gap-1 overflow-x-auto bg-slate-950/80 px-1.5 py-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                    {mediaTabs.map((tab) => {
                      const isActive = activeMediaTab?.key === tab.key;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => {
                            setActiveMediaKey(tab.key);
                            setMediaTabPinned(true);
                          }}
                          className={`shrink-0 whitespace-nowrap rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                            isActive
                              ? 'bg-cyan-500 text-slate-950'
                              : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80'
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
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

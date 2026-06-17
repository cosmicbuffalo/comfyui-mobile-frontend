import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTextareaFocus } from '@/hooks/useTextareaFocus';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useImageViewerStore } from '@/hooks/useImageViewer';
import { usePinnedWidgetStore } from '@/hooks/usePinnedWidget';
import type { ViewerImage } from '@/utils/viewerImages';
import { MediaViewerHeader } from './MediaViewer/Header';
import { MediaViewerActions } from './MediaViewer/Actions';
import { MediaViewerMetadata } from './MediaViewer/Metadata';
import { CloseButton } from '@/components/buttons/CloseButton';
import { extractMetadata } from '@/utils/metadata';
import { isVideoFilename } from '@/utils/media';
import { getFileWorkflowAvailability, getImageMetadata } from '@/api/client';
import { resolveFilePath, resolveFileSource } from '@/utils/workflowOperations';

interface MediaViewerProps {
  open: boolean;
  items: ViewerImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onDelete: (item: ViewerImage) => void;
  onLoadWorkflow: (item: ViewerImage) => void;
  onLoadInWorkflow: (item: ViewerImage) => void;
  onToggleFavorite?: (item: ViewerImage) => void;
  isFavorited?: (item: ViewerImage) => boolean;
  onDownload?: (item: ViewerImage) => void;
  showMetadataToggle?: boolean;
  showLoadingPlaceholder?: boolean;
  loadingProgress?: number;
  loadingLabel?: string;
  loadWorkflowProgress?: number | null;
  initialScale?: number;
  initialTranslate?: { x: number; y: number };
  onTransformChange?: (scale: number, translate: { x: number; y: number }) => void;
  zoomResetKey?: string | number | null;
}

const DEFAULT_TRANSLATE = { x: 0, y: 0 };
const MEDIA_VIEWER_Z_INDEX = 2100;
const MEDIA_VIEWER_OVERLAY_Z_INDEX = MEDIA_VIEWER_Z_INDEX + 10;
const PRELOAD_IMAGE_COUNT_PER_SIDE = 2;
const PRELOAD_RETENTION_INDEX_BUFFER = 3;
// Cap the "already decoded" hint map so a long browse over a huge folder doesn't
// grow it unbounded. It only suppresses a spinner flash, so resetting on overflow
// is harmless (at worst a brief spinner if a dropped image is revisited).
const LOADED_SRCS_MAX = 256;
const workflowAvailabilityCache = new Map<string, boolean>();

function makeWorkflowAvailabilityCacheKey(source: string, path: string): string {
  return `${source}:${path}`;
}

function isEditableElement(element: HTMLElement | null): boolean {
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  return element.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
}

function getFullScreenImageSrc(item: ViewerImage): string {
  const name = item.filename ?? item.file?.name ?? item.src;
  return /\.jpe?g(?:$|[?#])/i.test(name) ? item.src : (item.displaySrc ?? item.src);
}

function isViewerVideo(item: ViewerImage): boolean {
  const name = item.filename ?? item.file?.name ?? item.alt ?? item.src ?? '';
  return Boolean(
    item.mediaType === 'video' ||
    item.file?.type === 'video' ||
    (name && isVideoFilename(name))
  );
}

export function MediaViewer({
  open,
  items,
  index,
  onIndexChange,
  onClose,
  onDelete,
  onLoadWorkflow,
  onLoadInWorkflow,
  onToggleFavorite,
  isFavorited,
  onDownload,
  showMetadataToggle = false,
  showLoadingPlaceholder = false,
  loadingProgress = 0,
  loadingLabel,
  loadWorkflowProgress,
  initialScale = 1,
  initialTranslate = DEFAULT_TRANSLATE,
  onTransformChange,
  zoomResetKey,
}: MediaViewerProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const naturalSizeRef = useRef<{ width: number; height: number } | null>(null);
  const adjacentPreloadsRef = useRef<
    Map<string, { image: HTMLImageElement; itemIndex: number }>
  >(new Map());
  // MediaViewer remounts whenever the viewer opens (ImageViewer returns null
  // when closed), so initializing from props is sufficient — no useLayoutEffect
  // needed to re-sync. Re-syncing on every initialScale/initialTranslate prop
  // change creates a feedback loop with onTransformChange: store updates
  // produce new object refs for initialTranslate, the effect calls
  // setTranslate(newRef), state changes, onTransformChange sends it back to
  // the store, which produces another new ref, and so on.
  const [scale, setScale] = useState(initialScale);
  const [translate, setTranslate] = useState(initialTranslate);
  const scaleRef = useRef(initialScale);
  const translateRef = useRef(initialTranslate);

  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const swipeRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const pinchRef = useRef<{
    distance: number;
    scale: number;
    centerX: number;
    centerY: number;
    imagePoint?: { x: number; y: number };
  } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
  const [isIdle, setIsIdle] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetZoomModeRef = useRef<'fit' | 'cover'>('fit');
  const [metadataById, setMetadataById] = useState<Record<string, ReturnType<typeof extractMetadata> | null>>({});
  const [metadataLoading, setMetadataLoading] = useState<Record<string, boolean>>({});
  const [workflowAvailableById, setWorkflowAvailableById] = useState<Record<string, boolean>>({});
  const [workflowLoadingById, setWorkflowLoadingById] = useState<Record<string, boolean>>({});
  const [videoError, setVideoError] = useState(false);
  // Pixel resolution of the currently displayed media, shown under the filename.
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  // Full-screen image srcs that have finished decoding at least once (current
  // swap-preloads + adjacent preloads both report in). Drives the loading
  // spinner: it shows only while the *currently viewed* image isn't loaded yet,
  // so swiping back to an already-loaded image hides it even though a
  // swiped-past image keeps loading in the background.
  const [loadedSrcs, setLoadedSrcs] = useState<Record<string, true>>({});
  const markLoaded = useCallback((src: string | null | undefined) => {
    if (!src) return;
    setLoadedSrcs((prev) => {
      if (prev[src]) return prev;
      if (Object.keys(prev).length >= LOADED_SRCS_MAX) return { [src]: true };
      return { ...prev, [src]: true };
    });
  }, []);
  const { isInputFocused } = useTextareaFocus();
  const setViewerState = useImageViewerStore((s) => s.setViewerState);
  const setFollowQueue = useWorkflowStore((s) => s.setFollowQueue);
  const followQueue = useWorkflowStore((s) => s.followQueue);
  const pinnedWidget = usePinnedWidgetStore((s) => s.pinnedWidget);
  const pinOverlayOpen = usePinnedWidgetStore((s) => s.pinOverlayOpen);
  const togglePinOverlay = usePinnedWidgetStore((s) => s.togglePinOverlay);

  const currentItem = index >= 0 ? (items[index] ?? items[0] ?? null) : null;
  const isVideo = Boolean(currentItem && isViewerVideo(currentItem));

  // Double-buffered display: keep the previously rendered item visible until the
  // next image is decoded, then swap atomically with its computed transform so
  // there's no black flash or top-left jump between images.
  const [displayedItem, setDisplayedItem] = useState<ViewerImage | null>(
    () => (index >= 0 ? (items[index] ?? items[0] ?? null) : null),
  );
  const displayedItemRef = useRef<ViewerImage | null>(null);
  useEffect(() => {
    displayedItemRef.current = displayedItem;
  }, [displayedItem]);
  // When there is no previous item to preserve (initial display, or follow-queue
  // arriving from an empty state) render the current item directly to avoid a
  // one-render-gap black frame before the swap effect fires.
  const renderItem = displayedItem ?? currentItem;

  // Show a centered loading spinner while the *currently viewed* image hasn't
  // finished decoding yet (these full-res outputs can be tens of MB). A short
  // delay keeps fast/cached images from flashing a spinner.
  const currentFullSrc =
    currentItem && !isViewerVideo(currentItem)
      ? getFullScreenImageSrc(currentItem)
      : null;
  const isCurrentImageLoading = Boolean(
    open && currentFullSrc && !loadedSrcs[currentFullSrc],
  );
  const [showImageSpinner, setShowImageSpinner] = useState(false);
  useEffect(() => {
    if (!isCurrentImageLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing debounced spinner visibility to a derived flag
      setShowImageSpinner(false);
      return;
    }
    const timer = window.setTimeout(() => setShowImageSpinner(true), 200);
    return () => window.clearTimeout(timer);
  }, [isCurrentImageLoading]);
  const renderIsVideo = Boolean(renderItem && isViewerVideo(renderItem));
  const renderFullSrc = renderItem && !renderIsVideo ? getFullScreenImageSrc(renderItem) : null;
  const fileId = currentItem?.file?.id ?? null;
  const fetchedMetadata = fileId ? metadataById[fileId] : undefined;
  const metadata = currentItem?.metadata ?? (fetchedMetadata === undefined ? undefined : fetchedMetadata);
  const durationLabel = formatDuration(currentItem?.durationSeconds);
  const displayName = currentItem?.filename || currentItem?.alt || 'Output';
  const showMetadataOverlay = showMetadata && !isIdle;
  const canToggleMetadata = showMetadataToggle;
  const metadataIsLoading = fileId ? Boolean(metadataLoading[fileId]) : false;
  const workflowAvailabilityKnown = fileId ? Object.prototype.hasOwnProperty.call(workflowAvailableById, fileId) : false;
  const workflowIsLoading = fileId ? Boolean(workflowLoadingById[fileId]) : false;
  const canLoadWorkflow = !isVideo
    || Boolean(currentItem?.workflow)
    || (fileId ? Boolean(workflowAvailableById[fileId]) : false);

  const resetIdleTimer = useCallback(() => {
    setIsIdle(false);
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => {
      setIsIdle(true);
    }, 3000);
  }, []);

  const handleToggleMetadata = useCallback(() => {
    resetIdleTimer();
    setShowMetadata((prev) => !prev);
  }, [resetIdleTimer]);

  const handleDeleteClick = useCallback(() => {
    if (!currentItem) return;
    resetIdleTimer();
    onDelete(currentItem);
  }, [currentItem, onDelete, resetIdleTimer]);

  const handleLoadWorkflowClick = useCallback(() => {
    if (!currentItem) return;
    resetIdleTimer();
    onLoadWorkflow(currentItem);
  }, [currentItem, onLoadWorkflow, resetIdleTimer]);

  const handleLoadInWorkflowClick = useCallback(() => {
    if (!currentItem) return;
    resetIdleTimer();
    onLoadInWorkflow(currentItem);
  }, [currentItem, onLoadInWorkflow, resetIdleTimer]);

  const handleToggleFavoriteClick = useCallback(() => {
    if (!currentItem) return;
    resetIdleTimer();
    onToggleFavorite?.(currentItem);
  }, [currentItem, onToggleFavorite, resetIdleTimer]);

  const handleDownloadClick = useCallback(() => {
    if (!currentItem) return;
    resetIdleTimer();
    onDownload?.(currentItem);
  }, [currentItem, onDownload, resetIdleTimer]);

  const shouldIgnoreViewerKeyboard = useCallback(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    if (!isEditableElement(active)) return false;
    if (overlayRef.current?.contains(active)) return true;
    if (pinOverlayOpen) return true;
    if (active.closest('[data-dialog-root="true"], [role="dialog"]')) return true;
    return false;
  }, [pinOverlayOpen]);

  const currentIsFavorited = Boolean(
    currentItem && isFavorited && isFavorited(currentItem),
  );
  const canFavoriteCurrent = Boolean(
    currentItem?.file && onToggleFavorite,
  );
  const canDownloadCurrent = Boolean(currentItem?.src && onDownload);

  useEffect(() => {
    if (open) {
      queueMicrotask(resetIdleTimer);
    } else if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }

    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, [open, resetIdleTimer]);

  // Surface the idle/overlay-hidden state so siblings (the bottom bar) can fade
  // in sync with the viewer overlays. Treat a closed viewer as not-idle so the
  // bottom bar is fully visible again once the viewer leaves the screen.
  useEffect(() => {
    setViewerState({ viewerIdle: open && isIdle });
  }, [open, isIdle, setViewerState]);

  useEffect(() => {
    return () => {
      setViewerState({ viewerIdle: false });
    };
  }, [setViewerState]);

  useEffect(() => {
    if (!open) return;
    targetZoomModeRef.current = 'fit';
    dragRef.current = null;
    swipeRef.current = null;
    pinchRef.current = null;
    lastTapRef.current = null;
  }, [open, index]);

  useEffect(() => {
    if (!open || index < 0 || items.length <= 1) {
      adjacentPreloadsRef.current.clear();
      return;
    }

    const preloadIndexes = new Set<number>();
    for (const direction of [-1, 1]) {
      let found = 0;
      for (
        let candidateIndex = index + direction;
        candidateIndex >= 0 &&
        candidateIndex < items.length &&
        found < PRELOAD_IMAGE_COUNT_PER_SIDE;
        candidateIndex += direction
      ) {
        const candidate = items[candidateIndex];
        if (!candidate || isViewerVideo(candidate)) continue;
        preloadIndexes.add(candidateIndex);
        found += 1;
      }
    }

    const nextPreloads = new Map<
      string,
      { image: HTMLImageElement; itemIndex: number }
    >();
    const currentIndexBySrc = new Map<string, number>();
    items.forEach((item, itemIndex) => {
      if (isViewerVideo(item)) return;
      currentIndexBySrc.set(getFullScreenImageSrc(item), itemIndex);
    });
    for (const [src, preload] of adjacentPreloadsRef.current) {
      const currentItemIndex = currentIndexBySrc.get(src);
      if (
        currentItemIndex !== undefined &&
        Math.abs(currentItemIndex - index) <= PRELOAD_RETENTION_INDEX_BUFFER
      ) {
        nextPreloads.set(src, { ...preload, itemIndex: currentItemIndex });
      }
    }

    const currentSrc = currentItem ? getFullScreenImageSrc(currentItem) : null;
    for (const itemIndex of preloadIndexes) {
      const item = items[itemIndex];
      if (!item) continue;
      const src = getFullScreenImageSrc(item);
      if (!src || src === currentSrc) continue;
      const existing = adjacentPreloadsRef.current.get(src);
      if (existing) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- recording an already-decoded preload into loadedSrcs
        if (existing.image.complete && existing.image.naturalWidth > 0) markLoaded(src);
        nextPreloads.set(src, { ...existing, itemIndex });
        continue;
      }
      const preload = new Image();
      // Report into loadedSrcs so the spinner clears the instant the user swipes
      // onto a preloaded image. Treat error as settled too (don't hang a spinner).
      preload.onload = () => markLoaded(src);
      preload.onerror = () => markLoaded(src);
      preload.src = src;
      nextPreloads.set(src, { image: preload, itemIndex });
    }
    adjacentPreloadsRef.current = nextPreloads;
  }, [open, index, items, currentItem, markLoaded]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setDisplayedItem(null);
      return;
    }
    if (!currentItem) {
      setDisplayedItem(null);
      return;
    }

    const displayed = displayedItemRef.current;
    if (!displayed || currentItem.src === displayed.src) {
      // No swap to preload here (initial open, or the displayed item is already
      // current). The swap-preload below and the adjacent-preload effect both
      // skip the current src, so the visible <img> itself is what clears the
      // spinner — see handleImageLoad and the cached-complete effect below.
      setDisplayedItem(currentItem);
      return;
    }

    // Videos handle their own loading state via <video>; swap immediately.
    const displayedIsVideoItem = isViewerVideo(displayed);
    const currentIsVideoItem = isViewerVideo(currentItem);
    if (displayedIsVideoItem || currentIsVideoItem) {
      setDisplayedItem(currentItem);
      return;
    }

    let cancelled = false;
    const preload = new Image();
    // JPEG orientation is commonly stored in EXIF. ComfyUI's on-the-fly WebP
    // preview strips it, so JPEGs use the original while other formats retain
    // the faster preview path.
    const fullSrc = getFullScreenImageSrc(currentItem);
    preload.src = fullSrc;

    const finish = () => {
      // Mark loaded even when cancelled: a swiped-past image that finishes in
      // the background should count as loaded so returning to it shows no spinner.
      markLoaded(fullSrc);
      if (cancelled) return;

      const container = containerRef.current;
      if (container && preload.naturalWidth > 0) {
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight;
        const ratio = containerWidth / preload.naturalWidth;
        const newBaseSize = { width: containerWidth, height: preload.naturalHeight * ratio };
        const newContainerSize = { width: containerWidth, height: containerHeight };

        const fitHeightScale = containerHeight / newBaseSize.height;
        const newFitScale = Math.min(1, fitHeightScale);
        const newCoverScale = Math.max(1, fitHeightScale);
        const targetScale = targetZoomModeRef.current === 'cover' ? newCoverScale : newFitScale;
        const scaledWidth = newBaseSize.width * targetScale;
        const scaledHeight = newBaseSize.height * targetScale;
        // Mirror clampTranslate: translate is the pan offset, NOT the centering
        // offset (getBaseOffset handles centering in the render). When the
        // scaled image fits inside the container, pan is forced to 0; for cover
        // mode we clamp the centered offset to keep the image within bounds.
        const centeredX = (containerWidth - scaledWidth) / 2;
        const centeredY = (containerHeight - scaledHeight) / 2;
        const clampedTranslate = {
          x: scaledWidth <= containerWidth
            ? 0
            : Math.max(containerWidth - scaledWidth, Math.min(0, centeredX)),
          y: scaledHeight <= containerHeight
            ? 0
            : Math.max(containerHeight - scaledHeight, Math.min(0, centeredY)),
        };

        naturalSizeRef.current = { width: preload.naturalWidth, height: preload.naturalHeight };
        scaleRef.current = targetScale;
        translateRef.current = clampedTranslate;
        setBaseSize(newBaseSize);
        setContainerSize(newContainerSize);
        setScale(targetScale);
        setTranslate(clampedTranslate);
      }

      setDisplayedItem(currentItem);
    };

    if (typeof preload.decode === 'function') {
      preload.decode().then(finish, finish);
    } else {
      preload.onload = finish;
      preload.onerror = finish;
    }

    return () => {
      cancelled = true;
    };
  }, [open, currentItem, markLoaded]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    if (!isVideo) return;
    if (currentItem?.workflow) return;
    if (!currentItem?.file) return;
    if (!fileId) return;
    if (workflowAvailabilityKnown || workflowIsLoading) return;

    const source = resolveFileSource(currentItem.file);
    const path = resolveFilePath(currentItem.file, source);
    const cacheKey = makeWorkflowAvailabilityCacheKey(source, path);
    const cached = workflowAvailabilityCache.get(cacheKey);
    if (cached !== undefined) {
      setWorkflowAvailableById((prev) => ({ ...prev, [fileId]: cached }));
      return;
    }

    const controller = new AbortController();
    setWorkflowLoadingById((prev) => ({ ...prev, [fileId]: true }));
    getFileWorkflowAvailability(path, source, { signal: controller.signal })
      .then((available) => {
        workflowAvailabilityCache.set(cacheKey, available);
        setWorkflowAvailableById((prev) => ({ ...prev, [fileId]: available }));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        workflowAvailabilityCache.set(cacheKey, false);
        setWorkflowAvailableById((prev) => ({ ...prev, [fileId]: false }));
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setWorkflowLoadingById((prev) => ({ ...prev, [fileId]: false }));
      });

    return () => {
      controller.abort();
    };
  }, [
    open,
    isVideo,
    currentItem,
    fileId,
    workflowAvailabilityKnown,
    workflowIsLoading,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setVideoError(false);
    // Clear the resolution subtitle until the new media reports its dimensions.
    setNaturalSize(null);
  }, [renderItem?.src]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    if (!onTransformChange) return;
    onTransformChange(scale, translate);
  }, [open, scale, translate, onTransformChange]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (shouldIgnoreViewerKeyboard()) return;
      // Modifier-keyed shortcuts (Ctrl+F find, Cmd+R reload, etc.) should not
      // be intercepted as viewer shortcuts.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key) {
        case 'ArrowLeft':
          if (index > 0) {
            event.preventDefault();
            resetIdleTimer();
            onIndexChange(index - 1);
          }
          return;
        case 'ArrowRight':
          if (index < items.length - 1) {
            event.preventDefault();
            resetIdleTimer();
            onIndexChange(index + 1);
          }
          return;
        case 'Delete':
        case 'Backspace':
          if (currentItem) {
            event.preventDefault();
            handleDeleteClick();
          }
          return;
        case 'f':
        case 'F':
          if (canFavoriteCurrent) {
            event.preventDefault();
            handleToggleFavoriteClick();
          }
          return;
        case 'w':
        case 'W':
          if (canLoadWorkflow) {
            event.preventDefault();
            handleLoadWorkflowClick();
          }
          return;
        case 'u':
        case 'U':
          if (!isVideo && currentItem) {
            event.preventDefault();
            handleLoadInWorkflowClick();
          }
          return;
        case 'i':
        case 'I':
          if (showMetadataToggle && canToggleMetadata) {
            event.preventDefault();
            handleToggleMetadata();
          }
          return;
        case 'd':
        case 'D':
          if (canDownloadCurrent) {
            event.preventDefault();
            handleDownloadClick();
          }
          return;
        case 'q':
        case 'Q':
          event.preventDefault();
          setFollowQueue(!followQueue);
          return;
        case 'p':
        case 'P':
          if (pinnedWidget) {
            event.preventDefault();
            const willOpen = !pinOverlayOpen;
            togglePinOverlay();
            if (willOpen) {
              // The pinned-widget overlay renders via createPortal at the
              // bottom of the document, so the textarea/input we want to
              // focus is the most recently mounted text input. Place the
              // caret at the end so typing appends.
              setTimeout(() => {
                const inputs = document.querySelectorAll<
                  HTMLTextAreaElement | HTMLInputElement
                >('textarea[data-swipe-nav-ignore="true"], input[data-swipe-nav-ignore="true"]');
                const target = inputs[inputs.length - 1];
                if (!target) return;
                target.focus();
                const value = target.value ?? '';
                try {
                  target.setSelectionRange(value.length, value.length);
                } catch {
                  // Some input types (number, etc.) don't support setSelectionRange.
                }
              }, 0);
            }
          }
          return;
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [
    open,
    onClose,
    shouldIgnoreViewerKeyboard,
    index,
    items.length,
    onIndexChange,
    currentItem,
    isVideo,
    canFavoriteCurrent,
    canLoadWorkflow,
    showMetadataToggle,
    canToggleMetadata,
    resetIdleTimer,
    handleDeleteClick,
    handleToggleFavoriteClick,
    handleLoadWorkflowClick,
    handleLoadInWorkflowClick,
    handleToggleMetadata,
    canDownloadCurrent,
    handleDownloadClick,
    followQueue,
    setFollowQueue,
    pinnedWidget,
    pinOverlayOpen,
    togglePinOverlay,
  ]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open || !showMetadataToggle) return;
    if (!currentItem?.file) return;
    if (currentItem.metadata) return;
    if (!fileId) return;
    if (metadata !== undefined || metadataIsLoading) return;

    const source = resolveFileSource(currentItem.file);
    const path = resolveFilePath(currentItem.file, source);
    setMetadataLoading((prev) => ({ ...prev, [fileId]: true }));
    getImageMetadata(path, source)
      .then((data) => {
        const parsed = data?.prompt ? extractMetadata(data.prompt) : null;
        const next = parsed && Object.keys(parsed).length > 0 ? parsed : null;
        setMetadataById((prev) => ({ ...prev, [fileId]: next }));
      })
      .catch(() => {
        setMetadataById((prev) => ({ ...prev, [fileId]: null }));
      })
      .finally(() => {
        setMetadataLoading((prev) => ({ ...prev, [fileId]: false }));
      });
  }, [open, showMetadataToggle, currentItem, fileId, metadata, metadataIsLoading]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const fitHeightScale = useMemo(() => {
    if (!baseSize || !containerSize) return null;
    return containerSize.height / baseSize.height;
  }, [baseSize, containerSize]);

  const fitScale = useMemo(() => {
    if (fitHeightScale === null) return 1;
    return Math.min(1, fitHeightScale);
  }, [fitHeightScale]);

  const coverScale = useMemo(() => {
    if (fitHeightScale === null) return 1;
    return Math.max(1, fitHeightScale);
  }, [fitHeightScale]);

  const getBaseOffset = (nextScale = scale, baseOverride: { width: number; height: number } | null = baseSize) => {
    if (!baseOverride || !containerSize) return { x: 0, y: 0 };
    const scaledWidth = baseOverride.width * nextScale;
    const scaledHeight = baseOverride.height * nextScale;
    return {
      x: scaledWidth < containerSize.width ? (containerSize.width - scaledWidth) / 2 : 0,
      y: scaledHeight < containerSize.height ? (containerSize.height - scaledHeight) / 2 : 0,
    };
  };

  const clampTranslate = useCallback((next: { x: number; y: number }, nextScale = scale) => {
    if (!baseSize || !containerSize) return next;
    const containerWidth = containerSize.width;
    const containerHeight = containerSize.height;
    const scaledWidth = baseSize.width * nextScale;
    const scaledHeight = baseSize.height * nextScale;

    const clampedX = scaledWidth <= containerWidth
      ? 0
      : Math.max(containerWidth - scaledWidth, Math.min(0, next.x));
    const clampedY = scaledHeight <= containerHeight
      ? 0
      : Math.max(containerHeight - scaledHeight, Math.min(0, next.y));
    return { x: clampedX, y: clampedY };
  }, [baseSize, containerSize, scale]);

  const clampTranslateRef = useRef(clampTranslate);

  const applyZoomMode = useCallback((mode: 'fit' | 'cover') => {
    let targetScale = fitScale;
    switch (mode) {
      case 'cover':
        targetScale = coverScale;
        break;
      case 'fit':
      default:
        targetScale = fitScale;
        break;
    }
    targetZoomModeRef.current = mode;
    scaleRef.current = targetScale;
    setScale(targetScale);
    if (!baseSize || !containerSize) {
      translateRef.current = { x: 0, y: 0 };
      setTranslate({ x: 0, y: 0 });
    } else {
      const scaledWidth = baseSize.width * targetScale;
      const scaledHeight = baseSize.height * targetScale;
      const centered = {
        x: (containerSize.width - scaledWidth) / 2,
        y: (containerSize.height - scaledHeight) / 2,
      };
      const clamped = clampTranslate(centered, targetScale);
      translateRef.current = clamped;
      setTranslate(clamped);
    }
  }, [baseSize, clampTranslate, containerSize, coverScale, fitScale]);

  const applyZoomModeRef = useRef(applyZoomMode);

  useEffect(() => {
    clampTranslateRef.current = clampTranslate;
  }, [clampTranslate]);

  useEffect(() => {
    applyZoomModeRef.current = applyZoomMode;
  }, [applyZoomMode]);

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    // The visible <img> is the only thing that marks the *current* src loaded on
    // the no-swap path (initial open / follow-queue). Key off the same helper the
    // spinner uses, not img.src, so the absolute-resolved URL doesn't mismatch.
    markLoaded(renderItem ? getFullScreenImageSrc(renderItem) : null);
    naturalSizeRef.current = { width: img.naturalWidth, height: img.naturalHeight };
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    }
    const container = containerRef.current;
    if (!container || img.naturalWidth === 0) return;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const ratio = containerWidth / img.naturalWidth;
    setBaseSize({ width: containerWidth, height: img.naturalHeight * ratio });
    setContainerSize({ width: containerWidth, height: containerHeight });
  };

  useEffect(() => {
    if (renderIsVideo) return;
    if (!open) return;
    const img = imageRef.current;
    const container = containerRef.current;
    if (!img || !container) return;

    // An already-cached image may be `complete` before React attaches onLoad, so
    // handleImageLoad never fires — mark it loaded here so the spinner clears.
    if (renderFullSrc && img.complete && img.naturalWidth > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- recording an already-decoded image into loadedSrcs
      markLoaded(renderFullSrc);
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    }

    const updateSizes = () => {
      const natural = naturalSizeRef.current;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      setContainerSize({ width: containerWidth, height: containerHeight });
      if (!natural || natural.width === 0) return;
      const ratio = containerWidth / natural.width;
      const height = natural.height * ratio;
      setBaseSize({ width: containerWidth, height });
      const clamped = clampTranslateRef.current(translateRef.current);
      translateRef.current = clamped;
      setTranslate(clamped);
    };

    updateSizes();
    const observer = new ResizeObserver(updateSizes);
    observer.observe(container);
    return () => observer.disconnect();
  }, [open, renderFullSrc, renderItem?.src, renderIsVideo, markLoaded]);

  useEffect(() => {
    if (renderIsVideo) return;
    if (!open || !baseSize || !containerSize) return;
    applyZoomModeRef.current(targetZoomModeRef.current);
  }, [open, renderItem?.src, baseSize, containerSize, renderIsVideo]);

  useEffect(() => {
    if (!open) return;
    if (zoomResetKey === undefined) return;
    applyZoomModeRef.current(targetZoomModeRef.current);
  }, [open, zoomResetKey]);

  const applyTransformToDOM = () => {
    const img = imageRef.current;
    if (!img) return;
    const s = scaleRef.current;
    const t = translateRef.current;
    const offset = getBaseOffset(s);
    img.style.transform = `translate3d(${offset.x + t.x}px, ${offset.y + t.y}px, 0) scale(${s})`;
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if (isVideo) {
      const videoEl = videoRef.current;
      if (videoEl && event.target === videoEl) {
        const rect = videoEl.getBoundingClientRect();
        if (event.clientY > rect.bottom - 60) {
          return;
        }
      }
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    const pointers = getActivePointers(containerRef.current);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      swipeRef.current = { x: event.clientX, y: event.clientY, time: Date.now() };
      if (!isVideo) {
        dragRef.current = { x: event.clientX - translateRef.current.x, y: event.clientY - translateRef.current.y };

        const img = imageRef.current;
        if (img) img.style.transition = 'none';
      }
    } else if (pointers.size === 2 && !isVideo) {
      const [a, b] = Array.from(pointers.values());
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const centerX = (a.x + b.x) / 2;
      const centerY = (a.y + b.y) / 2;
      const rect = containerRef.current?.getBoundingClientRect();
      const s = scaleRef.current;
      const t = translateRef.current;
      const baseOffset = getBaseOffset(s);
      const imagePoint = rect
        ? {
            x: (centerX - rect.left - baseOffset.x - t.x) / s,
            y: (centerY - rect.top - baseOffset.y - t.y) / s,
          }
        : undefined;
      pinchRef.current = { distance, scale: s, centerX, centerY, imagePoint };
    }
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    const pointers = getActivePointers(containerRef.current);
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 2 && pinchRef.current && !isVideo) {
      const pinch = pinchRef.current;
      const [a, b] = Array.from(pointers.values());
      const nextDistance = Math.hypot(b.x - a.x, b.y - a.y);
      const minScale = fitScale;
      const nextScale = Math.max(minScale, Math.min(5, pinch.scale * (nextDistance / pinch.distance)));
      scaleRef.current = nextScale;
      const rect = containerRef.current?.getBoundingClientRect();
      const centerX = (a.x + b.x) / 2;
      const centerY = (a.y + b.y) / 2;
      if (rect && pinch.imagePoint) {
        const nextBaseOffset = getBaseOffset(nextScale);
        const nextTranslate = {
          x: centerX - rect.left - nextBaseOffset.x - pinch.imagePoint.x * nextScale,
          y: centerY - rect.top - nextBaseOffset.y - pinch.imagePoint.y * nextScale,
        };
        translateRef.current = clampTranslate(nextTranslate, nextScale);
      } else {
        translateRef.current = clampTranslate(translateRef.current, nextScale);
      }
      applyTransformToDOM();
      return;
    }

    if (pointers.size === 1 && !isVideo) {
      const s = scaleRef.current;
      const canPan = s > 1 || (baseSize && containerRef.current && baseSize.height * s > containerRef.current.clientHeight + 1);
      if (canPan && dragRef.current) {
        translateRef.current = clampTranslate({ x: event.clientX - dragRef.current.x, y: event.clientY - dragRef.current.y }, s);
        applyTransformToDOM();
      }
    }
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    const pointers = getActivePointers(containerRef.current);
    pointers.delete(event.pointerId);

    if (pointers.size < 2) {
      if (pointers.size === 1 && pinchRef.current) {
        // Transitioning from pinch to single-finger drag — update drag offset
        const [remaining] = Array.from(pointers.values());
        dragRef.current = { x: remaining.x - translateRef.current.x, y: remaining.y - translateRef.current.y };
      }
      pinchRef.current = null;
    }

    if (pointers.size === 0) {
      // Restore CSS transition before state updates so double-tap animates

      const img = imageRef.current;
      if (img) img.style.transition = 'transform 0.05s linear';

      const now = Date.now();
      const lastTap = lastTapRef.current;
      const dxTap = lastTap ? event.clientX - lastTap.x : 0;
      const dyTap = lastTap ? event.clientY - lastTap.y : 0;
      const isDoubleTap = Boolean(
        lastTap &&
        now - lastTap.time < 300 &&
        Math.hypot(dxTap, dyTap) < 24
      );

      if (!isVideo && isDoubleTap) {
        lastTapRef.current = null;
        const currentMode = targetZoomModeRef.current;
        applyZoomMode(currentMode === 'fit' ? 'cover' : 'fit');
        resetIdleTimer();
      } else {
        lastTapRef.current = { time: now, x: event.clientX, y: event.clientY };
        const swipe = swipeRef.current;
        if (!isInputFocused && swipe) {
          const dx = event.clientX - swipe.x;
          const dy = event.clientY - swipe.y;
          const durationMs = Date.now() - swipe.time;
          const absX = Math.abs(dx);
          const absY = Math.abs(dy);
          const s = scaleRef.current;
          const isFitOrCover = Math.abs(s - fitScale) < 0.05 || Math.abs(s - coverScale) < 0.05;
          const isTap = durationMs < 250 && absX < 10 && absY < 10;
          if (durationMs <= 350 && absX > 60 && absX > absY && isFitOrCover) {
            if (dx < 0) {
              if (index < items.length - 1) {
                onIndexChange(index + 1);
              }
            } else if (dx > 0 && index > 0) {
              onIndexChange(index - 1);
            }
          } else if (isTap) {
            resetIdleTimer();
          }
        }
        // Sync gesture state to React for rendering
        setScale(scaleRef.current);
        setTranslate(translateRef.current);
      }

      dragRef.current = null;
    }
  };

  const handleWheel = useCallback((event: WheelEvent) => {
    if (isVideo) return;

    // No modifier: pan with the scroll wheel / trackpad (desktop). clampTranslate
    // keeps a fit image centered, so this only moves the image when zoomed in.
    if (!event.ctrlKey) {
      event.preventDefault();
      const next = clampTranslate(
        {
          x: translateRef.current.x - event.deltaX,
          y: translateRef.current.y - event.deltaY,
        },
        scaleRef.current,
      );
      translateRef.current = next;
      setTranslate(next);
      return;
    }

    // Ctrl-scroll / trackpad pinch: zoom, anchored at the cursor so the image
    // point under the pointer stays fixed on screen. The rendered transform is
    //   screen = baseOffset(scale) + translate + localPx * scale   (origin top-left)
    // so invert it at the old scale, then solve for the translate that keeps that
    // point under the cursor at the new scale.
    event.preventDefault();
    const prevScale = scaleRef.current;
    const delta = -event.deltaY * 0.005;
    const nextScale = Math.max(fitScale, Math.min(5, prevScale + delta));
    if (nextScale === prevScale) return;

    const container = containerRef.current;
    const prevTranslate = translateRef.current;
    let nextTranslate = prevTranslate;
    if (container && baseSize && containerSize) {
      const rect = container.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      const baseOffset = (s: number) => {
        const w = baseSize.width * s;
        const h = baseSize.height * s;
        return {
          x: w < containerSize.width ? (containerSize.width - w) / 2 : 0,
          y: h < containerSize.height ? (containerSize.height - h) / 2 : 0,
        };
      };
      const prevOffset = baseOffset(prevScale);
      const localX = (cx - prevOffset.x - prevTranslate.x) / prevScale;
      const localY = (cy - prevOffset.y - prevTranslate.y) / prevScale;
      const nextOffset = baseOffset(nextScale);
      nextTranslate = {
        x: cx - nextOffset.x - localX * nextScale,
        y: cy - nextOffset.y - localY * nextScale,
      };
    }

    scaleRef.current = nextScale;
    setScale(nextScale);
    const clamped = clampTranslate(nextTranslate, nextScale);
    translateRef.current = clamped;
    setTranslate(clamped);
  }, [clampTranslate, fitScale, isVideo, baseSize, containerSize]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      overlay.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  if (!open) return null;

  if (!currentItem && !showLoadingPlaceholder) {
    return createPortal(
      <div
        className="fixed inset-0 bg-black flex flex-col items-center justify-center text-white"
        style={{ zIndex: MEDIA_VIEWER_Z_INDEX }}
        role="dialog"
        aria-modal="true"
      >
        <CloseButton
          onClick={onClose}
          buttonSize={9}
          iconSize={6}
          zIndex={MEDIA_VIEWER_OVERLAY_Z_INDEX}
        />
        <p className="text-slate-300 mb-2">No images to display</p>
        <p className="text-slate-500 text-sm">images: {items.length}, index: {index}</p>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div
      ref={overlayRef}
      id="media-viewer-overlay"
      className="fixed inset-0 bg-black"
      style={{ zIndex: MEDIA_VIEWER_Z_INDEX }}
    >
      <div
        ref={containerRef}
        className={`absolute inset-x-0 top-0 overflow-hidden ${isVideo ? '' : 'touch-none'}`}
        style={{ overscrollBehavior: 'contain', height: 'calc(100vh - var(--bottom-bar-offset, 0px))', zIndex: 1 }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {showLoadingPlaceholder ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
            <div className="w-12 h-12 border-4 border-slate-700 border-t-cyan-300 rounded-full animate-spin" />
            <div className="mt-4 w-48 h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, loadingProgress))}%` }}
              />
            </div>
            <div className="mt-2 text-sm text-slate-300">
              {loadingLabel ?? `${Math.min(100, Math.max(0, loadingProgress))}%`}
            </div>
          </div>
        ) : renderItem && (
          <>
            {renderIsVideo ? (
              <>
                <video
                  // Key by src so swiping to another video remounts the element
                  // and releases the previous decoder, instead of reusing one
                  // element whose old (looping, autoplaying) stream keeps decoding.
                  key={renderItem.src}
                  ref={videoRef}
                  src={renderItem.src}
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-contain select-none"
                  onDragStart={(event) => event.preventDefault()}
                  onError={() => setVideoError(true)}
                  onLoadedMetadata={(event) => {
                    const { videoWidth, videoHeight } = event.currentTarget;
                    if (videoWidth > 0 && videoHeight > 0) {
                      setNaturalSize({ width: videoWidth, height: videoHeight });
                    }
                  }}
                />
                {videoError && (
                  <div className="absolute inset-0 flex items-center justify-center text-white text-sm bg-black/60">
                    Unable to play this video.
                  </div>
                )}
              </>
            ) : (
              <img
                ref={imageRef}
                src={getFullScreenImageSrc(renderItem)}
                alt={renderItem.alt || 'Generation'}
                className="w-full h-auto block select-none relative"
                draggable={false}
                onLoad={handleImageLoad}
                style={{
                  transform: `translate3d(${getBaseOffset(scale).x + translate.x}px, ${getBaseOffset(scale).y + translate.y}px, 0) scale(${scale})`,
                  transformOrigin: 'top left',
                  willChange: 'transform',
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                }}
              />
            )}
          </>
        )}

        {/* Loading spinner over the image while the current one decodes — mirrors
            the server-restart overlay's dual-ring spinner. */}
        {!showLoadingPlaceholder && showImageSpinner && (
          <div
            role="status"
            aria-label="Loading image"
            className="image-loading-spinner pointer-events-none absolute inset-0 z-[2] flex items-center justify-center"
          >
            <div className="relative h-24 w-24">
              <div className="absolute inset-0 rounded-full border-4 border-cyan-400/25" />
              <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-cyan-300 animate-spin" />
            </div>
          </div>
        )}
      </div>

      <CloseButton
        onClick={onClose}
        buttonSize={9}
        iconSize={6}
        isIdle={isIdle}
        zIndex={MEDIA_VIEWER_OVERLAY_Z_INDEX}
      />

      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
          isIdle ? 'opacity-0' : 'opacity-100'
        }`}
        style={{ zIndex: MEDIA_VIEWER_OVERLAY_Z_INDEX }}
      >
        {currentItem && (
          <>
            <MediaViewerHeader
              index={index}
              total={items.length}
              displayName={displayName}
              resolution={naturalSize}
            />
            <MediaViewerActions
              isVideo={isVideo}
              canLoadWorkflow={canLoadWorkflow}
              showMetadataToggle={showMetadataToggle}
              canToggleMetadata={canToggleMetadata}
              canFavorite={canFavoriteCurrent}
              isFavorited={currentIsFavorited}
              canDownload={canDownloadCurrent}
              loadWorkflowProgress={loadWorkflowProgress}
              onDelete={handleDeleteClick}
              onLoadWorkflow={handleLoadWorkflowClick}
              onUseInWorkflow={handleLoadInWorkflowClick}
              onToggleMetadata={handleToggleMetadata}
              onToggleFavorite={handleToggleFavoriteClick}
              onDownload={handleDownloadClick}
            />
            <MediaViewerMetadata
              isVideo={isVideo}
              showMetadataToggle={showMetadataToggle}
              showMetadataOverlay={showMetadataOverlay}
              metadataIsLoading={metadataIsLoading}
              metadata={metadata}
              durationLabel={durationLabel}
            />
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

function getActivePointers(element: HTMLDivElement | null): Map<number, { x: number; y: number }> {
  const anyElement = element as unknown as { __activePointers?: Map<number, { x: number; y: number }> } | null;
  if (!anyElement) return new Map();
  if (!anyElement.__activePointers) {
    anyElement.__activePointers = new Map();
  }
  return anyElement.__activePointers;
}

function formatDuration(seconds?: number): string {
  const safeSeconds = seconds === undefined || Number.isNaN(seconds) ? 0 : seconds;
  if (safeSeconds === 0) return '';
  if (safeSeconds < 10) return `${safeSeconds.toFixed(1)}s`;
  return `${Math.round(safeSeconds)}s`;
}

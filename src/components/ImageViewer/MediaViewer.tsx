import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTextareaFocus } from '@/hooks/useTextareaFocus';
import type { ViewerImage } from '@/utils/viewerImages';
import { MediaViewerHeader } from './MediaViewer/Header';
import { MediaViewerActions } from './MediaViewer/Actions';
import { MediaViewerMetadata } from './MediaViewer/Metadata';
import { CloseButton } from '@/components/buttons/CloseButton';
import { extractMetadata } from '@/utils/metadata';
import { isVideoFilename } from '@/utils/media';
import { getImageMetadata } from '@/api/client';
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
  showMetadataToggle?: boolean;
  showLoadingPlaceholder?: boolean;
  loadingProgress?: number;
  loadingLabel?: string;
  initialScale?: number;
  initialTranslate?: { x: number; y: number };
  onTransformChange?: (scale: number, translate: { x: number; y: number }) => void;
  zoomResetKey?: string | number | null;
}

const DEFAULT_TRANSLATE = { x: 0, y: 0 };
const MEDIA_VIEWER_Z_INDEX = 2100;
const MEDIA_VIEWER_OVERLAY_Z_INDEX = MEDIA_VIEWER_Z_INDEX + 10;

export function MediaViewer({
  open,
  items,
  index,
  onIndexChange,
  onClose,
  onDelete,
  onLoadWorkflow,
  onLoadInWorkflow,
  showMetadataToggle = false,
  showLoadingPlaceholder = false,
  loadingProgress = 0,
  loadingLabel,
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
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });

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
  const [videoError, setVideoError] = useState(false);
  const { isInputFocused } = useTextareaFocus();

  const currentItem = index >= 0 ? (items[index] ?? items[0] ?? null) : null;
  const fallbackName = currentItem?.filename ?? currentItem?.file?.name ?? currentItem?.alt ?? currentItem?.src ?? '';
  const isVideo = Boolean(
    currentItem?.mediaType === 'video' ||
    currentItem?.file?.type === 'video' ||
    (fallbackName && isVideoFilename(fallbackName))
  );
  const fileId = currentItem?.file?.id ?? null;
  const fetchedMetadata = fileId ? metadataById[fileId] : undefined;
  const metadata = currentItem?.metadata ?? (fetchedMetadata === undefined ? undefined : fetchedMetadata);
  const durationLabel = formatDuration(currentItem?.durationSeconds);
  const displayName = currentItem?.filename || currentItem?.alt || 'Output';
  const showMetadataOverlay = showMetadata && !isIdle;
  const canToggleMetadata = showMetadataToggle;
  const metadataIsLoading = fileId ? Boolean(metadataLoading[fileId]) : false;

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

  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    if (!open) return;
    setScale(initialScale);
    setTranslate(initialTranslate);
    scaleRef.current = initialScale;
    translateRef.current = initialTranslate;

    dragRef.current = null;
    swipeRef.current = null;
    pinchRef.current = null;
    lastTapRef.current = null;
    targetZoomModeRef.current = 'fit';
  }, [open, index, initialScale, initialTranslate]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    naturalSizeRef.current = null;
    setBaseSize(null);
    setVideoError(false);
  }, [currentItem?.src]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!onTransformChange) return;
    onTransformChange(scale, translate);
  }, [open, scale, translate, onTransformChange]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

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
    naturalSizeRef.current = { width: img.naturalWidth, height: img.naturalHeight };
    const container = containerRef.current;
    if (!container || img.naturalWidth === 0) return;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const ratio = containerWidth / img.naturalWidth;
    setBaseSize({ width: containerWidth, height: img.naturalHeight * ratio });
    setContainerSize({ width: containerWidth, height: containerHeight });
  };

  useEffect(() => {
    if (isVideo) return;
    if (!open) return;
    const img = imageRef.current;
    const container = containerRef.current;
    if (!img || !container) return;

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
  }, [open, currentItem?.src, isVideo]);

  useEffect(() => {
    if (isVideo) return;
    if (!open || !baseSize || !containerSize) return;
    applyZoomModeRef.current(targetZoomModeRef.current);
  }, [open, currentItem?.src, baseSize, containerSize, isVideo]);

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
    if (!event.ctrlKey) return;
    event.preventDefault();
    const delta = -event.deltaY * 0.005;
    const nextScale = Math.max(fitScale, Math.min(5, scaleRef.current + delta));
    scaleRef.current = nextScale;
    setScale(nextScale);
    const nextTranslate = clampTranslate(translateRef.current, nextScale);
    translateRef.current = nextTranslate;
    setTranslate(nextTranslate);
  }, [clampTranslate, fitScale, isVideo]);

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
        <p className="text-gray-400 mb-2">No images to display</p>
        <p className="text-gray-500 text-sm">images: {items.length}, index: {index}</p>
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
            <div className="w-12 h-12 border-4 border-gray-600 border-t-white rounded-full animate-spin" />
            <div className="mt-4 w-48 h-2 rounded-full bg-gray-700 overflow-hidden">
              <div
                className="h-full bg-white transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, loadingProgress))}%` }}
              />
            </div>
            <div className="mt-2 text-sm text-gray-300">
              {loadingLabel ?? `${Math.min(100, Math.max(0, loadingProgress))}%`}
            </div>
          </div>
        ) : currentItem && (
          <>
            {isVideo ? (
              <>
                <video
                  ref={videoRef}
                  src={currentItem.src}
                  controls
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-contain select-none"
                  onDragStart={(event) => event.preventDefault()}
                  onError={() => setVideoError(true)}
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
                src={currentItem.src}
                alt={currentItem.alt || 'Generation'}
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
            />
            <MediaViewerActions
              isVideo={isVideo}
              showMetadataToggle={showMetadataToggle}
              canToggleMetadata={canToggleMetadata}
              onDelete={handleDeleteClick}
              onLoadWorkflow={handleLoadWorkflowClick}
              onUseInWorkflow={handleLoadInWorkflowClick}
              onToggleMetadata={handleToggleMetadata}
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InfoIcon } from './InfoIcon';
import type { ViewerImage } from '@/utils/viewerImages';

interface ImageViewerProps {
  open: boolean;
  images: ViewerImage[];
  index: number;
  onClose: () => void;
  onIndexChange: (nextIndex: number) => void;
  initialScale?: number;
  initialTranslate?: { x: number; y: number };
  onTransformChange?: (next: { viewerScale: number; viewerTranslate: { x: number; y: number } }) => void;
  followQueueActive?: boolean;
  followQueueSwitchId?: string | null;
  overallProgress?: number | null;
  isGenerating?: boolean;
}

export function ImageViewer({
  open,
  images,
  index,
  onClose,
  onIndexChange,
  initialScale = 1,
  initialTranslate = { x: 0, y: 0 },
  onTransformChange,
  followQueueActive = false,
  followQueueSwitchId = null,
  overallProgress = null,
  isGenerating = false,
}: ImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [swipeStart, setSwipeStart] = useState<{ x: number; y: number } | null>(null);
  const [pinchStart, setPinchStart] = useState<{
    distance: number;
    scale: number;
    centerX: number;
    centerY: number;
    imagePoint?: { x: number; y: number };
  } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
  const lastFollowSwitchRef = useRef<string | null>(null);
  const naturalSizeRef = useRef<{ width: number; height: number } | null>(null);
  const initializedRef = useRef(false);
  const lastTransformRef = useRef<{ scale: number; x: number; y: number } | null>(null);
  const [showMetadata, setShowMetadata] = useState(false);
  const [isIdle, setIsIdle] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isMediaLoaded, setIsMediaLoaded] = useState(false);

  const current = index >= 0 ? (images[index] ?? images[0] ?? null) : null;
  const isVideo = current?.mediaType === 'video';
  const metadata = current?.metadata;
  const durationLabel = formatDuration(current?.durationSeconds);
  const showMetadataOverlay = showMetadata && !isIdle;
  const showLoadingPlaceholder = (!current && (followQueueActive || isGenerating)) || (index < 0 && isGenerating);
  const displayProgress = Math.min(100, Math.max(0, overallProgress ?? 0));

  const resetIdleTimer = () => {
    setIsIdle(false);
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => {
      setIsIdle(true);
    }, 3000);
  };

  useEffect(() => {
    if (open) {
      queueMicrotask(resetIdleTimer);
      window.addEventListener('pointermove', resetIdleTimer);
      window.addEventListener('pointerdown', resetIdleTimer);
      window.addEventListener('pointerup', resetIdleTimer);
    } else {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
      window.removeEventListener('pointermove', resetIdleTimer);
      window.removeEventListener('pointerdown', resetIdleTimer);
      window.removeEventListener('pointerup', resetIdleTimer);
    }

    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
      window.removeEventListener('pointermove', resetIdleTimer);
      window.removeEventListener('pointerdown', resetIdleTimer);
      window.removeEventListener('pointerup', resetIdleTimer);
    };
  }, [open]);

  useEffect(() => {
    setIsMediaLoaded(false);
  }, [current?.src]);

  useEffect(() => {
    if (!open) {
      document.body.style.overflow = '';
      initializedRef.current = false;
      queueMicrotask(() => {
        setShowMetadata(false);
        setIsIdle(false);
      });
      return;
    }
    document.body.style.overflow = 'hidden';
    setIsMediaLoaded(false);
    if (!initializedRef.current) {
      queueMicrotask(() => {
        setScale(initialScale);
        setTranslate(initialTranslate);
      });
      initializedRef.current = true;
    }
    queueMicrotask(() => {
      setDragStart(null);
      setSwipeStart(null);
      setPinchStart(null);
    });
    lastTapRef.current = null;
    return () => {
      document.body.style.overflow = '';
      initializedRef.current = false;
    };
  }, [open, initialScale, initialTranslate]);

  useEffect(() => {
    if (!open || !onTransformChange) return;
    const last = lastTransformRef.current;
    if (last && last.scale === scale && last.x === translate.x && last.y === translate.y) {
      return;
    }
    lastTransformRef.current = { scale, x: translate.x, y: translate.y };
    onTransformChange({ viewerScale: scale, viewerTranslate: translate });
  }, [open, scale, translate, onTransformChange]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

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

  // Ref to track target zoom mode - updated by applyZoomMode
  const targetZoomModeRef = useRef<'fit' | 'cover'>('fit');

  const getBaseOffset = (nextScale = scale) => {
    if (!baseSize || !containerSize) return { x: 0, y: 0 };
    const scaledWidth = baseSize.width * nextScale;
    const scaledHeight = baseSize.height * nextScale;
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

  const applyZoomMode = useCallback((mode: 'fit' | 'cover') => {
    const targetScale = mode === 'cover' ? coverScale : fitScale;
    targetZoomModeRef.current = mode;
    setScale(targetScale);
    if (!baseSize || !containerSize) {
      setTranslate({ x: 0, y: 0 });
    } else {
      const scaledWidth = baseSize.width * targetScale;
      const scaledHeight = baseSize.height * targetScale;
      const centered = {
        x: (containerSize.width - scaledWidth) / 2,
        y: (containerSize.height - scaledHeight) / 2,
      };
      setTranslate(clampTranslate(centered, targetScale));
    }
  }, [baseSize, clampTranslate, containerSize, coverScale, fitScale]);

  const handlePointerDown = (event: React.PointerEvent) => {
    if (isVideo) {
      const videoEl = videoRef.current;
      if (videoEl && event.target === videoEl) {
        const rect = videoEl.getBoundingClientRect();
        if (event.clientY > rect.bottom - 60) {
          return;
        }
      }
      setSwipeStart({ x: event.clientX, y: event.clientY });
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    const pointers = getActivePointers(containerRef.current);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      setDragStart({ x: event.clientX - translate.x, y: event.clientY - translate.y });
      setSwipeStart({ x: event.clientX, y: event.clientY });
    } else if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const centerX = (a.x + b.x) / 2;
      const centerY = (a.y + b.y) / 2;
      const rect = containerRef.current?.getBoundingClientRect();
      const baseOffset = getBaseOffset(scale);
      const imagePoint = rect
        ? {
            x: (centerX - rect.left - baseOffset.x - translate.x) / scale,
            y: (centerY - rect.top - baseOffset.y - translate.y) / scale,
          }
        : undefined;
      setPinchStart({ distance, scale, centerX, centerY, imagePoint });
    }
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (isVideo) return;
    const pointers = getActivePointers(containerRef.current);
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 2 && pinchStart) {
      const [a, b] = Array.from(pointers.values());
      const nextDistance = Math.hypot(b.x - a.x, b.y - a.y);
      const minScale = fitScale;
      const nextScale = Math.max(minScale, Math.min(5, pinchStart.scale * (nextDistance / pinchStart.distance)));
      setScale(nextScale);
      const rect = containerRef.current?.getBoundingClientRect();
      const centerX = (a.x + b.x) / 2;
      const centerY = (a.y + b.y) / 2;
      if (rect && pinchStart.imagePoint) {
        const nextBaseOffset = getBaseOffset(nextScale);
        const nextTranslate = {
          x: centerX - rect.left - nextBaseOffset.x - pinchStart.imagePoint.x * nextScale,
          y: centerY - rect.top - nextBaseOffset.y - pinchStart.imagePoint.y * nextScale,
        };
        setTranslate(clampTranslate(nextTranslate, nextScale));
      } else {
        setTranslate((prev) => clampTranslate(prev, nextScale));
      }
      return;
    }

    if (pointers.size === 1) {
      const canPan = scale > 1 || (baseSize && containerRef.current && baseSize.height * scale > containerRef.current.clientHeight + 1);
      if (canPan && dragStart) {
        setTranslate(clampTranslate({ x: event.clientX - dragStart.x, y: event.clientY - dragStart.y }));
      }
    }
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    const handleSwipe = (dx: number, dy: number) => {
      if (Math.abs(dx) <= 50 || Math.abs(dx) <= Math.abs(dy)) return;
      if (dx < 0) {
        if (index === -1 && images.length > 0) {
          onIndexChange(0);
        } else if (index < images.length - 1) {
          onIndexChange(index + 1);
        }
      } else if (dx > 0) {
        if (index > 0) {
          onIndexChange(index - 1);
        } else if (index === 0 && isGenerating) {
          onIndexChange(-1);
        }
      }
    };

    if (isVideo) {
      if (swipeStart) {
        const dx = event.clientX - swipeStart.x;
        const dy = event.clientY - swipeStart.y;
        handleSwipe(dx, dy);
      }
      setSwipeStart(null);
      return;
    }
    const pointers = getActivePointers(containerRef.current);
    pointers.delete(event.pointerId);

    if (pointers.size < 2) {
      setPinchStart(null);
    }

    if (pointers.size === 0) {
      const now = Date.now();
      const lastTap = lastTapRef.current;
      const dxTap = lastTap ? event.clientX - lastTap.x : 0;
      const dyTap = lastTap ? event.clientY - lastTap.y : 0;
      const isDoubleTap = Boolean(
        lastTap &&
        now - lastTap.time < 300 &&
        Math.hypot(dxTap, dyTap) < 24
      );

      if (isDoubleTap) {
        lastTapRef.current = null;
        // Toggle between fit and cover modes
        const currentMode = targetZoomModeRef.current;
        applyZoomMode(currentMode === 'fit' ? 'cover' : 'fit');
      } else {
        lastTapRef.current = { time: now, x: event.clientX, y: event.clientY };
        // Allow swipe when at fit or cover scale (not custom pinch zoom)
        const isFitOrCover = Math.abs(scale - fitScale) < 0.05 || Math.abs(scale - coverScale) < 0.05;
        if (isFitOrCover && swipeStart) {
          const dx = event.clientX - swipeStart.x;
          const dy = event.clientY - swipeStart.y;
          handleSwipe(dx, dy);
        }
      }
    }

    if (pointers.size === 0) {
      setDragStart(null);
      setSwipeStart(null);
    }
  };

  const handleWheel = (event: React.WheelEvent) => {
    if (isVideo) return;
    const minScale = fitScale;
    const nextScale = Math.max(minScale, Math.min(5, scale - event.deltaY * 0.001));
    setScale(nextScale);
    setTranslate((prev) => clampTranslate(prev, nextScale));
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
      setTranslate((prev) => clampTranslate(prev));
    };

    updateSizes();
    const observer = new ResizeObserver(updateSizes);
    observer.observe(container);
    return () => observer.disconnect();
  }, [open, current?.src, clampTranslate, isVideo]);

  // Apply zoom mode when sizes change
  useEffect(() => {
    if (isVideo) return;
    if (!open || !baseSize || !containerSize) return;
    applyZoomMode(targetZoomModeRef.current);
  }, [open, current?.src, baseSize, containerSize, fitScale, coverScale, applyZoomMode, isVideo]);

  useEffect(() => {
    if (isVideo) return;
    if (!open || !followQueueActive) return;
    if (!followQueueSwitchId || followQueueSwitchId === lastFollowSwitchRef.current) return;
    lastFollowSwitchRef.current = followQueueSwitchId;
    // Re-apply current zoom mode when follow queue switches to new image
    applyZoomMode(targetZoomModeRef.current);
  }, [open, followQueueActive, followQueueSwitchId, fitScale, coverScale, applyZoomMode, isVideo]);

  if (!open) return null;

  // Show message if no images and not following/awaiting output
  if (!current && !showLoadingPlaceholder) {
    return (
      <div
        className="fixed inset-0 z-[1200] bg-black flex flex-col items-center justify-center text-white"
        role="dialog"
        aria-modal="true"
      >
        <button
          className="absolute top-4 right-4 z-[1210] w-10 h-10 rounded-full bg-black/60 text-white text-xl flex items-center justify-center"
          onClick={onClose}
          aria-label="Close image viewer"
        >
          ×
        </button>
        <p className="text-gray-400 mb-2">No images to display</p>
        <p className="text-gray-500 text-sm">images: {images.length}, index: {index}</p>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[1200] bg-black"
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={containerRef}
        className={`absolute inset-x-0 top-0 overflow-hidden ${isVideo ? '' : 'touch-none'}`}
        style={{ overscrollBehavior: 'contain', height: 'calc(100vh - var(--bottom-bar-offset, 0px))' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        {/* Loading spinner - shown behind image, image covers it when loaded */}
        {!showLoadingPlaceholder && (!isVideo || !followQueueActive) ? (
          <div
            className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-200 ${
              isMediaLoaded ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <div className="w-10 h-10 border-4 border-gray-600 border-t-white rounded-full animate-spin" />
          </div>
        ) : null}
        {showLoadingPlaceholder ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
            <div className="w-12 h-12 border-4 border-gray-600 border-t-white rounded-full animate-spin" />
            <div className="mt-4 w-48 h-2 rounded-full bg-gray-700 overflow-hidden">
              <div
                className="h-full bg-white transition-all duration-300"
                style={{ width: `${displayProgress}%` }}
              />
            </div>
            <div className="mt-2 text-sm text-gray-300">
              {isGenerating ? `${displayProgress}%` : 'Waiting for output'}
            </div>
          </div>
        ) : isVideo ? (
          <video
            src={current?.src || ''}
            className="w-full h-full object-contain"
            controls
            playsInline
            preload="metadata"
            autoPlay
            muted
            ref={videoRef}
            loop
            onLoadedMetadata={() => setIsMediaLoaded(true)}
            onCanPlay={() => setIsMediaLoaded(true)}
          />
        ) : (
          <img
            ref={imageRef}
            src={current?.src || ''}
            alt={current?.alt || 'Preview'}
            className="w-full h-auto block select-none relative"
            draggable={false}
            onLoad={(event) => {
              const img = event.currentTarget;
              naturalSizeRef.current = { width: img.naturalWidth, height: img.naturalHeight };
              const container = containerRef.current;
              if (!container || img.naturalWidth === 0) return;
              const containerWidth = container.clientWidth;
              const containerHeight = container.clientHeight;
              const ratio = containerWidth / img.naturalWidth;
              setBaseSize({ width: containerWidth, height: img.naturalHeight * ratio });
              setContainerSize({ width: containerWidth, height: containerHeight });
              setIsMediaLoaded(true);
            }}
            style={{
              transform: `translate3d(${getBaseOffset(scale).x + translate.x}px, ${getBaseOffset(scale).y + translate.y}px, 0) scale(${scale})`,
              transformOrigin: 'top left',
              willChange: 'transform',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transition: (pinchStart || dragStart) ? 'none' : 'transform 0.05s linear',
            }}
          />
        )}
      </div>
      <button
        className={`absolute top-4 right-4 z-[1210] w-10 h-10 rounded-full text-white text-xl flex items-center justify-center transition-colors pointer-events-auto ${
          isIdle ? 'bg-transparent' : 'bg-black/60'
        }`}
        onClick={onClose}
        aria-label="Close image viewer"
      >
        ×
      </button>
      <div
        className={`absolute inset-0 z-[1210] pointer-events-none transition-opacity duration-300 ${
          isIdle ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {current && (
          <>
            {/* Counter */}
            <div className="absolute top-4 left-4 flex items-center gap-2">
              <div className="px-3 py-1.5 rounded-full bg-black/60 text-white text-sm font-medium">
                {index + 1} / {images.length}
              </div>
            </div>

            {/* Metadata display */}
            <button
              className={`absolute right-4 w-10 h-10 rounded-full flex items-center justify-center pointer-events-auto transition-opacity ${
                showMetadata ? 'bg-black/80 text-white' : 'bg-black/30 text-white/70'
              }`}
              style={{ bottom: isVideo ? 'calc(var(--bottom-bar-offset, 0px) + 72px)' : 'calc(var(--bottom-bar-offset, 0px) + 16px)' }}
              onClick={() => setShowMetadata(!showMetadata)}
              aria-label="Toggle metadata"
            >
              <InfoIcon className="w-6 h-6" />
            </button>
            {metadata && showMetadata && (
              <div
                className={`absolute right-4 flex flex-col items-end gap-1 pointer-events-none transition-opacity duration-300 ${
                  showMetadataOverlay ? 'opacity-100' : 'opacity-0'
                }`}
                style={{ bottom: isVideo ? 'calc(var(--bottom-bar-offset, 0px) + 120px)' : 'calc(var(--bottom-bar-offset, 0px) + 64px)' }}
              >
                {metadata.model && <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">model: {metadata.model}</div>}
                {metadata.sampler && <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">sampler: {metadata.sampler}</div>}
                {metadata.steps && <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">steps: {metadata.steps}</div>}
                {metadata.cfg && <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">cfg: {metadata.cfg}</div>}
                {durationLabel && <div className="px-1.5 py-0.5 bg-black/50 text-white text-[10px] rounded backdrop-blur-sm">time: {durationLabel}</div>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
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

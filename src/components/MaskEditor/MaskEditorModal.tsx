import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/i18n';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useMaskEditorStore } from '@/hooks/useMaskEditor';
import { getWidgetIndexForInput, useWorkflowStore } from '@/hooks/useWorkflow';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { Z_LAYERS } from '@/components/zLayers';
import { CloseButton } from '@/components/buttons/CloseButton';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { RedoIcon, TrashIcon, UndoIcon } from '@/components/icons';
import { resolveScopeForHierarchicalKey } from '@/utils/canonicalWorkflowOps';
import { formatImageWidgetValue, type ImageRef } from '@/utils/maskEditor/clipspace';
import { loadMaskEditorSource, saveMaskEdit } from '@/utils/maskEditor/session';
import type { Point, Tool } from '@/utils/maskEditor/types';
import { MaskCanvasEngine, type EngineSettings } from './maskCanvasEngine';
import {
  lineageForRef,
  maskRefKey,
  peekMaskHistory,
  registerLineage,
  retainMaskHistory,
} from './maskHistoryCache';
import { loadPersistedMaskHistory, persistMaskHistory } from '@/utils/maskEditor/historyStorage';
import { MaskEditorSettings } from './MaskEditorSettings';
import {
  ColorSelectIcon,
  EraserIcon,
  FitToViewIcon,
  InvertIcon,
  MaskPenIcon,
  PaintBucketIcon,
  PaintPenIcon,
} from './icons';

/**
 * Tool order matches the desktop editor's palette. Labels are produced by a
 * function rather than stored as strings so every key is a literal at the call
 * site -- the i18n extraction check can only see literals, and a dynamic
 * `t(variable)` silently falls back to English in every other locale.
 */
const TOOL_BUTTONS: Array<{
  tool: Tool;
  label: (t: (key: string) => string) => string;
  Icon: typeof MaskPenIcon;
}> = [
  { tool: 'pen', label: (t) => t('Mask brush'), Icon: MaskPenIcon },
  { tool: 'eraser', label: (t) => t('Eraser'), Icon: EraserIcon },
  { tool: 'paintBucket', label: (t) => t('Paint bucket'), Icon: PaintBucketIcon },
  { tool: 'colorSelect', label: (t) => t('Color select'), Icon: ColorSelectIcon },
  { tool: 'rgbPaint', label: (t) => t('Paint brush'), Icon: PaintPenIcon },
];

/**
 * Guess whether a wheel event came from a trackpad rather than a mouse wheel.
 *
 * There is no API for this. A mouse wheel emits one large, whole-number
 * vertical delta per notch and never a horizontal one; a trackpad emits a
 * stream of small, often fractional deltas, usually with some horizontal
 * drift. Neither rule is airtight -- a slow trackpad flick can look like a
 * wheel notch -- which is why shift and cmd force panning regardless.
 */
function looksLikeTrackpadScroll(event: WheelEvent): boolean {
  if (event.deltaMode !== 0) return false; // lines or pages: a mouse wheel
  if (event.deltaX !== 0) return true;
  if (!Number.isInteger(event.deltaY)) return true;
  return Math.abs(event.deltaY) < 50;
}

/** Pointer state for one finger/stylus, in CSS pixels of the display element. */
interface ActivePointer {
  x: number;
  y: number;
}

export function MaskEditorModal() {
  const { t } = useI18n();
  const target = useMaskEditorStore((s) => s.target);
  const close = useMaskEditorStore((s) => s.close);
  const setTool = useMaskEditorStore((s) => s.setTool);
  const settings = useMaskEditorSettings();
  const updateNodeWidget = useWorkflowStore((s) => s.updateNodeWidget);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const workflow = useWorkflowStore((s) => s.workflow);
  const setError = useWorkflowErrorsStore((s) => s.setError);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<MaskCanvasEngine | null>(null);
  const pointersRef = useRef<Map<number, ActivePointer>>(new Map());
  /** Distance between two fingers on the previous move, for pinch zoom. */
  const pinchRef = useRef<number | null>(null);
  const drawingPointerRef = useRef<number | null>(null);
  /** Pointer currently dragging the canvas (middle-drag, or space + drag). */
  const panPointerRef = useRef<number | null>(null);
  const lastPanPointRef = useRef<Point | null>(null);
  const spaceDownRef = useRef(false);

  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [zoom, setZoom] = useState(1);

  const isOpen = target !== null;
  useBodyScrollLock(isOpen);

  // ------------------------------------------------------------------ load

  // The engine reads settings live through `updateSettings`, so the loader
  // below reaches them through a ref: putting `settings` in its dependency
  // array would re-fetch the image and discard the user's work on every
  // slider nudge.
  const settingsRef = useRef<EngineSettings>(settings);
  settingsRef.current = settings;
  const sourceRefRef = useRef<ImageRef | null>(null);
  /** Which chain of saves this opening belongs to; see maskHistoryCache. */
  const lineageRef = useRef<string | null>(null);

  useEffect(() => {
    if (!target) {
      engineRef.current = null;
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setLoadError(null);

    void (async () => {
      try {
        const source = await loadMaskEditorSource(target.ref);
        if (cancelled) return;

        const engine = new MaskCanvasEngine(
          source.base,
          source.base.naturalWidth,
          source.base.naturalHeight,
          settingsRef.current,
        );
        engine.loadExistingLayers(source.alpha, source.paint);

        // Continue the history from the last time this image was saved, so an
        // edit committed in an earlier opening can still be undone.
        let lineage = lineageForRef(target.ref);
        const previous = peekMaskHistory(lineage, engine.width, engine.height);
        if (previous) {
          engine.adoptHistory(previous.entries, previous.index);
        } else {
          // Nothing in memory: this may be the first opening after a reload.
          const stored = await loadPersistedMaskHistory(lineage, engine.width, engine.height);
          if (cancelled) return;
          if (stored) {
            // Re-attach this file to its lineage before anything saves again,
            // or the next save would start a fresh chain.
            registerLineage(target.ref, stored.lineage);
            lineage = stored.lineage;
            retainMaskHistory({
              lineage, savedRef: target.ref,
              width: engine.width, height: engine.height,
              entries: stored.entries, index: stored.index,
            });
            engine.adoptHistory(stored.entries, stored.index);
          }
        }
        lineageRef.current = lineage;

        engine.onHistoryChange = () => setHistoryVersion((v) => v + 1);
        engine.onViewChange = () => setZoom(engine.getScale());
        engineRef.current = engine;
        sourceRefRef.current = source.sourceRef;
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        engineRef.current = null;
        setLoadError(error instanceof Error ? error.message : String(error));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target]);

  useEffect(() => {
    engineRef.current?.updateSettings(settings);
  }, [settings]);

  // ------------------------------------------------------------- keyboard

  useEffect(() => {
    if (!isOpen) return;

    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable || target.tagName === 'TEXTAREA') return true;
      // Range and colour inputs are the only inputs in here, and neither has
      // its own undo stack worth deferring to.
      return target.tagName === 'INPUT'
        && !['range', 'color', 'checkbox', 'button'].includes((target as HTMLInputElement).type);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ' ' && !isTypingTarget(event.target)) {
        // Held to turn a left-drag into a pan, so it must not also scroll the
        // page or re-trigger the focused button.
        event.preventDefault();
        spaceDownRef.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const key = event.key.toUpperCase();
      // Same bindings as the desktop editor: Z undoes, and both Y and Shift+Z
      // redo (Y on Windows/Linux, Shift+Z on macOS).
      if ((key === 'Y' && !event.shiftKey) || (key === 'Z' && event.shiftKey)) {
        event.preventDefault();
        engineRef.current?.redo();
      } else if (key === 'Z' && !event.shiftKey) {
        event.preventDefault();
        engineRef.current?.undo();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ') return;
      spaceDownRef.current = false;
      if (canvasRef.current) canvasRef.current.style.cursor = '';
    };

    // A key held while the window loses focus never delivers its keyup.
    const clearSpace = () => {
      spaceDownRef.current = false;
      if (canvasRef.current) canvasRef.current.style.cursor = '';
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearSpace);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearSpace);
      clearSpace();
    };
  }, [isOpen]);

  // --------------------------------------------------------------- sizing

  useEffect(() => {
    if (status !== 'ready') return;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!container || !canvas || !engine) return;

    engine.attachDisplay(canvas);

    let fitted = false;
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      engine.resizeDisplay(rect.width, rect.height);
      // Fit once, on the first non-zero measurement; refitting on every resize
      // would yank the view out from under someone who had zoomed in when the
      // on-screen keyboard or a settings sheet changed the container height.
      if (!fitted && rect.width > 0 && rect.height > 0) {
        fitted = true;
        engine.fitToView();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [status]);

  // -------------------------------------------------------------- pointers

  const localPoint = useCallback((event: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  /**
   * Cursor tells you what a press would do here: pan the view, or paint.
   * Written straight to the element because pointermove fires constantly and
   * re-rendering to set one CSS property would be wasteful.
   */
  const updateCursor = useCallback((point: Point | null) => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;
    if (panPointerRef.current !== null) {
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (spaceDownRef.current) {
      canvas.style.cursor = 'grab';
      return;
    }
    if (point && engine.isOutsideImage(engine.toImageSpace(point))) {
      // Nothing to paint on out here, so a drag pans instead.
      canvas.style.cursor = 'grab';
      return;
    }
    canvas.style.cursor = point ? 'crosshair' : '';
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (!engine) return;
    event.currentTarget.setPointerCapture(event.pointerId);

    const point = localPoint(event);

    // Three ways to start a pan rather than a stroke:
    //   - middle-drag, or space + left-drag (a mouse cannot produce the second
    //     pointer the two-finger gesture below needs);
    //   - a drag starting on the empty area around the image, where there is
    //     nothing to paint on anyway.
    const startedOffImage = engine.isOutsideImage(engine.toImageSpace(point));
    if (
      startedOffImage
      || (event.pointerType !== 'touch'
        && (event.button === 1 || (event.button === 0 && spaceDownRef.current)))
    ) {
      event.preventDefault();
      panPointerRef.current = event.pointerId;
      lastPanPointRef.current = point;
      updateCursor(point);
      return;
    }

    pointersRef.current.set(event.pointerId, point);

    if (pointersRef.current.size === 1) {
      drawingPointerRef.current = event.pointerId;
      engine.beginStroke(engine.toImageSpace(point));
      return;
    }

    // A second finger means the gesture was a pan/zoom all along. Abandon the
    // stroke in progress and undo it, so pinching to zoom never leaves a stray
    // dab where the first finger landed.
    if (drawingPointerRef.current !== null) {
      engine.endStroke();
      engine.undo();
      drawingPointerRef.current = null;
    }
    pinchRef.current = null;
  }, [localPoint, updateCursor]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (!engine) return;

    updateCursor(localPoint(event));

    if (panPointerRef.current === event.pointerId) {
      const point = localPoint(event);
      const previous = lastPanPointRef.current;
      lastPanPointRef.current = point;
      if (previous) engine.panBy(point.x - previous.x, point.y - previous.y);
      updateCursor(point);
      return;
    }

    if (!pointersRef.current.has(event.pointerId)) return;

    const point = localPoint(event);
    const previous = pointersRef.current.get(event.pointerId)!;
    pointersRef.current.set(event.pointerId, point);

    if (drawingPointerRef.current === event.pointerId) {
      engine.extendStroke(engine.toImageSpace(point));
      return;
    }

    const pointers = [...pointersRef.current.values()];
    if (pointers.length < 2) return;

    // Two-finger gesture: pan by how far the midpoint moved, zoom by how much
    // the span between the fingers changed.
    const [a, b] = pointers;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    engine.panBy((point.x - previous.x) / 2, (point.y - previous.y) / 2);

    if (pinchRef.current !== null && pinchRef.current > 0 && distance > 0) {
      engine.zoomAt(midpoint, distance / pinchRef.current);
    }
    pinchRef.current = distance;
  }, [localPoint, updateCursor]);

  const endPointer = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (panPointerRef.current === event.pointerId) {
      panPointerRef.current = null;
      lastPanPointRef.current = null;
      updateCursor(localPoint(event));
      return;
    }
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (drawingPointerRef.current === event.pointerId) {
      drawingPointerRef.current = null;
      engine?.endStroke();
    }
  }, [localPoint, updateCursor]);

  /**
   * Trackpad and wheel input.
   *
   * The browser never says which device produced a `wheel` event, and a mouse
   * wheel and a trackpad two-finger scroll arrive identically, so the intent
   * has to be inferred:
   *
   *   ctrl        -> zoom. A trackpad pinch is delivered as ctrl + wheel, and
   *                  ctrl + wheel is the conventional mouse zoom.
   *   shift / cmd -> pan. An explicit override, and the escape hatch when the
   *                  guess below is wrong.
   *   otherwise   -> guessed from the event's shape: a mouse wheel zooms, a
   *                  trackpad scroll pans.
   *
   * Attached natively with `passive: false` because the handler must
   * preventDefault: without it a pinch zooms the whole page instead of the
   * canvas, and a scroll rubber-bands the viewport.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || status !== 'ready') return;

    const onWheel = (event: WheelEvent) => {
      const engine = engineRef.current;
      if (!engine) return;
      event.preventDefault();

      // Firefox reports lines or pages rather than pixels.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;

      const shouldPan = event.ctrlKey
        ? false
        : (event.shiftKey || event.metaKey) || looksLikeTrackpadScroll(event);

      if (shouldPan) {
        engine.panBy(-dx, -dy);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const anchorPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      // A pinch sends many small deltas; a mouse wheel sends few large ones.
      // Clamping keeps one wheel notch from jumping several hundred percent
      // while leaving a pinch smooth.
      const clamped = Math.max(-40, Math.min(40, dy));
      engine.zoomAt(anchorPoint, Math.exp(-clamped * 0.01));
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [status]);

  // ------------------------------------------------------------------ save

  /**
   * Find the `image` widget slot on the source node.
   *
   * Read at save time rather than captured when the editor opened, because the
   * workflow can change underneath a long editing session.
   */
  const getImageWidgetIndex = useCallback((nodeId: number, itemKey: string): number | null => {
    if (!workflow || !nodeTypes) return null;
    // Resolve through the item key's scope, not workflow.nodes: the editor
    // opens from cards inside subgraphs too, and node ids repeat across
    // scopes — a root-only lookup either misses the node or reads a
    // same-numbered root node's schema.
    const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
    const node = scope.nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    return getWidgetIndexForInput(workflow, nodeTypes, node, 'image') ?? null;
  }, [workflow, nodeTypes]);

  const handleSave = useCallback(async () => {
    const engine = engineRef.current;
    const sourceRef = sourceRefRef.current;
    if (!engine || !sourceRef || !target) return;

    setStatus('saving');
    try {
      const saved = await saveMaskEdit(engine.composeLayers(), sourceRef, Date.now());

      // Retained only on save: closing without saving discards the edit, so
      // keeping its history would let Undo re-apply abandoned strokes.
      if (lineageRef.current) {
        const history = engine.exportHistory();
        retainMaskHistory({
          lineage: lineageRef.current,
          savedRef: saved.paintedMasked,
          width: engine.width,
          height: engine.height,
          entries: history.entries,
          index: history.index,
        });
        // Deliberately not awaited: encoding every layer to PNG takes long
        // enough to be felt, and the save the user asked for is already done.
        void persistMaskHistory({
          lineage: lineageRef.current,
          savedKey: maskRefKey(saved.paintedMasked),
          sessionId: useWorkflowStore.getState().activeSessionId,
          width: engine.width,
          height: engine.height,
          entries: history.entries,
          index: history.index,
        });
      }

      const widgetIndex = getImageWidgetIndex(target.nodeId, target.itemKey);
      if (widgetIndex === null) {
        throw new Error(t('This node has no image widget to update.'));
      }
      updateNodeWidget(
        target.itemKey,
        widgetIndex,
        formatImageWidgetValue(saved.paintedMasked),
        'image',
      );
      close();
    } catch (error) {
      setError(t('Could not save the mask: {message}', {
        message: error instanceof Error ? error.message : String(error),
      }));
      setStatus('ready');
    }
  }, [target, updateNodeWidget, close, setError, t, getImageWidgetIndex]);

  if (!isOpen) return null;

  const engine = engineRef.current;
  const canUndo = engine?.canUndo() ?? false;
  const canRedo = engine?.canRedo() ?? false;
  void historyVersion; // read so the buttons re-render when history moves

  return createPortal(
    <div
      className="mask-editor-overlay fixed inset-0 flex flex-col bg-slate-950"
      style={{ zIndex: Z_LAYERS.fullscreenPanel }}
    >
      <div className="mask-editor-header px-3 py-1.5 min-h-[52px] border-b border-white/10 bg-slate-900/95 flex items-center justify-between shrink-0">
        <span className="mask-editor-title font-semibold text-slate-200 truncate pr-2">
          {target.nodeTitle}
        </span>
        <div className="mask-editor-header-actions flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={status !== 'ready'}
            className="mask-editor-save px-4 py-1.5 rounded-lg text-sm font-semibold bg-cyan-500 text-slate-950 disabled:opacity-50"
          >
            {status === 'saving' ? t('Saving…') : t('Save')}
          </button>
          <CloseButton onClick={close} disabled={status === 'saving'} />
        </div>
      </div>

      {/* DOM order is canvas then controls, which is also the phone layout.
          `row-reverse` at desktop widths moves the controls to a fixed-width
          rail on the LEFT without reordering the markup. */}
      <div className="mask-editor-body flex min-h-0 flex-1 flex-col lg:flex-row-reverse">
      <div ref={containerRef} className="mask-editor-canvas-area relative flex-1 min-h-0 overflow-hidden bg-slate-950">
        {status === 'loading' && (
          <div className="mask-editor-loading absolute inset-0 flex items-center justify-center">
            <LoadingSpinner />
          </div>
        )}
        {status === 'error' && (
          <div className="mask-editor-error absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-300">
            {loadError ?? t('Could not load this image.')}
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="mask-editor-canvas w-full h-full touch-none"
          onPointerLeave={() => { if (canvasRef.current) canvasRef.current.style.cursor = ''; }}
          // Chrome opens its autoscroll widget on a middle press otherwise.
          onAuxClick={(event) => event.preventDefault()}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
        />
      </div>

      <div className="mask-editor-toolbar shrink-0 border-t border-white/10 bg-slate-900/95 lg:w-80 lg:overflow-y-auto lg:border-t-0 lg:border-r">
        {/* A phone scrolls this strip sideways; the desktop rail is wide enough
            to wrap it into rows instead. */}
        <div className="mask-editor-tools flex items-center gap-1 overflow-x-auto px-2 py-2 lg:flex-wrap lg:overflow-x-visible">
          {TOOL_BUTTONS.map(({ tool, label, Icon }) => (
            <button
              key={tool}
              type="button"
              onClick={() => setTool(tool)}
              aria-label={label(t)}
              title={label(t)}
              aria-pressed={settings.tool === tool}
              className={`mask-editor-tool shrink-0 w-11 h-11 flex items-center justify-center rounded-lg border transition ${
                settings.tool === tool
                  ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-300'
                  : 'border-white/10 text-slate-300'
              }`}
            >
              <Icon className="w-6 h-6" />
            </button>
          ))}

          <div className="mask-editor-tool-divider mx-1 h-8 w-px shrink-0 bg-white/10 lg:mx-0 lg:h-px lg:w-full lg:my-1" />

          <button
            type="button"
            onClick={() => { engineRef.current?.undo(); }}
            disabled={!canUndo}
            aria-label={t('Undo')}
            title={t('Undo')}
            className="mask-editor-undo shrink-0 w-11 h-11 flex items-center justify-center rounded-lg border border-white/10 text-slate-300 disabled:opacity-40"
          >
            <UndoIcon className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => { engineRef.current?.redo(); }}
            disabled={!canRedo}
            aria-label={t('Redo')}
            title={t('Redo')}
            className="mask-editor-redo shrink-0 w-11 h-11 flex items-center justify-center rounded-lg border border-white/10 text-slate-300 disabled:opacity-40"
          >
            <RedoIcon className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => { engineRef.current?.invertMask(); }}
            aria-label={t('Invert mask')}
            title={t('Invert mask')}
            className="mask-editor-invert shrink-0 w-11 h-11 flex items-center justify-center rounded-lg border border-white/10 text-slate-300"
          >
            <InvertIcon className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => { engineRef.current?.clearAll(); }}
            aria-label={t('Clear mask')}
            title={t('Clear mask')}
            className="mask-editor-clear shrink-0 w-11 h-11 flex items-center justify-center rounded-lg border border-white/10 text-slate-300"
          >
            <TrashIcon className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => { engineRef.current?.fitToView(); }}
            aria-label={t('Fit to view')}
            title={t('Fit to view')}
            className="mask-editor-fit shrink-0 w-11 h-11 flex items-center justify-center rounded-lg border border-white/10 text-slate-300"
          >
            <FitToViewIcon className="w-5 h-5" />
          </button>
          <span className="mask-editor-zoom shrink-0 px-2 text-xs tabular-nums text-slate-500">
            {Math.round(zoom * 100)}%
          </span>
        </div>

        <MaskEditorSettings />
      </div>
      </div>
    </div>,
    document.body,
  );
}

/** Collect the engine-facing slice of the editor store in one stable object. */
function useMaskEditorSettings(): EngineSettings {
  const tool = useMaskEditorStore((s) => s.tool);
  const brush = useMaskEditorStore((s) => s.brush);
  const maskBlendMode = useMaskEditorStore((s) => s.maskBlendMode);
  const maskOpacity = useMaskEditorStore((s) => s.maskOpacity);
  const rgbColor = useMaskEditorStore((s) => s.rgbColor);
  const paintBucketTolerance = useMaskEditorStore((s) => s.paintBucketTolerance);
  const fillOpacity = useMaskEditorStore((s) => s.fillOpacity);
  const colorSelectTolerance = useMaskEditorStore((s) => s.colorSelectTolerance);
  const colorComparisonMethod = useMaskEditorStore((s) => s.colorComparisonMethod);
  const selectionOpacity = useMaskEditorStore((s) => s.selectionOpacity);
  const applyWholeImage = useMaskEditorStore((s) => s.applyWholeImage);
  const maskBoundary = useMaskEditorStore((s) => s.maskBoundary);
  const maskTolerance = useMaskEditorStore((s) => s.maskTolerance);

  // Memoized so the engine's settings effect fires on real changes only; a
  // fresh object every render would push settings (and re-render the canvas) on
  // every unrelated state update.
  return useMemo(() => ({
    tool, brush, maskBlendMode, maskOpacity, rgbColor,
    paintBucketTolerance, fillOpacity,
    colorSelectTolerance, colorComparisonMethod, selectionOpacity,
    applyWholeImage, maskBoundary, maskTolerance,
  }), [
    tool, brush, maskBlendMode, maskOpacity, rgbColor,
    paintBucketTolerance, fillOpacity,
    colorSelectTolerance, colorComparisonMethod, selectionOpacity,
    applyWholeImage, maskBoundary, maskTolerance,
  ]);
}

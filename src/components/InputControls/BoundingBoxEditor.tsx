import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { clamp, fitBox, readBoxes, type LayoutBox } from '@/utils/boundingBoxes';
import { useI18n } from '@/i18n';
import { CloseButton } from '@/components/buttons/CloseButton';
import { Z_LAYERS } from '@/components/zLayers';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { controlInlineButtonClassName as button } from './controlStyles';

const field = 'w-full min-w-0 rounded-lg border border-white/10 bg-slate-950 p-2 text-sm';
/** A toggle or a choice: shows when it is on, like the camera toolbar's. */
const pressable = `${button} aria-pressed:border-cyan-400 aria-pressed:bg-cyan-500/15 aria-pressed:text-cyan-100`;
type Gesture = { pointer: number; x: number; y: number; boxes: LayoutBox[]; index: number; kind: string };
/** A corner handle's side in CSS pixels: a fingertip. Drawn inside the box's corner. */
const HANDLE_PX = 28;
const CORNERS = ['nw', 'ne', 'sw', 'se'] as const;

/**
 * Pixel-valued stock state, rendered as responsive SVG without WebGL work.
 * The card shows a preview that scrolls with the page; boxes are placed in a
 * full-screen editor it opens, where drags belong to the boxes.
 */
export default function BoundingBoxEditor({ value, onChange, width = 1024, height = 1024, background, disabled = false }: {
  value: unknown; onChange: (boxes: LayoutBox[]) => void; width?: number; height?: number; background?: string; disabled?: boolean;
}) {
  const { t } = useI18n();
  const boxes = readBoxes(value);
  const [draft, setDraft] = useState<LayoutBox[] | null>(null);
  const [picked, select] = useState(0);
  // A run can hand back fewer boxes than were selectable. Keep the selection
  // on a box that exists so its fields stay up.
  const selected = Math.min(picked, Math.max(0, boxes.length - 1));
  const [draw, setDraw] = useState(false);
  const [open, setOpen] = useState(false);
  const overlay = useRef<HTMLDivElement>(null);
  useModalKeyboard(open, () => setOpen(false), overlay);
  const gesture = useRef<Gesture | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const latest = useRef({ onChange, disabled });
  useEffect(() => { latest.current = { onChange, disabled }; }, [onChange, disabled]);
  const w = Math.max(1, width), h = Math.max(1, height);
  // Canvas units per CSS pixel, so handles stay finger-sized on any canvas.
  const [unitsPerPixel, setUnitsPerPixel] = useState(1);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const transform = element.getScreenCTM();
      if (transform?.a) setUnitsPerPixel(1 / transform.a);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);
  /** The square a corner's handle covers, inside the box, in canvas units. */
  const handleRect = (box: LayoutBox, corner: (typeof CORNERS)[number]) => {
    const size = Math.max(1, Math.min(HANDLE_PX * unitsPerPixel, box.width / 2, box.height / 2));
    return { x: corner.includes('e') ? box.x + box.width - size : box.x, y: corner.includes('s') ? box.y + box.height - size : box.y, size };
  };
  const shown = draft ?? boxes;
  const current = shown[selected];
  const commit = (next: LayoutBox[]) => { if (!disabled) onChange(next); };
  const edit = (patch: Partial<LayoutBox>) => commit(boxes.map((box, i) => i === selected ? fitBox({ ...box, ...patch }, w, h) : box));
  const metadata = (patch: NonNullable<LayoutBox['metadata']>) => edit({ metadata: { ...current?.metadata, ...patch } });
  const add = (full = false) => {
    select(boxes.length);
    commit([...boxes, { x: full ? 0 : Math.round(w / 4), y: full ? 0 : Math.round(h / 4), width: full ? w : Math.round(w / 2), height: full ? h : Math.round(h / 2), metadata: { type: 'obj', desc: '', text: '', palette: [] } }]);
  };
  const remove = () => { commit(boxes.filter((_, i) => i !== selected)); select(Math.max(0, selected - 1)); };
  const reorder = (offset: number) => {
    const target = selected + offset;
    if (target < 0 || target >= boxes.length) return;
    const next = [...boxes]; [next[selected], next[target]] = [next[target], next[selected]];
    select(target); commit(next);
  };
  const point = (event: PointerEvent<SVGSVGElement>) => {
    // The capped viewport can letterbox tall or wide canvases. Map through
    // SVG's actual transform so touch and mouse retain pixel coordinates.
    const transform = event.currentTarget.getScreenCTM();
    if (!transform) return { x: 0, y: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
    return { x: clamp(point.x, 0, w), y: clamp(point.y, 0, h) };
  };
  /** The selected box's corner handle under or nearest the press, within a fingertip of it. */
  const nearestCorner = (event: PointerEvent<SVGSVGElement>) => {
    const transform = event.currentTarget.getScreenCTM();
    const box = boxes[selected];
    if (!transform || !box) return null;
    let best: (typeof CORNERS)[number] | null = null, nearest = HANDLE_PX;
    for (const corner of CORNERS) {
      const square = handleRect(box, corner);
      const at = new DOMPoint(square.x + square.size / 2, square.y + square.size / 2).matrixTransform(transform);
      const distance = Math.hypot(at.x - event.clientX, at.y - event.clientY);
      if (distance < nearest) { nearest = distance; best = corner; }
    }
    return best;
  };
  const start = (event: PointerEvent<SVGSVGElement>) => {
    if (disabled || event.button !== 0 || gesture.current) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
    // The selected box's corners first, by distance: the squares are far
    // smaller than a fingertip, and a touch that missed one moved the box.
    const corner = draw ? null : nearestCorner(event);
    const hit = corner ? null : (event.target as Element).closest('[data-box]');
    const handle = corner ?? (event.target as Element).getAttribute('data-handle');
    const p = point(event);
    const index = corner ? selected : draw || !hit ? boxes.length : Number(hit.getAttribute('data-box'));
    const initial = index === boxes.length ? [...boxes, { x: p.x, y: p.y, width: 0, height: 0, metadata: { type: 'obj', desc: '', text: '', palette: [] } }] : [...boxes];
    select(index); setDraft(initial);
    gesture.current = { pointer: event.pointerId, ...p, boxes: initial, index, kind: index === boxes.length ? 'draw' : handle ?? 'move' };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId || disabled) return;
    event.preventDefault(); event.stopPropagation();
    const p = point(event), original = g.boxes[g.index];
    const dx = p.x - g.x, dy = p.y - g.y;
    let next: LayoutBox;
    if (g.kind === 'move') next = { ...original, x: clamp(original.x + dx, 0, Math.max(0, w - original.width)), y: clamp(original.y + dy, 0, Math.max(0, h - original.height)) };
    else if (g.kind === 'draw') next = { ...original, x: Math.min(p.x, g.x), y: Math.min(p.y, g.y), width: Math.abs(dx), height: Math.abs(dy) };
    else {
      // By the finger's movement, not its position: the handle sits inside
      // the corner, so snapping the corner to the finger made it jump.
      const x1 = original.x + (g.kind.includes('w') ? dx : 0);
      const x2 = original.x + original.width + (g.kind.includes('e') ? dx : 0);
      const y1 = original.y + (g.kind.includes('n') ? dy : 0);
      const y2 = original.y + original.height + (g.kind.includes('s') ? dy : 0);
      next = { ...original, x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    }
    const updated = g.boxes.map((box, i) => i === g.index ? fitBox(next, w, h) : box);
    // Keep a current draft on the gesture too: pointerup can precede React's render.
    pending.current = updated; setDraft(updated);
  };
  const pending = useRef<LayoutBox[] | null>(null);
  const finish = (event: PointerEvent<SVGSVGElement>, cancelled = false) => {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    event.stopPropagation(); gesture.current = null;
    if (!cancelled && !latest.current.disabled) {
      const next = pending.current ?? g.boxes;
      if (g.kind !== 'draw' || (next[g.index].width >= 1 && next[g.index].height >= 1)) latest.current.onChange(next);
    }
    pending.current = null; setDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const drawBoxes = (handles: boolean) => <>
    {background && <image href={background} width={w} height={h} opacity={0.35} preserveAspectRatio="none" pointerEvents="none" />}
    {shown.map((box, index) => {
      const color = /^#[0-9a-f]{6}$/i.test(box.metadata?.palette?.[0] ?? '') ? box.metadata!.palette![0] : '#22d3ee';
      return <g key={index} data-box={index}>
        <rect x={box.x} y={box.y} width={Math.max(1, box.width)} height={Math.max(1, box.height)} fill={color} fillOpacity={index === selected ? 0.18 : 0.06} stroke={color} strokeWidth={index === selected ? 3 : 1.5} vectorEffect="non-scaling-stroke" />
        <text x={box.x + 4} y={box.y + Math.max(12, h / 35)} fontSize={Math.max(12, h / 35)} fill="white" pointerEvents="none">{index + 1}. {box.metadata?.type === 'text' ? box.metadata.text : box.metadata?.desc}</text>
      </g>;
    })}
    {/* Inside the box's corners, so a full-size box's handles stay on the canvas. */}
    {handles && current && !disabled && CORNERS.map(corner => {
      const square = handleRect(current, corner);
      return <rect key={corner} data-box={selected} data-handle={corner} x={square.x} y={square.y} width={square.size} height={square.size}
        fill="white" fillOpacity={0.85} stroke="#0891b2" vectorEffect="non-scaling-stroke" strokeWidth={2} />;
    })}
  </>;
  const boxButtons = <div className="flex flex-wrap gap-2" aria-label={t('Box order')}>
    {boxes.map((box, index) => <button type="button" key={index} className={pressable} aria-pressed={selected === index} onClick={() => select(index)}>{index + 1}. {box.metadata?.type === 'text' ? t('Text') : t('Object')}</button>)}
  </div>;

  return <section aria-label={t('Bounding box editor')} className="my-3 space-y-3" data-bounding-box-editor>
    {/* A preview only: a touch on it scrolls the page, and a tap opens the editor. */}
    <button type="button" className="block w-full rounded-lg disabled:cursor-not-allowed" disabled={disabled} aria-label={t('Edit boxes')} onClick={() => setOpen(true)}>
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="block max-h-[60vh] w-full rounded-lg border border-white/20 bg-slate-900" style={{ aspectRatio: `${w}/${h}` }}>
        {drawBoxes(false)}
      </svg>
    </button>
    <p className="text-xs text-slate-400">{t('Tap the canvas to place, move and resize boxes.')}</p>
    <fieldset disabled={disabled} className="space-y-3">
      {boxButtons}
      {current && <>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => { select(boxes.length); commit([...boxes, { ...current, metadata: { ...current.metadata } }]); }}>{t('Duplicate box')}</button>
          <button type="button" className={button} onClick={remove}>{t('Delete box')}</button>
          <button type="button" className={button} disabled={selected === 0} onClick={() => reorder(-1)}>{t('Move backward')}</button>
          <button type="button" className={button} disabled={selected >= boxes.length - 1} onClick={() => reorder(1)}>{t('Move forward')}</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['x', 'y', 'width', 'height'] as const).map(name => <label className="text-xs" key={name}>{name}<input className={field} aria-label={t('Box {name}', { name })} type="number" value={current[name]} onChange={event => { const number = event.target.valueAsNumber; if (Number.isFinite(number)) edit({ [name]: number }); }} /></label>)}
        </div>
        <label className="block text-xs">{t('Box type')}<select className={field} aria-label={t('Box type')} value={current.metadata?.type === 'text' ? 'text' : 'obj'} onChange={event => metadata({ type: event.target.value })}><option value="obj">{t('Object')}</option><option value="text">{t('Text')}</option></select></label>
        <label className="block text-xs">{t('Description')}<textarea className={field} aria-label={t('Box description')} value={current.metadata?.desc ?? ''} onChange={event => metadata({ desc: event.target.value })} /></label>
        {current.metadata?.type === 'text' && <label className="block text-xs">{t('Text')}<textarea className={field} aria-label={t('Box text')} value={current.metadata.text ?? ''} onChange={event => metadata({ text: event.target.value })} /></label>}
        <div className="flex flex-wrap items-center gap-2" aria-label={t('Box palette')}>
          {(current.metadata?.palette ?? []).slice(0, 5).map((color, index, palette) => <div key={index} className="flex items-center gap-1">
            <input aria-label={t('Palette color {number}', { number: index + 1 })} type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#22d3ee'} onChange={event => metadata({ palette: palette.map((c, i) => i === index ? event.target.value : c) })} />
            <button type="button" className={button} aria-label={t('Remove color {number}', { number: index + 1 })} onClick={() => metadata({ palette: palette.filter((_, i) => i !== index) })}>×</button>
          </div>)}
          <button type="button" className={button} disabled={(current.metadata?.palette?.length ?? 0) >= 5} onClick={() => metadata({ palette: [...(current.metadata?.palette ?? []), '#22d3ee'] })}>{t('Add color')}</button>
        </div>
      </>}
    </fieldset>
    {open && createPortal(<div ref={overlay} role="dialog" aria-modal="true" aria-label={t('Edit boxes')} data-swipe-nav-ignore="true"
      className="fixed inset-0 flex flex-col bg-slate-950" style={{ zIndex: Z_LAYERS.fullscreenPanel }}>
      <div className="flex min-h-[52px] shrink-0 items-center justify-between border-b border-white/10 bg-slate-900/95 px-3 py-1.5">
        <span className="truncate pr-2 font-semibold text-slate-200">{t('Edit boxes')}</span>
        <CloseButton onClick={() => setOpen(false)} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <fieldset disabled={disabled} className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => add()}>{t('Add box')}</button>
          <button type="button" className={button} onClick={() => add(true)}>{t('Add background box')}</button>
          <button type="button" className={pressable} aria-pressed={draw} onClick={() => setDraw(!draw)}>{t('Draw boxes')}</button>
          <button type="button" className={button} disabled={!current} onClick={remove}>{t('Delete box')}</button>
        </fieldset>
        {boxButtons}
        <svg ref={svg} viewBox={`0 0 ${w} ${h}`} role="application" tabIndex={disabled ? -1 : 0} aria-label={t('Box canvas')}
          className="mx-auto block max-h-[70vh] w-full shrink-0 rounded-lg border border-white/20 bg-slate-900 outline-cyan-400" style={{ aspectRatio: `${w}/${h}`, touchAction: 'none' }}
          onPointerDown={start} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}
          onKeyDown={event => {
            if (disabled || !current) return;
            if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); remove(); }
            const delta = event.shiftKey ? 10 : 1;
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
              event.preventDefault(); event.stopPropagation();
              edit({ x: clamp(current.x + (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0), 0, Math.max(0, w - current.width)), y: clamp(current.y + (event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0), 0, Math.max(0, h - current.height)) });
            }
          }}>
          {drawBoxes(true)}
        </svg>
        <p className="text-xs text-slate-400">{t('Draw on empty space, drag boxes to move, or drag a corner to resize. Arrow keys move the selected box; Shift moves 10 pixels.')}</p>
      </div>
    </div>, document.body)}
  </section>;
}

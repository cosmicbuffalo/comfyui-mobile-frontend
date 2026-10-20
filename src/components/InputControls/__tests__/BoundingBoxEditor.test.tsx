import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BoundingBoxEditor from '../BoundingBoxEditor';
import type { LayoutBox } from '@/utils/boundingBoxes';
import { useSwipeNavigation } from '@/hooks/useSwipeNavigation';

let host: HTMLDivElement, root: Root, saved: LayoutBox[];
function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState<LayoutBox[]>([]);
  return <BoundingBoxEditor value={value} width={400} height={200} disabled={disabled} onChange={boxes => { saved = boxes; setValue(boxes); }} />;
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); saved = [];
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
// The full-screen editor renders into document.body, beside the card.
const click = async (label: string) => act(async () => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === label)!; button.click(); });
const openEditor = () => act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="Edit boxes"]')!.click(); });
const canvas = () => document.querySelector<SVGSVGElement>('svg[role="application"]');
const change = async (label: string, value: string) => act(async () => {
  const input = document.querySelector(`[aria-label="${label}"]`)! as HTMLInputElement;
  const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
});
it('edits text, palette, coordinates, layer order and deletion in stock pixel form', async () => {
  await act(async () => root.render(<Harness />));
  await openEditor();
  await click('Add background box'); await change('Box description', 'backdrop');
  await click('Add box'); await change('Box type', 'text'); await change('Box text', 'Hello'); await change('Box description', 'sign');
  await click('Add color'); await change('Palette color 1', '#ff0000'); await change('Box x', '120');
  expect(saved[1]).toMatchObject({ x: 120, width: 200, metadata: { type: 'text', text: 'Hello', desc: 'sign', palette: ['#ff0000'] } });
  await click('Move backward'); expect(saved[0].metadata?.text).toBe('Hello');
  await click('Duplicate box'); expect(saved).toHaveLength(3);
  await click('Delete box'); expect(saved).toHaveLength(2);
  expect(canvas()?.getAttribute('viewBox')).toBe('0 0 400 200');
});
it('provides keyboard movement and prevents disabled edits', async () => {
  await act(async () => root.render(<Harness />)); await openEditor(); await click('Add box');
  await act(async () => canvas()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })));
  expect(saved[0].x).toBe(110);
  await act(async () => root.render(<Harness disabled />));
  await click('Delete box'); expect(saved).toHaveLength(1);
});
it('keeps a box selected when a run returns fewer boxes', async () => {
  const box = (x: number): LayoutBox => ({ x, y: 10, width: 50, height: 50, metadata: { type: 'obj', desc: '', text: '', palette: [] } });
  const render = (value: LayoutBox[]) => act(async () => root.render(<BoundingBoxEditor value={value} width={400} height={200} onChange={() => {}} />));
  await render([box(10), box(100), box(200)]);
  await click('3. Object');
  expect((host.querySelector('[aria-label="Box x"]') as HTMLInputElement).value).toBe('200');
  await render([box(30)]);
  expect((host.querySelector('[aria-label="Box x"]') as HTMLInputElement | null)?.value).toBe('30');
});
it('keeps a drag across the canvas from switching panels', async () => {
  const onSwipeLeft = vi.fn(), onSwipeRight = vi.fn();
  function WithSwipe() {
    useSwipeNavigation({ onSwipeLeft, onSwipeRight, enabled: true });
    return <Harness />;
  }
  await act(async () => root.render(<WithSwipe />));
  await openEditor();
  await click('Add box');
  const touch = (target: Element, type: string, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: 100 }] });
    act(() => { target.dispatchEvent(event); });
  };
  // A box drawn or dragged sideways, starting on the canvas and on a box: SVG elements, not HTML ones.
  for (const target of [canvas()!, canvas()!.querySelector('rect')!]) {
    touch(target, 'touchstart', 300);
    for (const x of [260, 220, 180]) touch(target, 'touchmove', x);
    touch(target, 'touchend', 180);
  }
  expect(onSwipeLeft).not.toHaveBeenCalled();
  // The same swipe off the canvas still navigates.
  const outside = host.querySelector('button')!;
  touch(outside, 'touchstart', 300);
  for (const x of [260, 220, 180]) touch(outside, 'touchmove', x);
  touch(outside, 'touchend', 180);
  expect(onSwipeLeft).toHaveBeenCalledOnce();
});
it('resizes from a corner a fingertip near it, by how far the finger moves', async () => {
  // The canvas drawn at half size: screen = canvas / 2.
  class Point {
    x: number; y: number;
    constructor(x: number, y: number) { this.x = x; this.y = y; }
    matrixTransform(m: { map: (p: Point) => Point }) { return m.map(this); }
  }
  vi.stubGlobal('DOMPoint', Point);
  const toScreen = { a: 0.5, map: (p: Point) => new Point(p.x / 2, p.y / 2), inverse: () => ({ map: (p: Point) => new Point(p.x * 2, p.y * 2) }) };
  const proto = SVGElement.prototype as unknown as Record<string, unknown>;
  Object.assign(proto, { getScreenCTM: () => toScreen, setPointerCapture: () => {}, hasPointerCapture: () => false, releasePointerCapture: () => {} });
  let value: LayoutBox[] = [{ x: 100, y: 100, width: 200, height: 100, metadata: { type: 'obj', desc: '', text: '', palette: [] } }];
  const render = () => act(async () => root.render(<BoundingBoxEditor value={value} width={400} height={400} onChange={boxes => { value = boxes; }} />));
  await render();
  await openEditor();
  const svg = canvas()!;
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    act(() => { svg.dispatchEvent(event); });
  };
  // The top-left corner is at (50, 50) on screen; a finger lands 9 px inside it, on the box itself.
  pointer('pointerdown', 59, 59);
  pointer('pointermove', 49, 54);
  pointer('pointerup', 49, 54);
  expect(value[0]).toMatchObject({ x: 80, y: 90, width: 220, height: 110 });
  await render();
  // And the bottom-left, which used to be the awkward one.
  pointer('pointerdown', 46, 104);
  pointer('pointermove', 36, 109);
  pointer('pointerup', 36, 109);
  expect(value[0]).toMatchObject({ x: 60, y: 90, width: 240, height: 120 });
  for (const key of ['getScreenCTM', 'setPointerCapture', 'hasPointerCapture', 'releasePointerCapture']) delete proto[key];
});
it('previews on the card, where a touch scrolls the page, and edits full screen', async () => {
  let value: LayoutBox[] = [{ x: 100, y: 100, width: 200, height: 100, metadata: { type: 'obj', desc: '', text: '', palette: [] } }];
  await act(async () => root.render(<BoundingBoxEditor value={value} width={400} height={400} onChange={boxes => { value = boxes; }} />));
  // The card's canvas is a picture inside a button: no gestures, no handles, nothing to drag.
  const preview = host.querySelector('button[aria-label="Edit boxes"] svg')!;
  expect(preview.getAttribute('role')).toBeNull();
  expect(preview.getAttribute('style')).not.toContain('touch-action');
  expect(preview.querySelector('[data-handle]')).toBeNull();
  expect(canvas()).toBeNull();
  await openEditor();
  expect(document.querySelector('[role="dialog"][aria-label="Edit boxes"]')).not.toBeNull();
  expect(canvas()!.querySelectorAll('[data-handle]')).toHaveLength(4);
  // The X closes it, back to the card.
  await act(async () => { document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!.click(); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

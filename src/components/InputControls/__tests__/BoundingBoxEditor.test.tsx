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
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); saved = []; });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const click = async (label: string) => act(async () => { const button = [...host.querySelectorAll('button')].find(b => b.textContent === label)!; button.click(); });
const change = async (label: string, value: string) => act(async () => {
  const input = host.querySelector(`[aria-label="${label}"]`)! as HTMLInputElement;
  const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
});
it('edits text, palette, coordinates, layer order and deletion in stock pixel form', async () => {
  await act(async () => root.render(<Harness />));
  await click('Add background box'); await change('Box description', 'backdrop');
  await click('Add box'); await change('Box type', 'text'); await change('Box text', 'Hello'); await change('Box description', 'sign');
  await click('Add color'); await change('Palette color 1', '#ff0000'); await change('Box x', '120');
  expect(saved[1]).toMatchObject({ x: 120, width: 200, metadata: { type: 'text', text: 'Hello', desc: 'sign', palette: ['#ff0000'] } });
  await click('Move backward'); expect(saved[0].metadata?.text).toBe('Hello');
  await click('Duplicate box'); expect(saved).toHaveLength(3);
  await click('Delete box'); expect(saved).toHaveLength(2);
  expect(host.querySelector('[role="application"]')?.getAttribute('viewBox')).toBe('0 0 400 200');
});
it('provides keyboard movement and prevents disabled edits', async () => {
  await act(async () => root.render(<Harness />)); await click('Add box');
  await act(async () => host.querySelector('svg')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })));
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
  await click('Add box');
  const touch = (target: Element, type: string, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: 100 }] });
    act(() => { target.dispatchEvent(event); });
  };
  // A box drawn or dragged sideways, starting on the canvas and on a box: SVG elements, not HTML ones.
  for (const target of [host.querySelector('svg')!, host.querySelector('svg rect')!]) {
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

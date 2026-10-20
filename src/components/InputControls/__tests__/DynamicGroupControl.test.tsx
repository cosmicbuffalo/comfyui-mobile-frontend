import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetControl } from '../WidgetControl';
import { ensureLocaleLoaded, useLocaleStore } from '@/i18n';
import type { DynamicGroupEdit, GroupRow } from '@/utils/workflowInputs/dynamicGroups';

interface FieldProps {
  name: string; value: unknown; disabled?: boolean; modelKind?: string; hasError?: boolean;
  options?: Record<string, unknown>; onChange: (value: unknown) => void;
}
vi.mock('../ModelComboControl', () => ({ ModelComboControl: ({ name, value, disabled, modelKind, options, onChange, hasError }: FieldProps) =>
  <input aria-label={name} value={String(value)} disabled={disabled} data-model-kind={modelKind} data-error={String(Boolean(hasError))}
    data-strip-suffix={String(options?.stripSafetensorsSuffix)} onChange={event => onChange(event.target.value)} />,
}));
vi.mock('../NumberControl', () => ({ NumberControl: ({ name, value, disabled, options, onChange }: FieldProps) =>
  <input type="number" aria-label={name} value={Number(value)} disabled={disabled}
    min={options?.min as number} max={options?.max as number} step={options?.step as number}
    onChange={event => onChange(Number(event.target.value))} />,
}));
vi.mock('../ComboControl', () => ({ ComboControl: ({ name, value }: FieldProps) => <span data-combo={name}>{String(value)}</span> }));

const options = { min: 1, max: 20, group_name: 'LoRA', template: { required: {
  lora_name: ['COMBO', { options: ['a.safetensors', 'b.safetensors'] }],
  strength: ['FLOAT', { default: 1, min: -100, max: 100, step: 0.01 }],
  enabled: ['BOOLEAN', { default: true }],
} } };
const row = (name = 'a.safetensors', enabled = false): GroupRow => ({ lora_name: name, strength: -0.5, enabled });
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  useLocaleStore.getState().setLocale('en');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); useLocaleStore.getState().setLocale('en'); });

function render(rows = [row()], extra: Record<string, unknown> = {}, disabled = false) {
  const onChange = vi.fn<(edit: DynamicGroupEdit) => void>();
  function Harness() {
    const [value, setValue] = useState(rows);
    return <WidgetControl name="loras" type="DYNAMIC_GROUP" value={value} options={{ ...options, ...extra }} disabled={disabled}
      onChange={edit => { onChange(edit); setValue(edit.rows); }} />;
  }
  act(() => root.render(<Harness />));
  return onChange;
}
function button(label: string) {
  const result = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find(element => (element.getAttribute('aria-label') ?? element.textContent) === label);
  expect(result, `button ${label}`).toBeTruthy();
  return result!;
}
const click = (label: string) => act(() => button(label).click());
const bulk = () => container.querySelector<HTMLButtonElement>('[role="switch"]')!;
const groups = () => [...container.querySelectorAll<HTMLElement>('[role="group"]')];

describe('native LoRA group controls', () => {
  it('marks the row field the backend reported, and only that row', () => {
    render([row('a.safetensors'), row('b.safetensors')], { __errors: ['loras.1.lora_name'] });
    const [first, second] = groups();
    expect(first.querySelector('[data-model-kind]')?.getAttribute('data-error')).toBe('false');
    expect(second.querySelector('[data-model-kind]')?.getAttribute('data-error')).toBe('true');
  });

  it('adds stock defaults and enforces the row limits', () => {
    const onChange = render([row()], { max: 2 });
    expect(button('Remove row 1').disabled).toBe(true);
    // One row has nothing to reorder around.
    expect(container.querySelector('[aria-label="Move row 1 up"]')).toBeNull();
    click('Add Lora');
    expect(onChange).toHaveBeenLastCalledWith({ rows: [row(), { lora_name: 'a.safetensors', strength: 1, enabled: true }], order: [0, -1] });
    expect(button('Add Lora').disabled).toBe(true);
    expect(button('Remove row 1').disabled).toBe(false);
    expect(button('Move row 1 up').disabled).toBe(true);
    expect(button('Move row 2 down').disabled).toBe(true);
  });

  it('toggles an entry without changing its file or strength, and keeps disabled rows editable', () => {
    const onChange = render();
    // Off reads like a bypassed node: a purple row, with only the LoRA picker dimmed.
    expect(groups()[0].classList.contains('bg-purple-950/35')).toBe(true);
    expect(groups()[0].classList.contains('opacity-60')).toBe(false);
    expect(groups()[0].querySelector('[data-lora-picker]')!.classList.contains('opacity-60')).toBe(true);
    expect(button('Disabled').getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelectorAll('[data-combo]').length).toBe(0);
    expect([...container.querySelectorAll<HTMLInputElement>('input')].every(input => !input.disabled)).toBe(true);
    click('Disabled');
    expect(onChange).toHaveBeenLastCalledWith({ rows: [row('a.safetensors', true)], order: [0] });
    expect(groups()[0].classList.contains('bg-purple-950/35')).toBe(false);
    expect(groups()[0].querySelector('[data-lora-picker]')!.classList.contains('opacity-60')).toBe(false);
    expect(button('Enabled').getAttribute('aria-pressed')).toBe('true');
    click('Enabled');
    expect(onChange).toHaveBeenLastCalledWith({ rows: [row()], order: [0] });
  });

  it('bulk toggles only enabled fields that are not connected', () => {
    const rows = [row(), row('b.safetensors'), row('c.safetensors', true)];
    const onChange = render(rows, { __connected: ['loras.0.enabled'] });
    expect(button('Disabled').disabled).toBe(true);
    expect(bulk().getAttribute('aria-checked')).toBe('false');
    act(() => bulk().click());
    expect(onChange).toHaveBeenLastCalledWith({ rows: [rows[0], { ...rows[1], enabled: true }, rows[2]], order: [0, 1, 2] });
    expect(bulk().getAttribute('aria-checked')).toBe('true');
    act(() => bulk().click());
    expect(onChange).toHaveBeenLastCalledWith({ rows: [rows[0], rows[1], { ...rows[2], enabled: false }], order: [0, 1, 2] });
  });

  it('disables the bulk toggle when every enabled field is connected', () => {
    render([row()], { __connected: ['loras.0.enabled'] });
    expect(bulk().disabled).toBe(true);
    expect(button('Disabled').disabled).toBe(true);
  });

  it('retains row identity mappings when moving and removing entries', () => {
    const first = row(), second = row('b.safetensors', true);
    const onChange = render([first, second]);
    click('Move row 1 down');
    expect(onChange).toHaveBeenLastCalledWith({ rows: [second, first], order: [1, 0] });
    click('Remove row 1');
    expect(onChange).toHaveBeenLastCalledWith({ rows: [first], order: [1] });
  });

  it('keeps qualified model controls, the native strength range, and connected-field locks', () => {
    render([row()], { __connected: ['loras.0.lora_name', 'loras.0.strength'] });
    const model = container.querySelector<HTMLInputElement>('[aria-label="loras.0.lora_name"]')!;
    const strength = container.querySelector<HTMLInputElement>('[aria-label="loras.0.strength"]')!;
    expect(model.dataset.modelKind).toBe('loras');
    expect(model.dataset.stripSuffix).toBe('true');
    expect(model.disabled).toBe(true);
    expect(strength.disabled).toBe(true);
    expect([strength.min, strength.max, strength.step]).toEqual(['-100', '100', '0.01']);
    expect(button('Disabled').disabled).toBe(false);
  });

  it('prevents every edit when the node is bypassed', () => {
    const onChange = render([row()], {}, true);
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].every(element => element.disabled)).toBe(true);
    expect([...container.querySelectorAll<HTMLInputElement>('input')].every(element => element.disabled)).toBe(true);
    act(() => bulk().click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('translates the stack actions and row labels', async () => {
    await ensureLocaleLoaded('ja');
    act(() => useLocaleStore.getState().setLocale('ja'));
    render([row(), row()]);
    expect(button('Lora を追加')).toBeTruthy();
    expect(button('1 行目を上へ移動')).toBeTruthy();
    expect(button('1 行目を削除')).toBeTruthy();
    expect(bulk().textContent).toContain('すべての LoRA を切り替え');
    expect(button('無効')).toBeTruthy();
  });
});

it('keeps unrelated DynamicGroup templates generic', () => {
  render([{ count: 2, enabled: false }], { group_name: 'Item', template: { required: {
    count: ['INT', { default: 1 }], enabled: ['BOOLEAN', { default: true }],
  } } });
  expect(container.querySelector('[role="switch"]')).toBeNull();
  expect(container.querySelector('[data-combo="loras.0.enabled"]')).not.toBeNull();
  expect(groups()[0].classList.contains('opacity-60')).toBe(false);
  expect(button('Add Item')).toBeTruthy();
});

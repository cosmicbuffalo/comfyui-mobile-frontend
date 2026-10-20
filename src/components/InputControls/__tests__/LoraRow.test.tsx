import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoraRow } from '../LoraRow';
import { WidgetControl } from '../WidgetControl';
import { useLocaleStore } from '@/i18n';

vi.mock('../ModelComboControl', () => ({ ModelComboControl: ({ value }: { value: unknown }) => <span data-picker>{String(value)}</span> }));
vi.mock('../NumberControl', () => ({ NumberControl: ({ name, value }: { name: string; value: unknown }) => <input aria-label={name} defaultValue={String(value)} /> }));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  useLocaleStore.getState().setLocale('en');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const labels = () => [...container.querySelectorAll('button')].map(button => button.getAttribute('aria-label') ?? button.textContent);
const lora = { value: 'detail.safetensors', options: ['detail.safetensors'], onChange: () => {} };
const strength = { value: 0.8, onChange: () => {} };

it('marks an off LoRA like a bypassed node and dims only the picker', () => {
  act(() => root.render(<LoraRow index={0} enabled={{ value: false, onChange: () => {} }} onRemove={() => {}} lora={lora} strength={strength} />));
  const row = container.querySelector('[data-lora-row]')!;
  expect(row.className).toContain('bg-purple-950/35');
  expect(row.className).not.toContain('opacity-60');
  expect(container.querySelector('[data-lora-picker]')!.className).toContain('opacity-60');
  expect(container.querySelector('input[aria-label="Strength"]')!.closest('.opacity-60')).toBeNull();
});

it('draws only the controls a node has', () => {
  // A fixed slot with no switch, remove or reorder: picker and strengths only.
  act(() => root.render(<LoraRow index={1} lora={lora} strength={strength} clipStrength={{ value: 1, onChange: () => {} }} />));
  expect(labels()).toEqual([]);
  expect(container.querySelector('[aria-label="LoRA 2"]')).not.toBeNull();
  expect(container.querySelector('input[aria-label="Model strength"]')).not.toBeNull();
  expect(container.querySelector('input[aria-label="Clip strength"]')).not.toBeNull();

  // A full stack row with a hideable clip strength.
  const onToggle = vi.fn();
  act(() => root.render(<LoraRow index={0} enabled={{ value: true, onChange: () => {} }} onRemove={() => {}} move={{ down: () => {} }}
    lora={lora} strength={strength} clipStrength={{ value: 1, onChange: () => {} }} clipToggle={{ open: false, onToggle }} />));
  expect(labels()).toEqual(['Enabled', 'Remove row 1', 'Move row 1 up', 'Move row 1 down', 'Separate clip strength']);
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Move row 1 up"]')!.disabled).toBe(true);
  expect(container.querySelector('input[aria-label="Clip strength"]')).toBeNull();
  act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Separate clip strength')!.click());
  expect(onToggle).toHaveBeenCalledOnce();
});

it('shows Power Lora toggle-all as a switch that reflects its rows', () => {
  const onChange = vi.fn();
  act(() => root.render(<WidgetControl name="Loras" type="POWER_LORA_HEADER" value={false} onChange={onChange} />));
  const toggle = container.querySelector('[role="switch"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  act(() => (toggle as HTMLButtonElement).click());
  expect(onChange).toHaveBeenCalledWith(true);
});

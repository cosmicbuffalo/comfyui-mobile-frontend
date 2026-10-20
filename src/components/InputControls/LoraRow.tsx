import type { ReactNode } from 'react';
import { WidgetControl } from './WidgetControl';
import {
  controlDangerButtonClassName,
  controlDashedButtonClassName,
  controlGhostButtonClassName,
  controlToggleButtonClassName,
} from './controlStyles';
import { CaretDownIcon, CaretUpIcon, PlusIcon } from '@/components/icons';
import { useI18n } from '@/i18n';

/**
 * One LoRA in any LoRA picker or stack node: native LoRA groups, LoRA Manager,
 * rgthree Power Lora and Comfyroll's CR LoRA Stack all draw through here, so
 * every LoRA looks and behaves the same whichever node holds it. A node passes
 * only the controls it has; the rest are not drawn.
 */

/** What a field passes through to its control: pins, row menus, error and lock state. */
type FieldExtras = {
  name?: string;
  hasError?: boolean;
  disabled?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  isPromoted?: boolean;
  labelAccessory?: ReactNode;
};

type NumberField = FieldExtras & { value: number; onChange: (value: number) => void; options?: Record<string, unknown> };

const LORA_STRENGTH_OPTIONS = { min: -10, max: 10, step: 0.01 };

export function LoraRow({ index, disabled, enabled, onRemove, removeDisabled, move, lora, strength, clipStrength, clipToggle }: {
  /** Zero-based position in the node; rows are labelled "LoRA 1", "LoRA 2", …. */
  index: number;
  /** The whole node is not editable (bypassed). */
  disabled?: boolean;
  enabled?: { value: boolean; onChange: (value: boolean) => void; disabled?: boolean };
  onRemove?: () => void;
  removeDisabled?: boolean;
  /** Reorder arrows; a missing direction is drawn disabled. */
  move?: { up?: () => void; down?: () => void };
  lora: FieldExtras & {
    value: string;
    onChange: (value: string) => void;
    /** Combo options as WidgetControl takes them. */
    options?: unknown;
    /** No list of LoRAs to choose from: type the name instead. */
    freeText?: boolean;
  };
  strength: NumberField;
  /** A separate clip strength, for nodes that have one. */
  clipStrength?: NumberField;
  /** Lets the row show or hide its separate clip strength. */
  clipToggle?: { open: boolean; onToggle: () => void };
}) {
  const { t } = useI18n();
  const n = index + 1;
  const off = enabled !== undefined && !enabled.value;
  const showClip = clipStrength !== undefined && (clipToggle?.open ?? true);
  const pickerHasAccessories = Boolean(lora.labelAccessory || lora.onTogglePin);
  const number = (field: NumberField, text: string) => <WidgetControl
    name={field.name ?? text} displayLabel={text} type="FLOAT" value={field.value}
    options={field.options ?? LORA_STRENGTH_OPTIONS} onChange={value => field.onChange(Number(value))}
    disabled={disabled || field.disabled} hasError={field.hasError}
    isPinned={field.isPinned} onTogglePin={field.onTogglePin} isPromoted={field.isPromoted} labelAccessory={field.labelAccessory}
  />;
  return <div role="group" aria-label={t('LoRA {n}', { n })} data-lora-row data-enabled={off ? 'false' : 'true'}
    // Disabled reads like a bypassed node: purple, with only the LoRA itself dimmed.
    className={`p-3 space-y-2 rounded-lg border ${off ? 'border-purple-500/30 bg-purple-950/35' : 'border-white/10 bg-slate-950/60'}`}
  >
    {(enabled || onRemove || move) && <div className="flex items-center gap-2 text-sm">
      {enabled && <button type="button" aria-pressed={enabled.value}
        className={`min-w-0 flex-1 py-2 text-sm ${controlToggleButtonClassName({ active: enabled.value, disabled: disabled || enabled.disabled, radius: 'lg' })}`}
        disabled={disabled || enabled.disabled}
        onClick={() => enabled.onChange(!enabled.value)}
      >{enabled.value ? t('Enabled') : t('Disabled')}</button>}
      {onRemove && <button type="button" className={`min-w-0 flex-1 ${controlDangerButtonClassName}`}
        aria-label={t('Remove row {n}', { n })} disabled={disabled || removeDisabled} onClick={onRemove}
      >{t('Remove')}</button>}
      {move && <>
        <button type="button" className={`h-10 w-10 shrink-0 flex items-center justify-center ${controlGhostButtonClassName}`}
          aria-label={t('Move row {n} up', { n })} disabled={disabled || !move.up} onClick={move.up}
        ><CaretUpIcon className="h-8 w-8 shrink-0" /></button>
        <button type="button" className={`h-10 w-10 shrink-0 flex items-center justify-center ${controlGhostButtonClassName}`}
          aria-label={t('Move row {n} down', { n })} disabled={disabled || !move.down} onClick={move.down}
        ><CaretDownIcon className="h-8 w-8 shrink-0" /></button>
      </>}
    </div>}
    <div className={off ? 'opacity-60' : ''} data-lora-picker>
      <WidgetControl
        name={lora.name ?? t('Selected LoRA')} displayLabel={t('Selected LoRA')}
        hideLabel={!pickerHasAccessories} containerClass="space-y-0 w-full"
        type={lora.freeText ? 'STRING' : 'COMBO'} modelKind={lora.freeText ? undefined : 'loras'}
        value={lora.value} options={lora.freeText ? { placeholder: t('LoRA name') } : lora.options}
        onChange={value => lora.onChange(String(value))}
        disabled={disabled || lora.disabled} hasError={lora.hasError}
        isPinned={lora.isPinned} onTogglePin={lora.onTogglePin} isPromoted={lora.isPromoted} labelAccessory={lora.labelAccessory}
      />
    </div>
    {number(strength, showClip ? t('Model strength') : t('Strength'))}
    {showClip && number(clipStrength, t('Clip strength'))}
    {clipToggle && <button type="button" className={`w-full ${controlGhostButtonClassName}`} disabled={disabled} onClick={clipToggle.onToggle}>
      {clipToggle.open ? t('Hide clip strength') : t('Separate clip strength')}
    </button>}
  </div>;
}

/** The switch that turns every LoRA in the node on or off together. */
export function LoraToggleAll({ checked, onChange, disabled }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return <button type="button" role="switch" aria-checked={checked}
    className="flex w-full items-center gap-3 rounded-lg border border-cyan-400/20 bg-cyan-500/10 p-3 text-left disabled:opacity-60 disabled:cursor-not-allowed"
    disabled={disabled} onClick={() => onChange(!checked)}
  >
    <span aria-hidden="true" className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${checked ? 'bg-cyan-500' : 'bg-slate-700'}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white transition ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
    </span>
    <span className="text-sm font-semibold uppercase tracking-wider text-cyan-300">{t('Toggle All Loras')}</span>
  </button>;
}

export function LoraAddButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  return <button type="button" className={controlDashedButtonClassName} disabled={disabled} onClick={onClick}>
    <PlusIcon className="h-5 w-5" />{t('Add Lora')}
  </button>;
}

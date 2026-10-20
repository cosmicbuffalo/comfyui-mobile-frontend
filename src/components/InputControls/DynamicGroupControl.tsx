import { WidgetControl } from './WidgetControl';
import { getDefaultWidgetValue, getComboOptions, isComboType } from '@/utils/workflowInputs';
import { groupFields, groupLimits, type GroupRow, type DynamicGroupEdit } from '@/utils/workflowInputs/dynamicGroups';
import {
  controlDangerButtonClassName,
  controlDashedButtonClassName,
  controlGhostButtonClassName,
  controlNestedSurfaceClassName,
  controlSecondaryButtonClassName,
  controlToggleButtonClassName,
} from './controlStyles';
import { modelWidgetKind } from '@/utils/modelWidgetKind';
import { CaretDownIcon, CaretUpIcon, PlusIcon } from '@/components/icons';
import { useI18n } from '@/i18n';

export function DynamicGroupControl({ name, value, options, onChange, disabled }: {
  name: string; value: GroupRow[]; options: Record<string, unknown>;
  onChange: (edit: DynamicGroupEdit) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  const fields = groupFields(options);
  // Other DynamicGroup templates keep their schema-driven controls.
  const isLoraGroup = Object.keys(fields).length === 3
    && fields.lora_name && isComboType(fields.lora_name[0])
    && fields.strength?.[0] === 'FLOAT' && fields.enabled?.[0] === 'BOOLEAN';
  const limits = groupLimits(options);
  const rows = (Array.isArray(value) ? value : []).map(row => Object.fromEntries(
    Object.entries(fields).map(([field, [type, fieldOptions]]) => [field, row[field] ?? getDefaultWidgetValue(type, fieldOptions)]),
  ));
  const connected = options.__connected as string[] ?? [];
  const errors = options.__errors as string[] ?? [];
  const editableEnabledRows = rows.map((_, index) => index)
    .filter(index => !connected.includes(`${name}.${index}.enabled`));
  const allEnabled = editableEnabledRows.length > 0
    && editableEnabledRows.every(index => Boolean(rows[index].enabled));
  const commit = (next: GroupRow[], order = rows.map((_, index) => index)) => onChange({ rows: next, order });
  const changeField = (index: number, field: string, next: unknown) => commit(
    rows.map((entry, i) => i === index ? { ...entry, [field]: next } : entry),
  );
  const remove = (index: number) => commit(
    rows.filter((_, i) => i !== index), rows.map((_, i) => i).filter(i => i !== index),
  );
  const move = (index: number, offset: number) => {
    const next = [...rows];
    const order = rows.map((_, i) => i);
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    [order[index], order[index + offset]] = [order[index + offset], order[index]];
    commit(next, order);
  };
  return <div className="space-y-3" data-dynamic-group={name}>
    {isLoraGroup && rows.length > 0 && <button
      type="button" role="switch" aria-checked={allEnabled}
      className="flex w-full items-center gap-3 rounded-lg border border-cyan-400/20 bg-cyan-500/10 p-3 text-left disabled:opacity-60 disabled:cursor-not-allowed"
      disabled={disabled || editableEnabledRows.length === 0}
      onClick={() => commit(rows.map((row, index) => editableEnabledRows.includes(index) ? { ...row, enabled: !allEnabled } : row))}
    >
      <span aria-hidden="true" className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${allEnabled ? 'bg-cyan-500' : 'bg-slate-700'}`}>
        <span className={`inline-block h-5 w-5 rounded-full bg-white transition ${allEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
      </span>
      <span className="text-sm font-semibold uppercase tracking-wider text-cyan-300">{t('Toggle All Loras')}</span>
    </button>}
    {rows.map((row, index) => <div key={index}
      role="group" aria-label={isLoraGroup ? t('LoRA {n}', { n: index + 1 }) : `${String(options.group_name ?? name)} ${index + 1}`}
      className={`p-3 space-y-2 ${controlNestedSurfaceClassName} ${isLoraGroup && !row.enabled ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2 text-sm">
        {isLoraGroup ? <>
          <button type="button" aria-pressed={Boolean(row.enabled)}
            className={`min-w-0 flex-1 py-2 text-sm ${controlToggleButtonClassName({ active: Boolean(row.enabled), disabled: disabled || connected.includes(`${name}.${index}.enabled`), radius: 'lg' })}`}
            disabled={disabled || connected.includes(`${name}.${index}.enabled`)}
            onClick={() => changeField(index, 'enabled', !row.enabled)}
          >{row.enabled ? t('Enabled') : t('Disabled')}</button>
          <button type="button" className={`min-w-0 flex-1 ${controlDangerButtonClassName}`}
            aria-label={t('Remove row {n}', { n: index + 1 })}
            disabled={disabled || rows.length <= limits.min} onClick={() => remove(index)}
          >{t('Remove')}</button>
        </> : <strong className="mr-auto whitespace-nowrap">{String(options.group_name ?? name)} {index + 1}</strong>}
        {rows.length > 1 && <>
          <button type="button" className={`h-10 w-10 shrink-0 flex items-center justify-center ${controlGhostButtonClassName}`}
            aria-label={t('Move row {n} up', { n: index + 1 })} disabled={disabled || index === 0} onClick={() => move(index, -1)}
          ><CaretUpIcon className="h-8 w-8 shrink-0" /></button>
          <button type="button" className={`h-10 w-10 shrink-0 flex items-center justify-center ${controlGhostButtonClassName}`}
            aria-label={t('Move row {n} down', { n: index + 1 })} disabled={disabled || index === rows.length - 1} onClick={() => move(index, 1)}
          ><CaretDownIcon className="h-8 w-8 shrink-0" /></button>
        </>}
        {!isLoraGroup && <button type="button" className={controlSecondaryButtonClassName}
          aria-label={t('Remove row {n}', { n: index + 1 })} disabled={disabled || rows.length <= limits.min} onClick={() => remove(index)}
        >×</button>}
      </div>
      {Object.entries(fields).filter(([field]) => !isLoraGroup || field !== 'enabled').map(([field, [type, fieldOptions]]) => <WidgetControl
        key={field} name={`${name}.${index}.${field}`}
        displayLabel={isLoraGroup ? field === 'lora_name' ? t('Selected LoRA') : t('Strength') : field.replace(/_/g, ' ')}
        modelKind={modelWidgetKind(field)}
        hideLabel={Boolean(isLoraGroup && field === 'lora_name')}
        containerClass={isLoraGroup ? 'space-y-0 w-full' : undefined}
        type={isComboType(type) ? 'COMBO' : String(type)}
        value={row[field] ?? getDefaultWidgetValue(type, fieldOptions)}
        options={isComboType(type) ? { ...fieldOptions, options: getComboOptions(type, fieldOptions), ...(isLoraGroup ? { stripSafetensorsSuffix: true } : {}) } : fieldOptions}
        disabled={disabled || connected.includes(`${name}.${index}.${field}`)}
        hasError={errors.includes(`${name}.${index}.${field}`)}
        onChange={next => changeField(index, field, next)}
      />)}
    </div>)}
    <button type="button" className={isLoraGroup ? controlDashedButtonClassName : controlSecondaryButtonClassName} disabled={disabled || rows.length >= limits.max} onClick={() => commit([
      ...rows, Object.fromEntries(Object.entries(fields).map(([field, [type, fieldOptions]]) => [field, getDefaultWidgetValue(type, fieldOptions)])),
    ], [...rows.map((_, i) => i), -1])}>
      {isLoraGroup && <PlusIcon className="h-5 w-5" />}
      {isLoraGroup ? t('Add Lora') : t('Add {group}', { group: String(options.group_name ?? name) })}
    </button>
  </div>;
}

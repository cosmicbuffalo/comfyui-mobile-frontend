import { WidgetControl } from './WidgetControl';
import { getDefaultWidgetValue, getComboOptions, isComboType } from '@/utils/workflowInputs';
import { groupFields, groupLimits, type GroupRow, type DynamicGroupEdit } from '@/utils/workflowInputs/dynamicGroups';
import {
  controlGhostButtonClassName,
  controlNestedSurfaceClassName,
  controlSecondaryButtonClassName,
} from './controlStyles';
import { LoraAddButton, LoraRow, LoraToggleAll } from './LoraRow';
import { modelWidgetKind } from '@/utils/modelWidgetKind';
import { CaretDownIcon, CaretUpIcon } from '@/components/icons';
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
  const addRow = () => commit([
    ...rows, Object.fromEntries(Object.entries(fields).map(([field, [type, fieldOptions]]) => [field, getDefaultWidgetValue(type, fieldOptions)])),
  ], [...rows.map((_, i) => i), -1]);
  const locked = (index: number, field: string) => connected.includes(`${name}.${index}.${field}`);
  const fieldName = (index: number, field: string) => `${name}.${index}.${field}`;
  if (isLoraGroup) {
    const [loraType, loraOptions] = fields.lora_name;
    return <div className="space-y-3" data-dynamic-group={name}>
      {rows.length > 0 && <LoraToggleAll checked={allEnabled} disabled={disabled || editableEnabledRows.length === 0}
        onChange={next => commit(rows.map((row, index) => editableEnabledRows.includes(index) ? { ...row, enabled: next } : row))} />}
      {rows.map((row, index) => <LoraRow key={index} index={index} disabled={disabled}
        enabled={{ value: Boolean(row.enabled), disabled: locked(index, 'enabled'), onChange: next => changeField(index, 'enabled', next) }}
        onRemove={() => remove(index)} removeDisabled={rows.length <= limits.min}
        move={rows.length > 1 ? { up: index > 0 ? () => move(index, -1) : undefined, down: index < rows.length - 1 ? () => move(index, 1) : undefined } : undefined}
        lora={{
          name: fieldName(index, 'lora_name'), value: String(row.lora_name ?? ''), disabled: locked(index, 'lora_name'),
          hasError: errors.includes(fieldName(index, 'lora_name')),
          options: { ...loraOptions, options: getComboOptions(loraType, loraOptions), stripSafetensorsSuffix: true },
          onChange: next => changeField(index, 'lora_name', next),
        }}
        strength={{
          name: fieldName(index, 'strength'), value: Number(row.strength), options: fields.strength[1], disabled: locked(index, 'strength'),
          hasError: errors.includes(fieldName(index, 'strength')), onChange: next => changeField(index, 'strength', next),
        }}
      />)}
      <LoraAddButton disabled={disabled || rows.length >= limits.max} onClick={addRow} />
    </div>;
  }
  return <div className="space-y-3" data-dynamic-group={name}>
    {rows.map((row, index) => <div key={index}
      role="group" aria-label={`${String(options.group_name ?? name)} ${index + 1}`}
      className={`p-3 space-y-2 ${controlNestedSurfaceClassName}`}
    >
      <div className="flex items-center gap-2 text-sm">
        <strong className="mr-auto whitespace-nowrap">{String(options.group_name ?? name)} {index + 1}</strong>
        {rows.length > 1 && <>
          <button type="button" className={`h-10 w-10 shrink-0 flex items-center justify-center ${controlGhostButtonClassName}`}
            aria-label={t('Move row {n} up', { n: index + 1 })} disabled={disabled || index === 0} onClick={() => move(index, -1)}
          ><CaretUpIcon className="h-8 w-8 shrink-0" /></button>
          <button type="button" className={`h-10 w-10 shrink-0 flex items-center justify-center ${controlGhostButtonClassName}`}
            aria-label={t('Move row {n} down', { n: index + 1 })} disabled={disabled || index === rows.length - 1} onClick={() => move(index, 1)}
          ><CaretDownIcon className="h-8 w-8 shrink-0" /></button>
        </>}
        <button type="button" className={controlSecondaryButtonClassName}
          aria-label={t('Remove row {n}', { n: index + 1 })} disabled={disabled || rows.length <= limits.min} onClick={() => remove(index)}
        >×</button>
      </div>
      {Object.entries(fields).map(([field, [type, fieldOptions]]) => <WidgetControl
        key={field} name={fieldName(index, field)}
        displayLabel={field.replace(/_/g, ' ')}
        modelKind={modelWidgetKind(field)}
        type={isComboType(type) ? 'COMBO' : String(type)}
        value={row[field] ?? getDefaultWidgetValue(type, fieldOptions)}
        options={isComboType(type) ? { ...fieldOptions, options: getComboOptions(type, fieldOptions) } : fieldOptions}
        disabled={disabled || locked(index, field)}
        hasError={errors.includes(fieldName(index, field))}
        onChange={next => changeField(index, field, next)}
      />)}
    </div>)}
    <button type="button" className={controlSecondaryButtonClassName} disabled={disabled || rows.length >= limits.max} onClick={addRow}>
      {t('Add {group}', { group: String(options.group_name ?? name) })}
    </button>
  </div>;
}

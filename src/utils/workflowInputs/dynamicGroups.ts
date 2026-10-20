import type { NodeTypeDefinition, WorkflowNode } from '@/api/types';
import type { DynamicComboSubInput } from './comboValues';

export const DYNAMIC_GROUP_V3 = 'COMFY_DYNAMICGROUP_V3';
export const isDynamicGroup = (type: string | unknown[]) => type === DYNAMIC_GROUP_V3;
export type GroupRow = Record<string, unknown>;
export interface DynamicGroupEdit { rows: GroupRow[]; order: number[] }

export function groupLimits(options?: Record<string, unknown>) {
  return { min: Number(options?.min ?? 0), max: Number(options?.max ?? 20) };
}

export function groupRowCount(value: unknown, options?: Record<string, unknown>): number {
  const { min, max } = groupLimits(options);
  return Math.max(min, Math.min(max, typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : min));
}

export function groupFields(options?: Record<string, unknown>) {
  const template = options?.template as NodeTypeDefinition['input'] | undefined;
  return { ...template?.required, ...template?.optional };
}

export function getDynamicGroupSubInputs(options: Record<string, unknown> | undefined, prefix: string, count: number): DynamicComboSubInput[] {
  return Array.from({ length: count }, (_, row) => Object.entries(groupFields(options)).map(([name, inputDef]) => ({
    name, qualifiedName: `${prefix}.${row}.${name}`, inputDef,
  }))).flat();
}

/** Stock persists the hidden count, then each row's widget values in template order. */
export function readGroupRows(node: WorkflowNode, name: string, index: number, options?: Record<string, unknown>): GroupRow[] {
  const values = node.widgets_values;
  const count = groupRowCount(Array.isArray(values) ? values[index] : values?.[name], options);
  const definitions = groupFields(options);
  const fields = Object.keys(definitions);
  return Array.from({ length: count }, (_, row) => Object.fromEntries(fields.map((field, column) => [
    field, Array.isArray(values) ? values[index + 1 + row * fields.length + column] : values?.[`${name}.${row}.${field}`],
  ])));
}

import type { NodeTypeDefinition, WorkflowNode } from '@/api/types';
import type { DynamicComboSubInput } from './comboValues';

export const isAutogrow = (type: string | unknown[]) => type === 'COMFY_AUTOGROW_V3';

/** A socket container has neither a controller socket nor a saved widget slot. */
export function autogrowTemplate(options?: Record<string, unknown>) {
  const template = options?.template as { input?: NodeTypeDefinition['input']; names?: string[]; prefix?: string; min?: number; max?: number } | undefined;
  const field = Object.values({ ...template?.input?.required, ...template?.input?.optional })[0];
  const names = template?.names?.filter((name): name is string => typeof name === 'string')
    ?? Array.from({ length: Math.max(0, Math.min(100, Number(template?.max ?? 10))) }, (_, i) => `${template?.prefix ?? 'input'}${i}`);
  return { names: names.slice(0, 100), min: Math.max(0, Math.min(names.length, Number(template?.min ?? 1))), field };
}

export function autogrowInputs(options: Record<string, unknown> | undefined, prefix: string, node?: Pick<WorkflowNode, 'inputs'>): DynamicComboSubInput[] {
  const { names, min, field } = autogrowTemplate(options);
  if (!field) return [];
  // New nodes offer a first socket even for a zero-minimum optional group.
  // Saved groups retain their exact materialized names, including gaps.
  const active = node ? new Set(node.inputs.map(input => input.name)) : null;
  return names.filter((name, i) => active ? active.has(`${prefix}.${name}`) : i < Math.max(1, min)).map(name => ({
    name, qualifiedName: `${prefix}.${name}`, inputDef: [field[0], { ...field[1], forceInput: true }],
  }));
}

export interface AutogrowEdit { add?: boolean; remove?: string }

export function editAutogrow(node: WorkflowNode, prefix: string, options: Record<string, unknown> | undefined, edit: AutogrowEdit) {
  const { names, min, field } = autogrowTemplate(options);
  if (!field) return null;
  const current = autogrowInputs(options, prefix, node);
  if (edit.remove) {
    if (current.length <= min || !current.some(input => input.qualifiedName === edit.remove)) return null;
    const removed = node.inputs.find(input => input.name === edit.remove);
    return { node: { ...node, inputs: node.inputs.filter(input => input.name !== edit.remove) }, removedLinkIds: removed?.link == null ? [] : [removed.link] };
  }
  if (!edit.add) return null;
  const name = names.find(name => !node.inputs.some(input => input.name === `${prefix}.${name}`));
  if (!name) return null;
  const inputs = [...node.inputs];
  let last = -1;
  for (let i = inputs.length - 1; i >= 0; i--) if (current.some(child => child.qualifiedName === inputs[i].name)) { last = i; break; }
  const controller = inputs.findIndex(input => input.name === prefix);
  const following = inputs.findIndex(input => {
    const index = names.findIndex(candidate => `${prefix}.${candidate}` === input.name);
    return index > names.indexOf(name);
  });
  inputs.splice(following >= 0 ? following : last >= 0 ? last + 1 : controller >= 0 ? controller : inputs.length, 0, { name: `${prefix}.${name}`, type: Array.isArray(field[0]) ? 'COMBO' : String(field[0]), link: null });
  return { node: { ...node, inputs: inputs.filter(input => input.name !== prefix) }, removedLinkIds: [] as number[] };
}

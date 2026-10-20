import type { WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { getActiveNodeInputDefinitions } from '@/utils/workflowInputs';
import { isAutogrow, autogrowInputs, autogrowTemplate } from '@/utils/workflowInputs/autogrow';
import { controlInlineButtonClassName as controlSecondaryButtonClassName } from './controlStyles';
import { useI18n } from '@/i18n';

export function AutogrowControls({ node, itemKey, disabled }: { node: WorkflowNode; itemKey: string; disabled: boolean }) {
  const { t } = useI18n();
  const types = useWorkflowStore(s => s.nodeTypes);
  const update = useWorkflowStore(s => s.updateNodeWidget);
  const definition = types?.[node.type];
  if (!definition) return null;
  return getActiveNodeInputDefinitions(definition, node).filter(d => isAutogrow(d.inputDef[0])).map(group => {
    const inputs = autogrowInputs(group.inputDef[1], group.qualifiedName, node);
    const { min, names } = autogrowTemplate(group.inputDef[1]);
    return <fieldset key={group.qualifiedName} className="my-3 space-y-2" disabled={disabled} data-autogrow={group.qualifiedName}>
      <legend className="text-xs text-slate-400">{group.name}</legend>
      <div className="flex flex-wrap gap-2">
        {inputs.map(input => <button key={input.qualifiedName} className={controlSecondaryButtonClassName} disabled={disabled || inputs.length <= min}
          aria-label={t('Remove {name}', { name: input.qualifiedName })}
          onClick={() => update(itemKey, -1, { remove: input.qualifiedName }, group.qualifiedName)}>{input.name} ×</button>)}
        <button className={controlSecondaryButtonClassName} disabled={disabled || inputs.length >= names.length}
          onClick={() => update(itemKey, -1, { add: true }, group.qualifiedName)}>{t('Add {name}', { name: group.name })}</button>
      </div>
    </fieldset>;
  });
}

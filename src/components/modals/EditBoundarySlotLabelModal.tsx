import { useMemo, useState } from 'react';
import type { WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import {
  collectDivergentInstanceLabels,
  collectSubgraphInstances,
  getDefinitionSlotLabel,
  getInstanceSlotLabel,
} from '@/utils/boundarySlotLabels';
import { getInstanceNumber } from '@/utils/canonicalWorkflowOps';
import { findWorkflowNodeInScope } from '@/utils/subgraphPlaceholderLabels';
import { Dialog } from './Dialog';
import { useI18n } from '@/i18n';

interface EditBoundarySlotLabelModalProps {
  onClose: () => void;
  direction: 'input' | 'output';
  slotIndex: number;
  subgraphId: string;
  /**
   * The placeholder being renamed through, when the modal is opened from a card
   * OUTSIDE the subgraph. Inside it, the scope stack names the instance; from a
   * placeholder card it has to be passed, or there is no instance to write to
   * and no choice to offer.
   */
  instanceNodeId?: number;
}

type LabelScope = 'definition' | 'instance';

/**
 * Rename one boundary slot, choosing whether the new name belongs to the whole
 * subgraph type or only to the instance the user came in through.
 *
 * The choice only appears when there is more than one instance — with a single
 * one the distinction is invisible, and asking about it is noise. When other
 * instances disagree about this slot's name, they are listed, so the label on
 * screen is never mistaken for the one the whole type uses.
 */
export function EditBoundarySlotLabelModal({
  onClose,
  direction,
  slotIndex,
  subgraphId,
  instanceNodeId,
}: EditBoundarySlotLabelModalProps) {
  const { t } = useI18n();
  const workflow = useWorkflowStore((s) => s.workflow);
  const scopeStack = useWorkflowStore((s) => s.scopeStack);
  const setBoundarySlotLabel = useWorkflowStore((s) => s.setBoundarySlotLabel);

  const def = useMemo(
    () => workflow?.definitions?.subgraphs?.find((sg) => sg.id === subgraphId) ?? null,
    [workflow, subgraphId],
  );
  const slot = (direction === 'input' ? def?.inputs : def?.outputs)?.[slotIndex];

  // The instance this scope was entered through lives in the parent scope.
  const currentInstance = useMemo<WorkflowNode | null>(() => {
    if (instanceNodeId != null) {
      return (
        collectSubgraphInstances(workflow, subgraphId).find(
          (instance) => instance.node.id === instanceNodeId,
        )?.node ?? null
      );
    }
    const top = scopeStack[scopeStack.length - 1];
    if (top?.type !== 'subgraph') return null;
    const parentFrame = scopeStack[scopeStack.length - 2];
    const parentSubgraphId = parentFrame?.type === 'subgraph' ? parentFrame.id : null;
    return findWorkflowNodeInScope(workflow, top.placeholderNodeId, parentSubgraphId);
  }, [instanceNodeId, scopeStack, subgraphId, workflow]);

  const instanceCount = useMemo(
    () => collectSubgraphInstances(workflow, subgraphId).length,
    [workflow, subgraphId],
  );
  const divergent = useMemo(
    () => collectDivergentInstanceLabels(workflow, def, currentInstance, direction, slotIndex),
    [workflow, def, currentInstance, direction, slotIndex],
  );

  const definitionLabel = getDefinitionSlotLabel(def, direction, slotIndex);
  const instanceLabel = slot?.name
    ? getInstanceSlotLabel(currentInstance, direction, slot.name)
    : null;

  // Start on the level the current label actually comes from, so opening and
  // saving without changing the scope never moves a label between levels.
  const [scope, setScope] = useState<LabelScope>(instanceLabel ? 'instance' : 'definition');
  const [value, setValue] = useState(instanceLabel ?? (slot?.label ?? ''));

  const handleScopeChange = (next: LabelScope) => {
    setScope(next);
    setValue(next === 'instance' ? (instanceLabel ?? '') : (slot?.label ?? ''));
  };

  if (!def || !slot) return null;

  const instanceName = (node: WorkflowNode) => {
    const number = getInstanceNumber(node);
    return number != null
      ? t('Instance {number}', { number })
      : t('Instance #{id}', { id: node.id });
  };

  return (
    <Dialog
      onClose={onClose}
      title={
        direction === 'input' ? t('Rename Subgraph Input') : t('Rename Subgraph Output')
      }
      size="md"
      description={
        <div className="boundary-label-editor mt-2 flex flex-col gap-3">
          <input
            type="text"
            autoFocus
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400"
            value={value}
            placeholder={slot.name || definitionLabel}
            data-swipe-nav-ignore
            onChange={(event) => setValue(event.target.value)}
          />

          {instanceCount > 1 && (
            <div className="boundary-label-scope flex flex-col gap-1.5">
              <span className="text-xs text-slate-400">
                {t('This subgraph has {count} instances. Apply the name to:', {
                  count: instanceCount,
                })}
              </span>
              <div className="flex gap-2">
                {(
                  [
                    ['instance', t('This instance')],
                    ['definition', t('All instances')],
                  ] as Array<[LabelScope, string]>
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    data-scope={key}
                    aria-pressed={scope === key}
                    className={`boundary-label-scope-option flex-1 rounded-lg border px-3 py-2 text-sm ${
                      scope === key
                        ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                    onClick={() => handleScopeChange(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500">
            {t('Use {token} for the instance number.', { token: '{n}' })}
            {scope === 'instance' && instanceCount > 1
              ? ` ${t('Clearing the name returns this instance to the shared one, {label}.', {
                  label: definitionLabel,
                })}`
              : ''}
          </p>

          {divergent.length > 0 && (
            <div className="boundary-label-divergence rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-xs text-slate-400">
                {t('Other instances call this slot:')}
              </div>
              <ul className="mt-1 flex flex-col gap-0.5">
                {divergent.map(({ node, label }) => (
                  <li key={node.id} className="text-xs text-slate-300 truncate">
                    {instanceName(node)} — {label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      }
      actions={[
        { label: t('Cancel'), onClick: onClose, variant: 'secondary' },
        {
          label: t('Save'),
          onClick: () => {
            setBoundarySlotLabel(direction, slotIndex, value, scope, {
              subgraphId,
              ...(instanceNodeId != null ? { instanceNodeId } : {}),
            });
            onClose();
          },
          variant: 'primary',
        },
      ]}
    />
  );
}

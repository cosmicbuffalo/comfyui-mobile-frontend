import { useWorkflowStore } from '@/hooks/useWorkflow';
import { resolveWorkflowNodeDisplayName } from '@/utils/subgraphPlaceholderLabels';
import { Dialog } from './Dialog';
import { useI18n } from '@/i18n';

interface RemoveHarvestedNodesDialogProps {
  /** Root nodes a move left feeding nothing, offered by moveItemsIntoSubgraph. */
  nodeIds: number[];
  onClose: () => void;
}

/**
 * Offer to remove the nodes a move-into-subgraph left with no purpose.
 *
 * When a move retires a boundary slot on a shared type, the node that fed that
 * slot on every OTHER instance loses its only connection — its value has
 * already been carried onto its instance's promoted widgets by the harvest, so
 * the node itself is feeding nothing. Removal is offered rather than done:
 * these are nodes the user placed, and the move already changed enough on its
 * own. Declining keeps them; either way the workflow is already consistent.
 */
export function RemoveHarvestedNodesDialog({
  nodeIds,
  onClose,
}: RemoveHarvestedNodesDialogProps) {
  const { t } = useI18n();
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const removeHarvestedNodes = useWorkflowStore((s) => s.removeHarvestedNodes);

  const doomed = nodeIds.flatMap((id) => {
    const node = (workflow?.nodes ?? []).find((candidate) => candidate.id === id);
    if (!node) return [];
    return [{ id, label: resolveWorkflowNodeDisplayName(workflow, node, nodeTypes) }];
  });
  if (doomed.length === 0) return null;

  return (
    <Dialog
      onClose={onClose}
      title={t('These nodes now feed nothing')}
      size="md"
      description={
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-sm text-slate-300">
            {t(
              'The slot they fed moved inside the subgraph, and each value was carried onto its own instance. Nothing reads them anymore — remove them?',
            )}
          </p>
          <ul className="remove-harvested-node-list flex flex-col gap-1">
            {doomed.map((entry) => (
              <li
                key={entry.id}
                className="remove-harvested-node rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100"
              >
                {entry.label}
                <span className="ml-2 text-[11px] text-slate-400">#{entry.id}</span>
              </li>
            ))}
          </ul>
        </div>
      }
      actions={[
        { label: t('Keep them'), onClick: onClose, variant: 'secondary' },
        {
          label: t('Remove'),
          onClick: () => {
            removeHarvestedNodes(doomed.map((entry) => entry.id));
            onClose();
          },
          variant: 'danger',
        },
      ]}
    />
  );
}

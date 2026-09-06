import { useMemo, useState } from 'react';
import type { WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { collectSubgraphInstances } from '@/utils/boundarySlotLabels';
import { resolveWorkflowNodeDisplayName } from '@/utils/subgraphPlaceholderLabels';
import { collectMoveIntoSubgraphTargets } from '@/utils/moveIntoSubgraphTargets';
import { Dialog } from './Dialog';
import { useI18n } from '@/i18n';

interface MoveIntoSubgraphModalProps {
  /** The keys being moved, so placeholders among them are not offered. */
  itemKeys: string[];
  onClose: () => void;
  /** Called with the placeholder key once a destination is settled on. */
  onConfirm: (placeholderItemKey: string) => void;
}

/**
 * Choose which subgraph the selection moves into, and settle what to do when
 * that subgraph is shared.
 *
 * A shared type has no private copy to edit: moving nodes in changes it for
 * every instance, and the connections those nodes were carrying for the OTHER
 * instances go with them. Rather than refuse, the choice is offered plainly —
 * fork this instance into a type of its own first, or go ahead and fix the
 * others afterwards.
 */
export function MoveIntoSubgraphModal({
  itemKeys,
  onClose,
  onConfirm,
}: MoveIntoSubgraphModalProps) {
  const { t } = useI18n();
  const workflow = useWorkflowStore((s) => s.workflow);
  const scopeStack = useWorkflowStore((s) => s.scopeStack);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const forkSubgraphType = useWorkflowStore((s) => s.forkSubgraphType);

  const [shared, setShared] = useState<{ node: WorkflowNode; others: number } | null>(null);

  const candidates = useMemo(() => {
    if (!workflow) return [];
    return collectMoveIntoSubgraphTargets(workflow, scopeStack, itemKeys).map((node) => ({
      node,
      label: resolveWorkflowNodeDisplayName(workflow, node, nodeTypes),
      instances: collectSubgraphInstances(workflow, node.type).length,
    }));
  }, [workflow, scopeStack, nodeTypes, itemKeys]);

  const choose = (entry: (typeof candidates)[number]) => {
    if (entry.instances > 1) {
      setShared({ node: entry.node, others: entry.instances - 1 });
      return;
    }
    onConfirm(entry.node.itemKey!);
  };

  if (shared) {
    return (
      <Dialog
        onClose={onClose}
        title={t('This subgraph is shared')}
        size="md"
        description={
          <p className="mt-2 text-sm text-slate-300">
            {t(
              'Moving these nodes in changes the subgraph for all {count} instances. The other {others} keep their own values and connections where they are wired the same way — anything wired differently is left for you to reconnect. You can fork this instance into a type of its own instead.',
              { count: shared.others + 1, others: shared.others },
            )}
          </p>
        }
        actions={[
          { label: t('Cancel'), onClick: onClose, variant: 'secondary' },
          {
            label: t('Move anyway'),
            onClick: () => onConfirm(shared.node.itemKey!),
            variant: 'danger',
          },
          {
            label: t('Fork first'),
            onClick: () => {
              // The placeholder keeps its node id through the fork, so the key
              // that named it still names it afterwards.
              forkSubgraphType(shared.node.type, [shared.node.id], '');
              onConfirm(shared.node.itemKey!);
            },
            variant: 'primary',
          },
        ]}
      />
    );
  }

  return (
    <Dialog
      onClose={onClose}
      title={t('Move into subgraph')}
      size="md"
      description={
        <div className="mt-2 flex flex-col gap-2">
          {candidates.length === 0 ? (
            <p className="text-sm text-slate-400">
              {t('There is no subgraph in this scope to move them into.')}
            </p>
          ) : (
            candidates.map((entry) => (
              <button
                key={entry.node.id}
                type="button"
                data-node-id={entry.node.id}
                className="move-into-subgraph-option w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                onClick={() => choose(entry)}
              >
                <span className="block text-sm text-slate-100">{entry.label}</span>
                {entry.instances > 1 && (
                  <span className="block text-[11px] text-amber-300">
                    {t('Shared by {count} instances', { count: entry.instances })}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      }
      actions={[{ label: t('Cancel'), onClick: onClose, variant: 'secondary' }]}
    />
  );
}

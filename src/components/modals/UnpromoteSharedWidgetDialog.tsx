import { useWorkflowStore } from '@/hooks/useWorkflow';
import { resolveWorkflowNodeDisplayName } from '@/utils/subgraphPlaceholderLabels';
import {
  collectInstancePromotedValues,
  instancesLosingPromotedValue,
} from '@/utils/promotedWidgetForm';
import { Dialog } from './Dialog';
import { useI18n } from '@/i18n';

interface UnpromoteSharedWidgetDialogProps {
  subgraphId: string;
  /** The instance the unpromote was asked for, whose value survives. */
  instanceNodeId: number;
  /**
   * Where that instance lives — a definition's id, or null at root. Node ids
   * repeat across scopes, so the id alone can name two instances.
   */
  parentSubgraphId: string | null;
  boundarySlot: number;
  slotLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Warn before an unpromote collapses several instances' values into one.
 *
 * A promoted widget holds a value per instance; the inner node it drives holds
 * one. Unpromoting keeps the value of whichever instance it was done from and
 * drops the rest — invisibly, since the control disappears in the same move.
 * On a type with one instance, or where every instance already agrees, nothing
 * is lost and the caller does not raise this.
 */
export function UnpromoteSharedWidgetDialog({
  subgraphId,
  instanceNodeId,
  parentSubgraphId,
  boundarySlot,
  slotLabel,
  onConfirm,
  onClose,
}: UnpromoteSharedWidgetDialogProps) {
  const { t } = useI18n();
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  if (!workflow) return null;

  const nameOf = (row: { instanceNodeId: number; parentSubgraphId: string | null }) => {
    // Looked up in the scope the row names — ids repeat across scopes.
    const pool = row.parentSubgraphId === null
      ? workflow.nodes ?? []
      : (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === row.parentSubgraphId)?.nodes ?? [];
    const node = pool.find((candidate) => candidate.id === row.instanceNodeId);
    return node ? resolveWorkflowNodeDisplayName(workflow, node, nodeTypes) : `#${row.instanceNodeId}`;
  };
  const show = (value: unknown) => {
    if (value === undefined || value === null || value === '') return t('(empty)');
    return typeof value === 'string' ? value : JSON.stringify(value);
  };

  const values = collectInstancePromotedValues(workflow, subgraphId, boundarySlot);
  const keeping = values.find((entry) =>
    entry.instanceNodeId === instanceNodeId && entry.parentSubgraphId === parentSubgraphId);
  // Instances that already agree with the kept value are not losing anything,
  // so listing them would overstate what this does.
  const losing = instancesLosingPromotedValue(values, instanceNodeId, parentSubgraphId);

  /**
   * A value can wrap to several lines, so without ruled rows and a column
   * divider it is not obvious where one instance ends and the next begins —
   * which is the only thing this table is for.
   *
   * The rounding lives on the wrapper rather than the table: a collapsed border
   * does not round, and clipping there keeps the corner rules from poking out
   * past the curve.
   */
  const valueTable = (
    rows: { instanceNodeId: number; parentSubgraphId: string | null; value: unknown }[],
    className: string,
  ) => (
    <div className="overflow-hidden rounded-lg border border-white/15">
      <table className={`${className} w-full border-collapse text-sm`}>
        <thead>
          <tr className="bg-white/5 text-[11px] uppercase tracking-wide text-slate-400">
            <th
              scope="col"
              className="border-b border-r border-white/15 px-3 py-1.5 text-left font-medium"
            >
              {t('Instance')}
            </th>
            <th scope="col" className="border-b border-white/15 px-3 py-1.5 text-left font-medium">
              {t('Value')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.parentSubgraphId ?? ''}:${row.instanceNodeId}`}
              className="unpromote-instance-row align-top border-b border-white/10 last:border-b-0"
            >
              <td className="w-1/3 border-r border-white/10 px-3 py-1.5 text-slate-300">
                {nameOf(row)}
              </td>
              <td className="px-3 py-1.5 text-slate-100 break-words">{show(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Dialog
      onClose={onClose}
      title={t('Unpromote {label}?', { label: slotLabel })}
      size="md"
      description={
        <div className="mt-2 flex flex-col gap-3">
          <p className="text-sm text-slate-300">
            {t('Unpromoting leaves one value on the node inside, shared by every instance of this subgraph.')}
          </p>
          <div className="unpromote-keeping rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-cyan-300">{t('Kept')}</div>
            <div className="mt-1">
              {valueTable(keeping ? [keeping] : [], 'unpromote-keeping-table')}
            </div>
          </div>
          <div className="unpromote-losing rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">{t('Discarded')}</div>
            <div className="mt-1">
              {valueTable(losing, 'unpromote-losing-table')}
            </div>
          </div>
        </div>
      }
      actions={[
        { label: t('Cancel'), onClick: onClose, variant: 'secondary' },
        {
          label: t('Unpromote'),
          onClick: () => {
            onConfirm();
            onClose();
          },
          variant: 'danger',
        },
      ]}
    />
  );
}

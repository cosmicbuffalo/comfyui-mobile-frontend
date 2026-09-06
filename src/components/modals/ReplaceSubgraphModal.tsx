import { Dialog } from './Dialog';
import { useI18n } from '@/i18n';

export interface ReplaceSubgraphOption {
  id: string;
  name: string;
  instanceCount: number;
}

interface ReplaceSubgraphModalProps {
  options: ReplaceSubgraphOption[];
  onPick: (defId: string) => void;
  onCancel: () => void;
}

/**
 * "Replace Subgraph" picker: the subgraph types this placeholder can
 * become an instance of. Picking one swaps the placeholder for an instance of
 * that type, re-wiring matching slots; the caller reports dropped connections.
 */
export function ReplaceSubgraphModal({ options, onPick, onCancel }: ReplaceSubgraphModalProps) {
  const { t } = useI18n();
  return (
    <Dialog
      onClose={onCancel}
      title={t('Replace subgraph')}
      size="md"
      description={
        <div className="replace-subgraph-options mt-2 flex flex-col gap-2">
          <div className="text-xs text-slate-400">
            {t('Choose a reusable subgraph type. Matching connections carry over; the rest are dropped.')}
          </div>
          {options.map((option) => (
            <button
              key={option.id}
              className="replace-subgraph-option w-full text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10"
              onClick={() => onPick(option.id)}
            >
              <div className="text-sm text-slate-100">{option.name}</div>
              <div className="text-xs text-slate-400">
                {option.instanceCount === 1
                  ? t('{count} instance', { count: option.instanceCount })
                  : t('{count} instances', { count: option.instanceCount })}
              </div>
            </button>
          ))}
        </div>
      }
      actions={[{ label: t('Cancel'), onClick: onCancel, variant: 'secondary' }]}
    />
  );
}

import { WorkflowIcon, EditIcon, ExternalLinkIcon, ReloadIcon } from '@/components/icons';
import { Dialog } from './Dialog';
import { useI18n } from '@/i18n';

interface SubgraphActionsModalProps {
  onReplace?: () => void;
  onEditWidgetLabels?: () => void;
  onDissolve?: () => void;
  onClose: () => void;
}

/**
 * The less-frequent operations that change a subgraph's shape or identity.
 * Keeping them behind one entry leaves a placeholder's everyday menu focused
 * on navigation and ordinary card actions.
 */
export function SubgraphActionsModal({
  onReplace,
  onEditWidgetLabels,
  onDissolve,
  onClose,
}: SubgraphActionsModalProps) {
  const { t } = useI18n();
  const choose = (action: (() => void) | undefined) => {
    onClose();
    action?.();
  };

  return (
    <Dialog
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <WorkflowIcon className="h-5 w-5 -scale-x-100 text-cyan-300" />
          {t('Subgraph actions')}
        </span>
      }
      size="md"
      description={
        <div className="mt-2 flex flex-col gap-2">
          {onReplace && (
            <button
              type="button"
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-left hover:bg-white/10"
              onClick={() => choose(onReplace)}
            >
              <ReloadIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <span>
                <span className="block text-sm font-medium text-slate-100">{t('Replace subgraph')}</span>
                <span className="block text-xs text-slate-400">{t('Swap this instance for a reusable type.')}</span>
              </span>
            </button>
          )}
          {onEditWidgetLabels && (
            <button
              type="button"
              className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-left hover:bg-white/10"
              onClick={() => choose(onEditWidgetLabels)}
            >
              <EditIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <span>
                <span className="block text-sm font-medium text-slate-100">{t('Edit widget labels')}</span>
                <span className="block text-xs text-slate-400">{t('Name the exposed slots and promoted widgets.')}</span>
              </span>
            </button>
          )}
          {onDissolve && (
            <button
              type="button"
              className="flex items-center gap-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-left hover:bg-red-500/20"
              onClick={() => choose(onDissolve)}
            >
              <ExternalLinkIcon className="h-4 w-4 shrink-0 text-red-300" />
              <span>
                <span className="block text-sm font-medium text-red-200">{t('Dissolve subgraph')}</span>
                <span className="block text-xs text-red-300/75">{t('Move its contents into the parent graph.')}</span>
              </span>
            </button>
          )}
        </div>
      }
      actions={[{ label: t('Cancel'), onClick: onClose, variant: 'secondary' }]}
    />
  );
}

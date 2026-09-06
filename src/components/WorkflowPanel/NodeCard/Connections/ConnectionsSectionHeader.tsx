import { ChevronRightIcon } from '@/components/icons';
import { useI18n } from '@/i18n';

interface ConnectionsSectionHeaderProps {
  /** Each side's caption appears only when that side has slots. */
  hasInputs: boolean;
  hasOutputs: boolean;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * The "Inputs ——— (o) ——— Outputs" bar above a connections grid, with the
 * fold control in the middle. Shared by the node cards and the subgraph
 * boundary section so the two read as the same component.
 */
export function ConnectionsSectionHeader({
  hasInputs,
  hasOutputs,
  expanded,
  onToggle,
}: ConnectionsSectionHeaderProps) {
  const { t } = useI18n();

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
      <div className="flex min-w-0 items-center gap-2">
        {hasInputs && <span className="shrink-0">{t('Inputs')}</span>}
        <span className="connection-section-divider h-px min-w-0 flex-1 bg-slate-700" aria-hidden="true" />
      </div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? t('Fold connections') : t('Unfold connections')}
        data-fold-state={expanded ? 'expanded' : 'collapsed'}
        onClick={onToggle}
        className={`flex h-7 items-center justify-center border text-slate-400 transition-[width,border-radius,background-color,border-color,color] duration-200 ease-out focus-visible:outline-none ${
          expanded
            ? 'w-7 rounded-full border-red-500/30 bg-red-950/55 hover:text-red-300'
            : 'w-11 rounded-full border-white/10 bg-slate-950/80 hover:text-slate-200'
        }`}
      >
        <ChevronRightIcon
          data-connection-fold-chevron="left"
          className={`h-4 w-4 transition-transform duration-200 ease-out ${
            expanded ? 'translate-x-1' : 'translate-x-0'
          }`}
        />
        <ChevronRightIcon
          data-connection-fold-chevron="right"
          className={`-ml-1 h-4 w-4 transition-transform duration-200 ease-out ${
            expanded ? '-translate-x-1 rotate-180' : 'translate-x-0 rotate-180'
          }`}
        />
      </button>
      <div className="flex min-w-0 items-center gap-2">
        <span className="connection-section-divider h-px min-w-0 flex-1 bg-slate-700" aria-hidden="true" />
        {hasOutputs && <span className="shrink-0 text-right">{t('Outputs')}</span>}
      </div>
    </div>
  );
}

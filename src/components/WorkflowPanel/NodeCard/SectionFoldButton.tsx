import { useT } from '@/i18n';
import { ChevronRightIcon } from '@/components/icons';

interface SectionFoldButtonProps {
  expanded: boolean;
  onToggle: () => void;
  /** Used in the aria-label, e.g. "parameters" → "Fold parameters". */
  label: string;
}

// The chevron pair fold control shared by node sections: a »« that animates
// into an X when expanded (click to re-fold) and a pill arrow when collapsed.
// Mirrors the connections section fold button.
export function SectionFoldButton({ expanded, onToggle, label }: SectionFoldButtonProps) {
  const t = useT();
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={expanded ? t('Fold {label}', { label }) : t('Unfold {label}', { label })}
      data-fold-state={expanded ? 'expanded' : 'collapsed'}
      onClick={onToggle}
      className={`flex h-7 items-center justify-center border text-slate-400 transition-[width,border-radius,background-color,border-color,color] duration-200 ease-out focus-visible:outline-none ${
        expanded
          ? 'w-7 rounded-full border-red-500/30 bg-red-950/55 hover:text-red-300'
          : 'w-11 rounded-full border-white/10 bg-slate-950/80 hover:text-slate-200'
      }`}
    >
      <ChevronRightIcon
        className={`h-4 w-4 transition-transform duration-200 ease-out ${
          expanded ? 'translate-x-1' : 'translate-x-0'
        }`}
      />
      <ChevronRightIcon
        className={`-ml-1 h-4 w-4 transition-transform duration-200 ease-out ${
          expanded ? '-translate-x-1 rotate-180' : 'translate-x-0 rotate-180'
        }`}
      />
    </button>
  );
}

import type { StatusFilterMode } from '@/hooks/useOutputs';
import { useI18n } from '@/i18n';

interface FavoritesSectionProps {
  favoritesMode: StatusFilterMode;
  rejectsMode: StatusFilterMode;
  onCycleFavorites: () => void;
  onCycleRejects: () => void;
  showRejects?: boolean;
}

const TONE_CLASSES = {
  cyan: {
    only: 'border-cyan-400/40 bg-cyan-500 text-slate-950',
    exclude: 'border-cyan-400/50 bg-cyan-500/10 text-cyan-300 line-through decoration-2',
    off: 'border-white/10 bg-slate-950/80 text-slate-200 hover:border-cyan-400/40 hover:text-cyan-300',
  },
  rose: {
    only: 'border-rose-400/40 bg-rose-500 text-slate-950',
    exclude: 'border-rose-400/50 bg-rose-500/10 text-rose-300 line-through decoration-2',
    off: 'border-white/10 bg-slate-950/80 text-slate-200 hover:border-rose-400/40 hover:text-rose-300',
  },
} as const;

function FilterToggle({
  id,
  mode,
  noun,
  onCycle,
  tone,
}: {
  id: string;
  mode: StatusFilterMode;
  noun: string;
  onCycle: () => void;
  tone: 'cyan' | 'rose';
}) {
  const { t } = useI18n();
  // The label states what the listing is doing right now, since a tri-state
  // button can't say it through pressed-ness alone. Struck-through styling
  // reinforces the excluded reading for anyone who skims rather than reads.
  const label = mode === 'only'
    ? t('{noun} only', { noun: t(noun) })
    : mode === 'exclude'
      ? t('No {noun}', { noun: t(noun).toLowerCase() })
      : t(noun);

  return (
    <button
      id={id}
      type="button"
      // aria-pressed is binary, so it only reports "is this filter doing
      // something"; the accessible name carries which of the two modes.
      aria-pressed={mode !== 'off'}
      data-status-mode={mode}
      onClick={onCycle}
      className={`status-filter-toggle w-full rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${TONE_CLASSES[tone][mode]}`}
    >
      {label}
    </button>
  );
}

export function FavoritesSection({
  favoritesMode,
  rejectsMode,
  onCycleFavorites,
  onCycleRejects,
  showRejects = true,
}: FavoritesSectionProps) {
  const { t } = useI18n();
  return (
    <div className={showRejects ? 'grid grid-cols-2 gap-2' : undefined}>
      <FilterToggle
        id="favorites-toggle-button"
        mode={favoritesMode}
        noun={t('Favorites')}
        onCycle={onCycleFavorites}
        tone="cyan"
      />
      {showRejects && (
        <FilterToggle
          id="rejects-toggle-button"
          mode={rejectsMode}
          noun={t('Rejects')}
          onCycle={onCycleRejects}
          tone="rose"
        />
      )}
    </div>
  );
}

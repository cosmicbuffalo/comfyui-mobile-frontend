interface FavoritesSectionProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function FavoritesSection({ checked, onChange }: FavoritesSectionProps) {
  return (
    <button
      id="favorites-toggle-button"
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={`w-full rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
        checked
          ? 'border-cyan-400/40 bg-cyan-500 text-slate-950'
          : 'border-white/10 bg-slate-950/80 text-slate-200 hover:border-cyan-400/40 hover:text-cyan-300'
      }`}
    >
      Show Favorites Only
    </button>
  );
}

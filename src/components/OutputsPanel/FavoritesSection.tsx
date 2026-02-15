interface FavoritesSectionProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function FavoritesSection({ checked, onChange }: FavoritesSectionProps) {
  return (
    <div id="favorites-toggle-container" className="flex items-center gap-2">
      <input
        type="checkbox"
        id="favOnly"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded text-blue-600 focus:ring-blue-500"
      />
      <label htmlFor="favOnly" className="text-sm text-gray-700">Show Favorites Only</label>
    </div>
  );
}

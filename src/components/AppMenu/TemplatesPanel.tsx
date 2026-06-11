import { useMemo, useState } from 'react';
import { TemplateIcon, BookmarkIconSvg, BookmarkOutlineIcon } from '@/components/icons';
import { SearchBar } from '@/components/SearchBar';
import { LoadingSpinner } from '../LoadingSpinner';
import { MenuSubPageHeader } from './MenuSubPageHeader';
import { MenuErrorNotice } from './MenuErrorNotice';
import type { WorkflowTemplates } from '@/api/client';
import { useTemplateFavoritesStore, templateFavoriteKey } from '@/hooks/useTemplateFavorites';
import {
  menuInputClassName,
  menuMutedTextClassName,
  menuSmallIconClassName,
  menuSurfaceClassName,
  menuTextClassName,
} from './menuStyles';

interface TemplatesPanelProps {
  error: string | null;
  loading: boolean;
  templates: WorkflowTemplates;
  onBack: () => void;
  onDismissError: () => void;
  onLoadTemplate: (moduleName: string, templateName: string) => void;
}

export function TemplatesPanel({
  error,
  loading,
  templates,
  onBack,
  onDismissError,
  onLoadTemplate,
}: TemplatesPanelProps) {
  const [search, setSearch] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const favorites = useTemplateFavoritesStore((s) => s.favorites);
  const toggleFavorite = useTemplateFavoritesStore((s) => s.toggleFavorite);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const templateEntries = Object.entries(templates);

  const query = search.toLowerCase();
  const filteredEntries = templateEntries
    .map(([moduleName, templateList]) => [
      moduleName,
      templateList.filter(
        (name) =>
          name.toLowerCase().includes(query) &&
          (!favoritesOnly || favoriteSet.has(templateFavoriteKey(moduleName, name))),
      ),
    ] as [string, string[]])
    .filter(([, list]) => list.length > 0);

  const hasTemplates = templateEntries.length > 0;

  return (
    <div className="flex flex-col h-full">
      <MenuSubPageHeader title="Templates" onBack={onBack} />
      <MenuErrorNotice error={error} onDismiss={onDismissError} />

      {!loading && hasTemplates && (
        <div className="flex items-stretch gap-2 py-2">
          <div className="flex-1">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search"
              inputClassName={menuInputClassName}
            />
          </div>
          <button
            type="button"
            onClick={() => setFavoritesOnly((v) => !v)}
            aria-pressed={favoritesOnly}
            aria-label={favoritesOnly ? 'Show all' : 'Show bookmarks only'}
            className={`w-9 self-stretch flex items-center justify-center rounded-lg transition-colors ${
              favoritesOnly
                ? 'bg-amber-500/20 text-amber-500'
                : 'bg-white/5 hover:bg-white/10 text-slate-300'
            }`}
          >
            {favoritesOnly ? (
              <BookmarkIconSvg className="w-5 h-5" />
            ) : (
              <BookmarkOutlineIcon className="w-5 h-5" />
            )}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner />
        </div>
      ) : !hasTemplates ? (
        <p className={`${menuMutedTextClassName} text-center py-8`}>No templates available</p>
      ) : filteredEntries.length === 0 ? (
        <p className={`${menuMutedTextClassName} text-center py-8`}>
          {favoritesOnly && !search.trim() ? 'No bookmarked templates' : 'No matching templates'}
        </p>
      ) : (
        <div className="space-y-4 overflow-y-auto flex-1">
          {filteredEntries.map(([moduleName, templateList]) => (
            <div key={moduleName}>
              <h4 className="text-sm font-semibold text-slate-400 mb-2">
                {moduleName}
              </h4>
              <div className="space-y-2">
                {templateList.map((templateName) => {
                  const favKey = templateFavoriteKey(moduleName, templateName);
                  const isBookmarked = favoriteSet.has(favKey);
                  return (
                    <div
                      key={favKey}
                      className={`${menuSurfaceClassName} flex items-center overflow-hidden`}
                    >
                      <button
                        onClick={() => onLoadTemplate(moduleName, templateName)}
                        className="flex items-center gap-3 px-4 py-2 text-left flex-1 min-w-0 min-h-[56px] hover:bg-slate-800/95"
                      >
                        <TemplateIcon className={`${menuSmallIconClassName} shrink-0`} />
                        <span className={`${menuTextClassName} truncate`}>
                          {templateName.replace(/\.json$/, '')}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleFavorite(favKey)}
                        aria-pressed={isBookmarked}
                        aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
                        className={`w-9 h-9 mr-2 flex items-center justify-center rounded-lg shrink-0 transition-colors hover:bg-white/10 ${
                          isBookmarked ? 'text-amber-500' : 'text-slate-400'
                        }`}
                      >
                        {isBookmarked ? (
                          <BookmarkIconSvg className="w-5 h-5" />
                        ) : (
                          <BookmarkOutlineIcon className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

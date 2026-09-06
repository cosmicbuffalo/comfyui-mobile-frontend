import { useMemo, useState } from 'react';
import {
  TemplateIcon,
  BookmarkIconSvg,
  BookmarkOutlineIcon,
  ChevronDownIcon,
  FunnelIcon,
  SpeakerWaveIcon,
} from '@/components/icons';
import { SearchBar } from '@/components/SearchBar';
import { LoadingSpinner } from '../LoadingSpinner';
import { MenuSubPageHeader } from './MenuSubPageHeader';
import { MenuErrorNotice } from './MenuErrorNotice';
import {
  getTemplateThumbnailUrl,
  type CoreTemplateCategory,
  type WorkflowTemplates,
} from '@/api/client';
import { useTemplateFavoritesStore } from '@/hooks/useTemplateFavorites';
import { useI18n } from '@/i18n';
import {
  ALL_TEMPLATES_FILTER,
  EXTENSION_TEMPLATES_FILTER,
  buildTemplateCatalog,
  filterTemplateSections,
  type TemplateCatalogItem,
} from './templateCatalog';
import {
  menuInputClassName,
  menuMutedTextClassName,
  menuSurfaceClassName,
  menuTextClassName,
} from './menuStyles';

interface TemplatesPanelProps {
  error: string | null;
  loading: boolean;
  /** Custom-node example workflows, from /api/workflow_templates. */
  templates: WorkflowTemplates;
  /** The core catalog, from /templates/index.json. */
  coreTemplates: CoreTemplateCategory[];
  onBack: () => void;
  onDismissError: () => void;
  onLoadTemplate: (moduleName: string, templateName: string, title?: string) => void;
}

/** Bound the first render of the full catalog; later batches are user-driven. */
const TEMPLATE_PAGE_SIZE = 40;

/**
 * Template preview image. Core templates ship a still; a custom node's example
 * workflow only has one if the pack dropped a matching .jpg beside it, so a
 * failed load falls back to the generic icon rather than a broken image.
 */
function TemplateThumbnail({ item, apiLabel }: { item: TemplateCatalogItem; apiLabel: string }) {
  const [failed, setFailed] = useState(false);
  const src = getTemplateThumbnailUrl(item.moduleName, item);
  const isAudio = item.mediaType === 'audio' || item.mediaSubtype === 'mp3';

  return (
    <span className="relative w-28 h-16 shrink-0">
      {!src || failed ? (
        <span className="template-card-thumb absolute inset-0 rounded-lg bg-slate-950/60 border border-white/5 flex items-center justify-center">
          {isAudio ? (
            <SpeakerWaveIcon className="w-5 h-5 text-slate-500" />
          ) : (
            <TemplateIcon className="w-5 h-5 text-slate-500" />
          )}
        </span>
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="template-card-thumb absolute inset-0 w-full h-full rounded-lg object-cover bg-slate-950/60 border border-white/5"
        />
      )}
      {item.isApi && (
        <span className="template-card-api-badge absolute bottom-1 left-1 px-1.5 py-px rounded text-[10px] font-semibold uppercase tracking-wide bg-violet-500/80 text-white">
          {apiLabel}
        </span>
      )}
    </span>
  );
}

export function TemplatesPanel({
  error,
  loading,
  templates,
  coreTemplates,
  onBack,
  onDismissError,
  onLoadTemplate,
}: TemplatesPanelProps) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [filterKey, setFilterKey] = useState<string>(ALL_TEMPLATES_FILTER);
  const [visibleCount, setVisibleCount] = useState(TEMPLATE_PAGE_SIZE);
  const favorites = useTemplateFavoritesStore((s) => s.favorites);
  const toggleFavorite = useTemplateFavoritesStore((s) => s.toggleFavorite);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const { sections, filters } = useMemo(
    () => buildTemplateCatalog(coreTemplates, templates),
    [coreTemplates, templates],
  );

  // A category can disappear between fetches (a pack uninstalled, a catalog
  // that failed to load); fall back to "all" rather than showing an empty panel.
  const activeFilter = filters.some((item) => item.key === filterKey)
    ? filterKey
    : ALL_TEMPLATES_FILTER;

  const filteredSections = useMemo(
    () =>
      filterTemplateSections(sections, {
        filterKey: activeFilter,
        query: search,
        favoritesOnly,
        favorites: favoriteSet,
      }),
    [sections, activeFilter, search, favoritesOnly, favoriteSet],
  );
  const totalFilteredCount = useMemo(
    () => filteredSections.reduce((total, section) => total + section.items.length, 0),
    [filteredSections],
  );
  const visibleSections = useMemo(() => {
    return filteredSections.flatMap((section, sectionIndex) => {
      const precedingCount = filteredSections
        .slice(0, sectionIndex)
        .reduce((total, entry) => total + entry.items.length, 0);
      const remaining = Math.max(0, visibleCount - precedingCount);

      if (remaining === 0) return [];

      return [{ ...section, items: section.items.slice(0, remaining) }];
    });
  }, [filteredSections, visibleCount]);
  const hiddenCount = Math.max(0, totalFilteredCount - visibleCount);

  const hasTemplates = sections.length > 0;

  const filterLabel = (key: string, label: string) => {
    if (key === ALL_TEMPLATES_FILTER) return t('All');
    if (key === EXTENSION_TEMPLATES_FILTER) return t('Custom nodes');
    return label;
  };

  return (
    <div className="flex flex-col h-full">
      <MenuSubPageHeader title={t('Templates')} onBack={onBack} />
      <MenuErrorNotice error={error} onDismiss={onDismissError} />

      {!loading && hasTemplates && (
        <>
          <div className="flex items-stretch gap-2 py-2">
            <div className="flex-1">
              <SearchBar
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setVisibleCount(TEMPLATE_PAGE_SIZE);
                  // Search spans the whole catalog, so a match is never hidden
                  // behind the category the user happened to be browsing.
                  if (value.trim()) setFilterKey(ALL_TEMPLATES_FILTER);
                }}
                placeholder={t('Search')}
                inputClassName={menuInputClassName}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setFavoritesOnly((v) => !v);
                setVisibleCount(TEMPLATE_PAGE_SIZE);
              }}
              aria-pressed={favoritesOnly}
              aria-label={favoritesOnly ? t('Show all') : t('Show bookmarks only')}
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

          <div className="pb-2">
            <label className="template-category-filter relative block h-10">
              <FunnelIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <select
                value={activeFilter}
                aria-label={t('Filter templates')}
                onChange={(event) => {
                  setFilterKey(event.target.value);
                  setVisibleCount(TEMPLATE_PAGE_SIZE);
                }}
                className="w-full h-10 appearance-none rounded-lg border border-white/10 bg-slate-950/80 pl-9 pr-9 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
              >
                {filters.map((item) => (
                  <option key={item.key} value={item.key}>
                    {`${filterLabel(item.key, item.label)} (${item.count})`}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </label>
          </div>
        </>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner />
        </div>
      ) : !hasTemplates ? (
        <p className={`${menuMutedTextClassName} text-center py-8`}>{t('No templates available')}</p>
      ) : filteredSections.length === 0 ? (
        <p className={`${menuMutedTextClassName} text-center py-8`}>
          {favoritesOnly && !search.trim() ? t('No bookmarked templates') : t('No matching templates')}
        </p>
      ) : (
        <div className="space-y-4 overflow-y-auto flex-1">
          {visibleSections.map((section) => (
            <div key={section.key}>
              <h4 className="text-sm font-semibold text-slate-400 mb-2">{section.title}</h4>
              <div className="space-y-2">
                {section.items.map((item) => {
                  const isBookmarked = favoriteSet.has(item.favoriteKey);
                  return (
                    <div
                      key={item.favoriteKey}
                      className={`template-card ${menuSurfaceClassName} flex items-center overflow-hidden`}
                    >
                      <button
                        onClick={() => onLoadTemplate(item.moduleName, item.name, item.title)}
                        className="flex items-center gap-3 p-2 text-left flex-1 min-w-0 hover:bg-slate-800/95"
                      >
                        <TemplateThumbnail item={item} apiLabel={t('API')} />
                        <span className="flex flex-col min-w-0 gap-0.5">
                          <span className={`${menuTextClassName} text-sm leading-snug line-clamp-2`}>
                            {item.title}
                          </span>
                          {item.description && (
                            <span className="template-card-description text-xs text-slate-400 leading-snug line-clamp-2">
                              {item.description}
                            </span>
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleFavorite(item.favoriteKey)}
                        aria-pressed={isBookmarked}
                        aria-label={isBookmarked ? t('Remove bookmark') : t('Bookmark')}
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
          {hiddenCount > 0 && (
            <button
              type="button"
              className="template-load-more w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 hover:bg-white/10"
              onClick={() => setVisibleCount((count) => count + TEMPLATE_PAGE_SIZE)}
            >
              {t('+{count} more', { count: Math.min(TEMPLATE_PAGE_SIZE, hiddenCount) })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

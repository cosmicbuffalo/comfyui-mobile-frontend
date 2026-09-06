import {
  CORE_TEMPLATE_MODULE,
  type CoreTemplateCategory,
  type WorkflowTemplates,
} from '@/api/client';
import { templateFavoriteKey } from '@/hooks/useTemplateFavorites';

/**
 * One browsable template, flattened from either source (the core catalog's
 * `index.json` or a custom node's example-workflow folder) into the single
 * shape the panel renders.
 */
export interface TemplateCatalogItem {
  moduleName: string;
  /** File stem — what the loader asks the server for. */
  name: string;
  /** Display name: the catalog title where there is one, else the file stem. */
  title: string;
  description?: string;
  mediaType?: string;
  mediaSubtype?: string;
  tags: string[];
  /** Cloud API templates need ComfyUI API credits, so they're marked. */
  isApi: boolean;
  favoriteKey: string;
  searchText: string;
}

export interface TemplateCatalogSection {
  /** Section identity, also the key of the filter that reveals it. */
  key: string;
  filterKey: string;
  title: string;
  items: TemplateCatalogItem[];
}

/** One entry of the category dropdown. */
export interface TemplateCatalogFilter {
  key: string;
  label: string;
  count: number;
}

/** Filter key for "everything", and for the custom-node example workflows. */
export const ALL_TEMPLATES_FILTER = 'all';
export const EXTENSION_TEMPLATES_FILTER = 'extensions';

const API_TAG = 'API';

function coreItem(
  template: CoreTemplateCategory['templates'][number],
  moduleName: string,
  categoryTitle: string,
): TemplateCatalogItem {
  const tags = Array.isArray(template.tags) ? template.tags : [];
  const models = Array.isArray(template.models) ? template.models : [];
  const title = template.title?.trim() || template.name;
  return {
    moduleName,
    name: template.name,
    title,
    description: template.description?.trim() || undefined,
    mediaType: template.mediaType,
    mediaSubtype: template.mediaSubtype,
    tags,
    isApi: tags.includes(API_TAG),
    favoriteKey: templateFavoriteKey(moduleName, template.name),
    searchText: [title, template.name, template.description ?? '', categoryTitle, ...tags, ...models]
      .join(' ')
      .toLowerCase(),
  };
}

function extensionItem(moduleName: string, name: string): TemplateCatalogItem {
  const title = name.replace(/\.json$/, '');
  return {
    moduleName,
    name,
    title,
    tags: [],
    isApi: false,
    favoriteKey: templateFavoriteKey(moduleName, name),
    searchText: `${title} ${moduleName}`.toLowerCase(),
  };
}

/**
 * Merge the two template sources into ordered sections plus the dropdown
 * entries that filter them. Core categories keep the catalog's own order (which
 * is the order the desktop frontend shows them in); custom-node modules follow,
 * all under one entry since an install can easily have dozens of them.
 */
export function buildTemplateCatalog(
  coreTemplates: CoreTemplateCategory[],
  extensionTemplates: WorkflowTemplates,
): { sections: TemplateCatalogSection[]; filters: TemplateCatalogFilter[] } {
  const sections: TemplateCatalogSection[] = [];
  const filters: TemplateCatalogFilter[] = [];

  coreTemplates.forEach((category, index) => {
    const moduleName = category.moduleName || CORE_TEMPLATE_MODULE;
    const items = (category.templates ?? [])
      .filter((template) => typeof template?.name === 'string' && template.name.length > 0)
      .map((template) => coreItem(template, moduleName, category.title));
    if (items.length === 0) return;
    // Titles are localized and could collide; the index keeps them unique.
    const key = `core:${index}:${category.title}`;
    sections.push({ key, filterKey: key, title: category.title, items });
    filters.push({ key, label: category.title, count: items.length });
  });

  let extensionCount = 0;
  for (const [moduleName, templateNames] of Object.entries(extensionTemplates)) {
    const items = (templateNames ?? []).map((name) => extensionItem(moduleName, name));
    if (items.length === 0) continue;
    extensionCount += items.length;
    sections.push({
      key: `extension:${moduleName}`,
      filterKey: EXTENSION_TEMPLATES_FILTER,
      title: moduleName,
      items,
    });
  }
  if (extensionCount > 0) {
    filters.push({ key: EXTENSION_TEMPLATES_FILTER, label: '', count: extensionCount });
  }

  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  if (total > 0) {
    filters.unshift({ key: ALL_TEMPLATES_FILTER, label: '', count: total });
  }

  return { sections, filters };
}

export interface TemplateFilter {
  filterKey: string;
  query: string;
  favoritesOnly: boolean;
  favorites: ReadonlySet<string>;
}

/**
 * Sections narrowed to what the current category, search text and bookmark
 * toggle allow. A search spans every category — the caller resets the category
 * to "all" when the query changes, so a match is never hidden behind it.
 */
export function filterTemplateSections(
  sections: TemplateCatalogSection[],
  { filterKey, query, favoritesOnly, favorites }: TemplateFilter,
): TemplateCatalogSection[] {
  const needle = query.trim().toLowerCase();
  return sections
    .filter((section) => filterKey === ALL_TEMPLATES_FILTER || section.filterKey === filterKey)
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          (!needle || item.searchText.includes(needle)) &&
          (!favoritesOnly || favorites.has(item.favoriteKey)),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

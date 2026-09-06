import { describe, expect, it } from 'vitest';
import type { CoreTemplateCategory } from '@/api/client';
import {
  ALL_TEMPLATES_FILTER,
  EXTENSION_TEMPLATES_FILTER,
  buildTemplateCatalog,
  filterTemplateSections,
} from '../templateCatalog';

const coreTemplates: CoreTemplateCategory[] = [
  {
    moduleName: 'default',
    title: 'Image',
    templates: [
      {
        name: 'image_flux_dev',
        title: 'Flux Dev',
        description: 'Text to image with Flux.',
        mediaType: 'image',
        mediaSubtype: 'webp',
        tags: ['Image', 'Text to Image'],
        models: ['flux'],
      },
      {
        name: 'api_nano_banana',
        title: 'Nano Banana',
        mediaSubtype: 'webp',
        tags: ['API', 'Image Edit'],
      },
    ],
  },
  {
    moduleName: 'default',
    title: 'Audio',
    templates: [{ name: 'audio_ace', title: 'ACE Step', mediaType: 'audio', mediaSubtype: 'mp3' }],
  },
];

const extensionTemplates = { 'some-pack': ['pack_example'] };

describe('buildTemplateCatalog', () => {
  it('keeps core categories in catalog order and groups extensions under one filter', () => {
    const { sections, filters } = buildTemplateCatalog(coreTemplates, extensionTemplates);

    expect(sections.map((section) => section.title)).toEqual(['Image', 'Audio', 'some-pack']);
    expect(sections[2].filterKey).toBe(EXTENSION_TEMPLATES_FILTER);
    expect(filters.map((item) => item.key)[0]).toBe(ALL_TEMPLATES_FILTER);
    expect(filters.map((item) => item.count)).toEqual([4, 2, 1, 1]);
  });

  it('marks API templates and carries titles, descriptions and media info', () => {
    const { sections } = buildTemplateCatalog(coreTemplates, extensionTemplates);
    const [flux, nano] = sections[0].items;

    expect(flux.title).toBe('Flux Dev');
    expect(flux.description).toBe('Text to image with Flux.');
    expect(flux.mediaSubtype).toBe('webp');
    expect(flux.isApi).toBe(false);
    expect(nano.isApi).toBe(true);
  });

  it('falls back to the file name for a template with no title', () => {
    const { sections } = buildTemplateCatalog(
      [{ moduleName: 'default', title: 'Misc', templates: [{ name: 'bare_template' }] }],
      {},
    );
    expect(sections[0].items[0].title).toBe('bare_template');
  });

  it('names an extension template by its file stem and keys favorites by module', () => {
    const { sections } = buildTemplateCatalog([], extensionTemplates);
    const item = sections[0].items[0];

    expect(item.title).toBe('pack_example');
    expect(item.favoriteKey).toBe('some-pack/pack_example');
  });

  it('omits empty categories and produces no filters for an empty catalog', () => {
    const { sections, filters } = buildTemplateCatalog(
      [{ moduleName: 'default', title: 'Empty', templates: [] }],
      {},
    );
    expect(sections).toEqual([]);
    expect(filters).toEqual([]);
  });
});

describe('filterTemplateSections', () => {
  const { sections } = buildTemplateCatalog(coreTemplates, extensionTemplates);
  const noFavorites = { favoritesOnly: false, favorites: new Set<string>() };

  it('narrows to the selected category', () => {
    const filtered = filterTemplateSections(sections, {
      filterKey: EXTENSION_TEMPLATES_FILTER,
      query: '',
      ...noFavorites,
    });
    expect(filtered.map((section) => section.title)).toEqual(['some-pack']);
  });

  it('searches titles, descriptions, tags and models across categories', () => {
    const byModel = filterTemplateSections(sections, {
      filterKey: ALL_TEMPLATES_FILTER,
      query: 'flux',
      ...noFavorites,
    });
    expect(byModel.flatMap((section) => section.items.map((item) => item.name)))
      .toEqual(['image_flux_dev']);

    const byTag = filterTemplateSections(sections, {
      filterKey: ALL_TEMPLATES_FILTER,
      query: 'image edit',
      ...noFavorites,
    });
    expect(byTag.flatMap((section) => section.items.map((item) => item.name)))
      .toEqual(['api_nano_banana']);
  });

  it('keeps only bookmarked templates when the bookmark filter is on', () => {
    const filtered = filterTemplateSections(sections, {
      filterKey: ALL_TEMPLATES_FILTER,
      query: '',
      favoritesOnly: true,
      favorites: new Set(['default/audio_ace']),
    });
    expect(filtered.map((section) => section.title)).toEqual(['Audio']);
  });
});

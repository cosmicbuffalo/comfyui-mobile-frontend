import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreTemplateCategory } from '@/api/client';
import { TemplatesPanel } from '../TemplatesPanel';
import { useTemplateFavoritesStore } from '@/hooks/useTemplateFavorites';

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
        tags: ['Image'],
      },
      { name: 'api_nano_banana', title: 'Nano Banana', mediaSubtype: 'webp', tags: ['API'] },
    ],
  },
  {
    moduleName: 'default',
    title: 'Audio',
    templates: [{ name: 'audio_ace', title: 'ACE Step', mediaType: 'audio', mediaSubtype: 'mp3' }],
  },
];

const extensionTemplates = { 'some-pack': ['pack_example'] };

async function renderPanel(
  root: Root,
  overrides: Partial<Parameters<typeof TemplatesPanel>[0]> = {},
) {
  const props = {
    error: null,
    loading: false,
    templates: extensionTemplates,
    coreTemplates,
    onBack: vi.fn(),
    onDismissError: vi.fn(),
    onLoadTemplate: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    root.render(<TemplatesPanel {...props} />);
  });
  return props;
}

/** Pick a dropdown entry by its visible label and fire the change React needs. */
function selectCategory(select: HTMLSelectElement, label: string): void {
  const option = Array.from(select.options).find((item) => item.textContent === label);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    'value',
  )?.set;
  setter?.call(select, option!.value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function cardTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.template-card')).map(
    (card) => card.querySelector('button')?.textContent?.trim() ?? '',
  );
}

describe('TemplatesPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useTemplateFavoritesStore.setState({ favorites: [] });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('lists core categories and custom node packs together', async () => {
    await renderPanel(root);

    const headings = Array.from(container.querySelectorAll('h4')).map((h) => h.textContent);
    expect(headings).toEqual(['Image', 'Audio', 'some-pack']);
    expect(container.querySelectorAll('.template-card')).toHaveLength(4);
  });

  it('shows the catalog title, description and thumbnail for a core template', async () => {
    await renderPanel(root);

    const [first] = Array.from(container.querySelectorAll('.template-card'));
    expect(first.textContent).toContain('Flux Dev');
    expect(first.querySelector('.template-card-description')?.textContent)
      .toBe('Text to image with Flux.');
    expect(first.querySelector<HTMLImageElement>('img.template-card-thumb')?.getAttribute('src'))
      .toBe('/templates/image_flux_dev-1.webp');
  });

  it('marks API templates and gives an audio template a placeholder instead of an image', async () => {
    await renderPanel(root);

    const cards = Array.from(container.querySelectorAll('.template-card'));
    expect(cards[1].querySelector('.template-card-api-badge')?.textContent).toBe('API');
    expect(cards[0].querySelector('.template-card-api-badge')).toBeNull();
    // audio_ace: the "thumbnail" the catalog ships is an mp3, so nothing to show.
    expect(cards[2].querySelector('img.template-card-thumb')).toBeNull();
    expect(cards[2].querySelector('span.template-card-thumb')).not.toBeNull();
  });

  it('filters to one category when it is picked from the dropdown', async () => {
    await renderPanel(root);

    const select = container.querySelector<HTMLSelectElement>('.template-category-filter select');
    expect(Array.from(select!.options).map((option) => option.textContent)).toEqual([
      'All (4)',
      'Image (2)',
      'Audio (1)',
      'Custom nodes (1)',
    ]);

    await act(async () => {
      selectCategory(select!, 'Audio (1)');
    });

    expect(Array.from(container.querySelectorAll('h4')).map((h) => h.textContent)).toEqual(['Audio']);
  });

  it('searches the whole catalog even while a category is selected', async () => {
    await renderPanel(root);

    const select = container.querySelector<HTMLSelectElement>('.template-category-filter select');
    await act(async () => {
      selectCategory(select!, 'Audio (1)');
    });

    const input = container.querySelector<HTMLInputElement>('input[placeholder="Search"]');
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(input, 'flux');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(cardTitles(container).join(' ')).toContain('Flux Dev');
  });

  it('loads a core template by module, file name and title', async () => {
    const props = await renderPanel(root);

    const loadButton = container.querySelector<HTMLButtonElement>('.template-card button');
    await act(async () => {
      loadButton?.click();
    });

    expect(props.onLoadTemplate).toHaveBeenCalledWith('default', 'image_flux_dev', 'Flux Dev');
  });

  it('keeps bookmarks keyed by module so both sources can be bookmarked', async () => {
    await renderPanel(root);

    const cards = Array.from(container.querySelectorAll('.template-card'));
    const bookmark = cards[3].querySelectorAll('button')[1];
    await act(async () => {
      bookmark.click();
    });

    expect(useTemplateFavoritesStore.getState().favorites).toEqual(['some-pack/pack_example']);
  });

  it('renders the catalog in bounded batches and resets the batch for a filter', async () => {
    const manyTemplates: CoreTemplateCategory[] = [
      {
        moduleName: 'default',
        title: 'Image',
        templates: Array.from({ length: 60 }, (_, index) => ({
          name: `image_${index}`,
          title: `Image ${index}`,
        })),
      },
      {
        moduleName: 'default',
        title: 'Video',
        templates: Array.from({ length: 45 }, (_, index) => ({
          name: `video_${index}`,
          title: `Video ${index}`,
        })),
      },
    ];
    await renderPanel(root, { coreTemplates: manyTemplates, templates: {} });

    expect(container.querySelectorAll('.template-card')).toHaveLength(40);
    const loadMore = container.querySelector<HTMLButtonElement>('.template-load-more');
    expect(loadMore?.textContent).toContain('40');

    await act(async () => loadMore?.click());
    expect(container.querySelectorAll('.template-card')).toHaveLength(80);

    const select = container.querySelector<HTMLSelectElement>('.template-category-filter select');
    await act(async () => selectCategory(select!, 'Video (45)'));
    expect(container.querySelectorAll('.template-card')).toHaveLength(40);
    expect(container.querySelector('.template-load-more')?.textContent).toContain('5');
  });
});

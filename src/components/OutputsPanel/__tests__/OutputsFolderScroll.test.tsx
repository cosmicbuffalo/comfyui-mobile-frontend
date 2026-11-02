import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputsPanel } from '@/components/OutputsPanel';
import { useOutputsStore } from '@/hooks/useOutputs';
import { getUserImages, type FileItem } from '@/api/client';

vi.mock('@/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  getUserImages: vi.fn(),
  loadFileState: vi.fn(async () => ({ favorite: [], reject: [], hidden: [] })),
}));

vi.mock('../FilesSection', () => ({
  OutputsFilesSection: ({ fileSections, maxRenderedFiles }: {
    fileSections: { files: FileItem[] }[];
    maxRenderedFiles: number;
  }) => (
    <div role="list" aria-label="Outputs files">
      {fileSections.flatMap(section => section.files).slice(0, maxRenderedFiles).map(file => (
        <div role="listitem" key={file.id}>{file.name}</div>
      ))}
    </div>
  ),
}));

const listing = (folder: string | null): FileItem[] => Array.from({ length: 180 }, (_, i) => ({
  id: `output/${folder ? `${folder}/` : ''}${i}.png`,
  name: `${i}.png`,
  type: 'image',
}));

describe('Outputs folder scroll', () => {
  let container: HTMLDivElement;
  let root: Root;
  let scroller: HTMLElement;
  let resolveListing: (files: FileItem[]) => void;

  beforeEach(async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, media: query, addEventListener() {}, removeEventListener() {},
    }));
    vi.mocked(getUserImages).mockImplementation(() => new Promise(resolve => { resolveListing = resolve; }));
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
      const top = options.top ?? 0;
      this.scrollTop = Math.min(top, Math.max(0, this.scrollHeight - this.clientHeight));
    }) });
    useOutputsStore.setState({
      source: 'output', currentFolder: 'A', files: [], isLoading: false,
      promptSearchActive: false, promptSearchResults: [],
      filter: { search: '', favoritesMode: 'off', rejectsMode: 'off', type: 'all' },
      sort: { mode: 'name' }, selectionMode: false,
      tabs: [{ id: 'scroll-test', source: 'output', folder: 'A' }], activeTabId: 'scroll-test',
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<OutputsPanel visible />));
    await act(async () => resolveListing(listing('A')));
    scroller = container.querySelector('[role="list"][aria-label="Outputs files"]')!.parentElement!;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, get: () => scroller.querySelectorAll('[role="listitem"]').length * 20 },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const scroll = async (top: number) => {
    await act(async () => {
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
  };
  const finishLoad = async (folder: string | null) => {
    await act(async () => resolveListing(listing(folder)));
  };

  it('restores each ancestor after its async listing and enough file batches render', async () => {
    // A position beyond the first 60-card page must survive the loading screen.
    await scroll(2200);
    await act(async () => useOutputsStore.getState().setCurrentFolder('B'));
    expect(scroller.scrollTop).toBe(0);
    await finishLoad('A/B');
    expect(scroller.scrollTop).toBe(0);
    await scroll(900);
    await act(async () => useOutputsStore.getState().setCurrentFolder('C'));
    await finishLoad('A/B/C');
    expect(scroller.scrollTop).toBe(0);
    await scroll(300);

    await act(async () => useOutputsStore.getState().navigateUp());
    expect(scroller.querySelector('[role="list"]')).toBeNull();
    expect(scroller.scrollTop).toBe(0);
    await finishLoad('A/B');
    expect(scroller.scrollTop).toBe(900);

    await act(async () => useOutputsStore.getState().navigateToPath('A'));
    await finishLoad('A');
    expect(scroller.scrollTop).toBe(2200);

    // Revisiting a child is still an entry, even when it has a saved position.
    await act(async () => useOutputsStore.getState().setCurrentFolder('B'));
    await finishLoad('A/B');
    expect(scroller.scrollTop).toBe(0);
  });

  it('restores the source root when exiting its child folder', async () => {
    await act(async () => useOutputsStore.getState().navigateUp());
    await finishLoad(null);
    await scroll(700);
    await act(async () => useOutputsStore.getState().setCurrentFolder('A'));
    await finishLoad('A');
    expect(scroller.scrollTop).toBe(0);
    await act(async () => useOutputsStore.getState().navigateUp());
    await finishLoad(null);
    expect(scroller.scrollTop).toBe(700);
  });
});

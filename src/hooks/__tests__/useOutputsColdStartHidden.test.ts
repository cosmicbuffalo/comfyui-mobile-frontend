import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    getUserImages: vi.fn(async () => []),
    getUserImageFolders: vi.fn(async () => ({ input: [], output: [] })),
    loadFileState: vi.fn(async () => ({ favorite: [], reject: [], hidden: [] })),
    setFileState: vi.fn(async () => undefined),
  };
});

/**
 * The one case `syncShowHidden` cannot see.
 *
 * It fires when the preference CHANGES; after a reload it has not changed — it
 * was already off, restored from localStorage along with the browse location,
 * which may well be the hidden folder the app was closed inside. The store
 * therefore applies the same correction once at module scope, which is what
 * these tests exercise by seeding storage and importing it fresh.
 */
function seed(outputs: Record<string, unknown>, showHidden: boolean) {
  localStorage.setItem(
    'outputs-storage',
    JSON.stringify({ state: outputs, version: 7 }),
  );
  localStorage.setItem(
    'show-hidden-storage',
    JSON.stringify({ state: { showHidden, autoHideMinutes: 5, backgroundedAt: null }, version: 0 }),
  );
}

async function loadStore() {
  vi.resetModules();
  const module = await import('../useOutputs');
  return module.useOutputsStore.getState();
}

describe('a restored browse location is checked before anything renders', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('climbs out of a marked folder it was closed inside', async () => {
    // Only knowable because the paths were persisted alongside the location:
    // a marked folder has an ordinary name, so a cold start had nothing to
    // read it from and left the panel showing its contents.
    seed(
      {
        source: 'output',
        currentFolder: 'album/personal/raw',
        hiddenFolderPaths: ['album/personal'],
        tabs: [{ id: 'a', source: 'output', folder: 'album/personal/raw' }],
        activeTabId: 'a',
        folderBySource: { output: 'album/personal/raw', input: null, temp: null },
      },
      false,
    );

    const state = await loadStore();

    expect(state.currentFolder).toBe('album');
    expect(state.tabs[0].folder).toBe('album');
    expect(state.folderBySource.output).toBe('album');
  });

  it('leaves the location alone when hidden files are on', async () => {
    seed(
      {
        source: 'output',
        currentFolder: 'album/personal/raw',
        hiddenFolderPaths: ['album/personal'],
        tabs: [{ id: 'a', source: 'output', folder: 'album/personal/raw' }],
        activeTabId: 'a',
        folderBySource: { output: null, input: null, temp: null },
      },
      true,
    );

    const state = await loadStore();

    expect(state.currentFolder).toBe('album/personal/raw');
  });

  it('carries the marks across the reload, which is what makes the rest possible', async () => {
    // A round trip, not a seeded blob: `partialize` decides what is written,
    // and a mark that is not written cannot be read back — leaving a cold
    // start with no way to recognise an ordinary-looking hidden folder.
    seed(
      {
        source: 'output',
        currentFolder: null,
        tabs: [{ id: 'a', source: 'output', folder: null }],
        activeTabId: 'a',
        folderBySource: { output: null, input: null, temp: null },
      },
      true,
    );

    vi.resetModules();
    const live = await import('../useOutputs');
    live.useOutputsStore.setState({
      currentFolder: 'album/personal/raw',
      hiddenFolderPaths: ['album/personal'],
      tabs: [{ id: 'a', source: 'output', folder: 'album/personal/raw' }],
    });
    expect(
      JSON.parse(localStorage.getItem('outputs-storage') ?? '{}').state.hiddenFolderPaths,
    ).toEqual(['album/personal']);

    // Now the app is closed and reopened with the wait having run out.
    localStorage.setItem(
      'show-hidden-storage',
      JSON.stringify({
        state: { showHidden: false, autoHideMinutes: 5, backgroundedAt: null },
        version: 0,
      }),
    );

    const state = await loadStore();

    expect(state.currentFolder).toBe('album');
  });

  it('restores an ordinary location untouched', async () => {
    seed(
      {
        source: 'output',
        currentFolder: 'album/raw',
        hiddenFolderPaths: [],
        tabs: [{ id: 'a', source: 'output', folder: 'album/raw' }],
        activeTabId: 'a',
        folderBySource: { output: null, input: null, temp: null },
      },
      false,
    );

    const state = await loadStore();

    expect(state.currentFolder).toBe('album/raw');
  });
});

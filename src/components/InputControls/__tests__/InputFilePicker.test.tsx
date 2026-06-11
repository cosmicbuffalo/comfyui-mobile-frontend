import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    getUserImages: vi.fn(async () => []),
    searchUserImagesByPrompt: vi.fn(async () => []),
    copyFileToInput: vi.fn(async () => ({ name: 'foo.png', subfolder: '', type: 'input' })),
    uploadImageFile: vi.fn(async () => ({ name: 'foo.png', subfolder: '', type: 'input' })),
  };
});

import { getUserImages, copyFileToInput, uploadImageFile, type FileItem } from '@/api/client';
import { useOutputsStore } from '@/hooks/useOutputs';
import { InputFilePicker } from '../InputFilePicker';

const getUserImagesMock = vi.mocked(getUserImages);
const copyFileToInputMock = vi.mocked(copyFileToInput);
const uploadImageFileMock = vi.mocked(uploadImageFile);

// Flush microtasks + the React effect/render queue until `predicate` holds (or
// we give up). The picker loads files via an effect that calls an async client
// fn then setState, so a single microtask tick isn't enough to settle it.
async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !predicate(); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('InputFilePicker options menu', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('stacks the options menu above sticky folder and date headers', async () => {
    await act(async () => {
      root.render(<InputFilePicker open onClose={() => {}} onPick={() => {}} />);
    });

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Input picker options"]')
        ?.click();
    });

    const toolbar = document.querySelector('.input-picker-toolbar');
    const menu = document.querySelector('.input-picker-menu');

    expect(toolbar?.classList.contains('z-30')).toBe(true);
    expect(menu?.classList.contains('z-40')).toBe(true);
  });

  it('switches to the outputs source when the Outputs tab is selected', async () => {
    await act(async () => {
      root.render(<InputFilePicker open onClose={() => {}} onPick={() => {}} />);
    });
    getUserImagesMock.mockClear();

    const outputsTab = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.input-picker-source-toggle button'),
    ).find((button) => button.textContent === 'Outputs');
    expect(outputsTab).toBeTruthy();

    await act(async () => {
      outputsTab?.click();
    });
    await flushUntil(() =>
      getUserImagesMock.mock.calls.some((call) => call[0] === 'output'),
    );

    expect(getUserImagesMock).toHaveBeenCalled();
    expect(getUserImagesMock.mock.calls.at(-1)?.[0]).toBe('output');
  });

  it('copies a picked output file server-side instead of downloading + re-uploading', async () => {
    const file: FileItem = {
      id: 'output/foo.png',
      name: 'foo.png',
      type: 'image',
      fullUrl: '/view?filename=foo.png&type=output',
    };
    const prevGetUserImages = getUserImagesMock.getMockImplementation();
    getUserImagesMock.mockResolvedValue([file]);
    copyFileToInputMock.mockReset();
    copyFileToInputMock.mockResolvedValue({ name: 'foo.png', subfolder: '', type: 'input' });
    uploadImageFileMock.mockReset();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const onPick = vi.fn();

    // Open directly on the Outputs tab so picking goes through the output-copy path.
    await act(async () => {
      root.render(
        <InputFilePicker open defaultSource="output" onClose={() => {}} onPick={onPick} />,
      );
    });

    // Wait for getUserImages('output') to resolve and the file card to render.
    await flushUntil(() => document.querySelector('.file-card-grid-item > div') !== null);
    const card = document.querySelector<HTMLDivElement>('.file-card-grid-item > div');
    expect(card).toBeTruthy();

    await act(async () => {
      card?.click();
    });
    await flushUntil(() => copyFileToInputMock.mock.calls.length > 0);

    // Fast path: server-side copy-to-input, no browser download or re-upload.
    expect(copyFileToInputMock).toHaveBeenCalledWith('foo.png', 'output', { overwrite: true });
    expect(uploadImageFileMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith('foo.png', 'output');

    // Restore shared mocks so later tests see the default empty resolution.
    vi.unstubAllGlobals();
    getUserImagesMock.mockReset();
    if (prevGetUserImages) getUserImagesMock.mockImplementation(prevGetUserImages);
  });

  it('lists the whole tree recursively when the favorites filter is on', async () => {
    getUserImagesMock.mockClear();
    await act(async () => {
      root.render(<InputFilePicker open onClose={() => {}} onPick={() => {}} />);
    });

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Input picker options"]')
        ?.click();
    });
    const favoritesItem = Array.from(
      document.querySelectorAll<HTMLElement>('.input-picker-menu button'),
    ).find((el) => el.textContent?.includes('Favorites Only'));
    expect(favoritesItem).toBeTruthy();
    getUserImagesMock.mockClear();
    await act(async () => {
      favoritesItem?.click();
    });
    await flushUntil(() => getUserImagesMock.mock.calls.length > 0);

    // includeSubfolders (5th arg) must be true so favorites in nested folders surface.
    const lastCall = getUserImagesMock.mock.calls.at(-1);
    expect(lastCall?.[4]).toBe(true);
    expect(lastCall?.[5]).toBe(null);
  });

  it('carries an output favorite over to the copied input file', async () => {
    const file: FileItem = {
      id: 'output/foo.png',
      name: 'foo.png',
      type: 'image',
      fullUrl: '/view?filename=foo.png&type=output',
    };
    const prevGetUserImages = getUserImagesMock.getMockImplementation();
    getUserImagesMock.mockResolvedValue([file]);
    copyFileToInputMock.mockReset();
    copyFileToInputMock.mockResolvedValue({ name: 'foo.png', subfolder: '', type: 'input' });
    useOutputsStore.setState({ favorites: ['output/foo.png'] });

    await act(async () => {
      root.render(
        <InputFilePicker open defaultSource="output" onClose={() => {}} onPick={() => {}} />,
      );
    });
    await flushUntil(() => document.querySelector('.file-card-grid-item > div') !== null);

    await act(async () => {
      document.querySelector<HTMLDivElement>('.file-card-grid-item > div')?.click();
    });
    await flushUntil(() => useOutputsStore.getState().favorites.includes('input/foo.png'));

    expect(useOutputsStore.getState().favorites).toContain('input/foo.png');
    // Original output favorite is untouched.
    expect(useOutputsStore.getState().favorites).toContain('output/foo.png');

    useOutputsStore.setState({ favorites: [] });
    getUserImagesMock.mockReset();
    if (prevGetUserImages) getUserImagesMock.mockImplementation(prevGetUserImages);
  });

  it('uses an opaque fullscreen background', async () => {
    await act(async () => {
      root.render(<InputFilePicker open onClose={() => {}} onPick={() => {}} />);
    });

    const modal = document.querySelector('.fullscreen-widget-modal');
    expect(modal?.getAttribute('data-background')).toBe('opaque');
  });
});

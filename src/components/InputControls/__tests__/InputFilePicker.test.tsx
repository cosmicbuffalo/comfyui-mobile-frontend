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
    loadFileState: vi.fn(async () => ({ favorite: [], reject: [], hidden: [] })),
    setFileState: vi.fn(async () => undefined),
  };
});

import { getUserImages, copyFileToInput, uploadImageFile, type FileItem } from '@/api/client';
import { useOutputsStore } from '@/hooks/useOutputs';
import { useImageViewerStore } from '@/hooks/useImageViewer';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { ComboControl } from '../ComboControl';
import { InputFilePicker } from '../InputFilePicker';
import { useShowHiddenStore } from '@/hooks/useShowHidden';

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
    useImageViewerStore.setState({
      viewerOpen: false,
      viewerImages: [],
      viewerIndex: 0,
      viewerScale: 1,
      viewerTranslate: { x: 0, y: 0 },
    });
    useWorkflowStore.getState().setFollowQueue(false);
    useShowHiddenStore.setState({ showHidden: false });
  });

  afterEach(async () => {
    vi.useRealTimers();
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

  it('loads with created date as its default sort', async () => {
    getUserImagesMock.mockClear();
    await act(async () => {
      root.render(<InputFilePicker open onClose={() => {}} onPick={() => {}} />);
    });
    await flushUntil(() => getUserImagesMock.mock.calls.length > 0);

    expect(getUserImagesMock.mock.calls.at(-1)?.[3]).toBe('created');
  });

  it('uses the global show-hidden preference', async () => {
    useShowHiddenStore.setState({ showHidden: true });
    await act(async () => {
      root.render(<InputFilePicker open onClose={() => {}} onPick={() => {}} />);
    });

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="Input picker options"]')
        ?.click();
    });

    const hideHidden = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Hide Hidden Files',
    );
    expect(hideHidden).toBeDefined();
  });

  it('loads an image from a hidden input folder without reporting it missing', async () => {
    const hiddenFolder: FileItem = {
      id: 'input/.hidden',
      name: '.hidden',
      type: 'folder',
      hidden: true,
    };
    const hiddenImage: FileItem = {
      id: 'input/.hidden/reference.png',
      name: 'reference.png',
      type: 'image',
      fullUrl: '/view?filename=reference.png&subfolder=.hidden&type=input',
      hidden: true,
    };
    getUserImagesMock
      .mockResolvedValueOnce([hiddenFolder])
      .mockResolvedValueOnce([hiddenImage]);
    useShowHiddenStore.setState({ showHidden: true });
    const onPick = vi.fn();

    await act(async () => {
      root.render(
        <InputFilePicker
          open
          onClose={() => {}}
          onPick={onPick}
        />,
      );
    });
    await flushUntil(() => document.querySelector('.file-card-list-item') !== null);

    await act(async () => {
      document.querySelector<HTMLDivElement>('.file-card-list-item')?.click();
    });
    await flushUntil(() => document.querySelector('.file-card-grid-item > div') !== null);

    expect(getUserImagesMock.mock.calls.at(-1)?.[5]).toBe('.hidden');
    expect(getUserImagesMock.mock.calls.at(-1)?.[6]).toBe(true);

    await act(async () => {
      document.querySelector<HTMLDivElement>('.file-card-grid-item > div')?.click();
    });
    await flushUntil(() => onPick.mock.calls.length > 0);

    expect(onPick).toHaveBeenCalledWith('.hidden/reference.png [input]', 'input');
    const pickedValue = onPick.mock.calls[0]?.[0] as string;

    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      media: '(pointer: coarse)',
      addEventListener: () => {},
      removeEventListener: () => {},
    })));
    await act(async () => {
      // Hiding browser entries again must not make the node reinterpret its
      // already-selected, still-existing input as missing.
      useShowHiddenStore.getState().setShowHidden(false);
      root.render(
        <ComboControl
          containerClass=""
          name="image"
          value={pickedValue}
          options={{ options: ['visible.png'], image_upload: true }}
          onChange={() => {}}
          hasPin={false}
        />,
      );
    });

    expect(container.textContent).not.toContain('Missing on ComfyUI server');
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(useOutputsStore.getState().favorites).toContain('input/foo.png');
    // Original output favorite is untouched.
    expect(useOutputsStore.getState().favorites).toContain('output/foo.png');

    await act(async () => {
      useOutputsStore.setState({ favorites: [] });
    });
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

  it('opens in the selected image folder and outlines the selected image in cyan', async () => {
    getUserImagesMock.mockClear();
    const selected: FileItem = {
      id: 'input/reference/faces/portrait.png',
      name: 'portrait.png',
      type: 'image',
      fullUrl: '/view?filename=portrait.png&subfolder=reference%2Ffaces&type=input',
    };
    getUserImagesMock.mockResolvedValueOnce([selected]);

    await act(async () => {
      root.render(
        <InputFilePicker
          open
          selectedValue="reference/faces/portrait.png [input]"
          onClose={() => {}}
          onPick={() => {}}
        />,
      );
    });
    await flushUntil(() => document.querySelector('.file-card-grid-item > div') !== null);

    expect(getUserImagesMock.mock.calls[0]?.[0]).toBe('input');
    expect(getUserImagesMock.mock.calls[0]?.[5]).toBe('reference/faces');
    expect(document.body.textContent).toContain('reference');
    expect(document.body.textContent).toContain('faces');
    expect(document.querySelector('.file-card-grid-item > div')?.className)
      .toContain('ring-cyan-400');
  });

  it('opens a held image in the viewer without committing it, then restores the picker', async () => {
    getUserImagesMock.mockClear();
    const file: FileItem = {
      id: 'input/reference/candidate.png',
      name: 'candidate.png',
      type: 'image',
      fullUrl: '/view?filename=candidate.png&subfolder=reference&type=input',
    };
    getUserImagesMock.mockResolvedValueOnce([file]);
    const onPick = vi.fn();

    await act(async () => {
      root.render(
        <InputFilePicker open onClose={() => {}} onPick={onPick} />,
      );
    });
    await flushUntil(() => document.querySelector('.file-card-grid-item > div') !== null);
    const card = document.querySelector<HTMLElement>('.file-card-grid-item > div');
    expect(card).toBeTruthy();

    vi.useFakeTimers();
    const pointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    Object.defineProperties(pointerDown, {
      pointerId: { value: 1 },
      isPrimary: { value: true },
    });
    await act(async () => {
      card?.dispatchEvent(pointerDown);
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(onPick).not.toHaveBeenCalled();
    expect(useImageViewerStore.getState()).toMatchObject({
      viewerOpen: true,
      viewerIndex: 0,
    });
    expect(useImageViewerStore.getState().viewerImages[0]).toMatchObject({
      filename: 'candidate.png',
      file,
    });
    // The picker's higher-z-index opaque modal must step aside for the viewer.
    expect(document.querySelector('.fullscreen-widget-modal')).toBeNull();

    await act(async () => {
      useImageViewerStore.getState().setViewerState({ viewerOpen: false });
    });
    expect(document.querySelector('.fullscreen-widget-modal')).not.toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

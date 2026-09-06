import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileItem } from '@/api/client';
import { FileCard } from '@/components/OutputsPanel/FileCard';

function makeFile(): FileItem {
  return {
    id: 'output/a.png',
    name: 'a.png',
    type: 'image',
  };
}

describe('FileCard selection clicks', () => {
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

  it('passes shift-click selection events to the selection handler', async () => {
    const onToggleSelection = vi.fn();

    await act(async () => {
      root.render(
        <FileCard
          file={makeFile()}
          viewMode="grid"
          selectionMode={true}
          isSelected={false}
          isFavorited={false}
          onNavigateFolder={() => {}}
          onOpen={() => {}}
          onMenu={() => {}}
          onToggleSelection={onToggleSelection}
        />,
      );
    });

    document
      .querySelector('.file-card-grid-item > div')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));

    expect(onToggleSelection).toHaveBeenCalledWith(
      'output/a.png',
      expect.objectContaining({ shiftKey: true }),
    );
  });

  it('uses unchecked grid selection badges for range selection without toggling the card', async () => {
    const onToggleSelection = vi.fn();

    await act(async () => {
      root.render(
        <FileCard
          file={makeFile()}
          viewMode="grid"
          selectionMode={true}
          isSelected={false}
          isFavorited={false}
          onNavigateFolder={() => {}}
          onOpen={() => {}}
          onMenu={() => {}}
          onToggleSelection={onToggleSelection}
        />,
      );
    });

    document
      .querySelector('.selection-badge')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onToggleSelection).toHaveBeenCalledTimes(1);
    expect(onToggleSelection).toHaveBeenCalledWith(
      'output/a.png',
      expect.any(Object),
      { range: true },
    );
  });

  it('uses unchecked list selection badges for range selection without toggling the row', async () => {
    const onToggleSelection = vi.fn();

    await act(async () => {
      root.render(
        <FileCard
          file={makeFile()}
          viewMode="list"
          selectionMode={true}
          isSelected={false}
          isFavorited={false}
          onNavigateFolder={() => {}}
          onOpen={() => {}}
          onMenu={() => {}}
          onToggleSelection={onToggleSelection}
        />,
      );
    });

    document
      .querySelector('.selection-badge')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onToggleSelection).toHaveBeenCalledTimes(1);
    expect(onToggleSelection).toHaveBeenCalledWith(
      'output/a.png',
      expect.any(Object),
      { range: true },
    );
  });

  it('shows count, total size, and the active folder date metadata', async () => {
    const now = Date.now();
    const folder: FileItem = {
      id: 'output/renders',
      name: 'renders',
      type: 'folder',
      count: 12,
      size: 2048,
      createdDate: now - 3 * 24 * 60 * 60_000,
      modifiedDate: now - 2 * 60 * 60_000,
    };

    await act(async () => {
      root.render(
        <FileCard
          file={folder}
          viewMode="list"
          selectionMode={false}
          isSelected={false}
          isFavorited={false}
          onNavigateFolder={() => {}}
          onOpen={() => {}}
          onMenu={() => {}}
          onToggleSelection={() => {}}
          sortMode="modified"
        />,
      );
    });

    const metadata = container.querySelector('.folder-metadata');
    expect(metadata?.textContent).toContain('12 items');
    expect(metadata?.textContent).toContain('2.0 KB');
    expect(metadata?.textContent).toContain('2 hours ago');

    await act(async () => {
      root.render(
        <FileCard
          file={folder}
          viewMode="list"
          selectionMode={false}
          isSelected={false}
          isFavorited={false}
          onNavigateFolder={() => {}}
          onOpen={() => {}}
          onMenu={() => {}}
          onToggleSelection={() => {}}
          sortMode="created"
        />,
      );
    });
    expect(container.querySelector('.folder-metadata')?.textContent)
      .toContain('3 days ago');
  });

  it('shows size and the active date metadata for files in list view', async () => {
    const now = Date.now();
    const file: FileItem = {
      id: 'output/render.png',
      name: 'render.png',
      type: 'image',
      size: 4096,
      createdDate: now - 4 * 24 * 60 * 60_000,
      modifiedDate: now - 3 * 60 * 60_000,
    };

    await act(async () => {
      root.render(
        <FileCard
          file={file}
          viewMode="list"
          selectionMode={false}
          isSelected={false}
          isFavorited={false}
          onNavigateFolder={() => {}}
          onOpen={() => {}}
          onMenu={() => {}}
          onToggleSelection={() => {}}
          sortMode="modified"
        />,
      );
    });

    const metadata = container.querySelector('.file-metadata');
    expect(metadata?.textContent).toContain('4.0 KB');
    expect(metadata?.textContent).toContain('3 hours ago');

    await act(async () => {
      root.render(
        <FileCard
          file={file}
          viewMode="list"
          selectionMode={false}
          isSelected={false}
          isFavorited={false}
          onNavigateFolder={() => {}}
          onOpen={() => {}}
          onMenu={() => {}}
          onToggleSelection={() => {}}
          sortMode="created"
        />,
      );
    });
    expect(container.querySelector('.file-metadata')?.textContent)
      .toContain('4 days ago');
  });

  it('shows a compact duration badge beside the size for grid videos', async () => {
    const video: FileItem = {
      id: 'output/clips/demo.mp4',
      name: 'demo.mp4',
      type: 'video',
      size: 4 * 1024 * 1024,
    };

    await act(async () => {
      root.render(
        <FileCard
          file={video}
          viewMode="grid"
          selectionMode={false}
          isSelected={false}
          isFavorited={false}
          onNavigateFolder={() => {}}
          onOpen={() => {}}
          onMenu={() => {}}
          onToggleSelection={() => {}}
          videoDurationSeconds={5.47}
        />,
      );
    });

    expect(container.querySelector('.file-size-badge')?.textContent).toBe('4.0 MB');
    expect(container.querySelector('.video-duration-badge')?.textContent).toBe('5.5s');
  });

  it('never shows a duration badge on an image', async () => {
    await act(async () => {
      root.render(
        <FileCard
          file={makeFile()}
          viewMode="grid"
          selectionMode={false}
          isSelected={false}
          isFavorited={false}
          onNavigateFolder={() => {}}
          onOpen={() => {}}
          onMenu={() => {}}
          onToggleSelection={() => {}}
          videoDurationSeconds={10}
        />,
      );
    });

    expect(container.querySelector('.video-duration-badge')).toBeNull();
  });

  it('shows nested reject counts instead of unfiltered folder totals', async () => {
    await act(async () => {
      root.render(
        <FileCard
          file={{
            id: 'output/review',
            name: 'review',
            type: 'folder',
            count: 20,
            size: 4096,
            rejectCount: 3,
          }}
          viewMode="list"
          selectionMode={false}
          isSelected={false}
          isFavorited={false}
          onNavigateFolder={() => {}}
          onOpen={() => {}}
          onMenu={() => {}}
          onToggleSelection={() => {}}
          sortMode="modified"
        />,
      );
    });

    expect(container.querySelector('.folder-reject-count')?.textContent).toBe('3 rejects inside');
    expect(container.querySelector('.folder-metadata')).toBeNull();
  });

  it('shows desktop favorite and reject controls without opening the file', async () => {
    const onOpen = vi.fn();
    const onToggleFavorite = vi.fn();
    const onToggleRejected = vi.fn();

    await act(async () => {
      root.render(
        <FileCard
          file={makeFile()}
          viewMode="grid"
          selectionMode={false}
          isSelected={false}
          isFavorited={false}
          onNavigateFolder={() => {}}
          onOpen={onOpen}
          onMenu={() => {}}
          onToggleSelection={() => {}}
          onToggleFavorite={onToggleFavorite}
          onToggleRejected={onToggleRejected}
        />,
      );
    });

    const thumbnail = container.querySelector('.file-card-grid-item > div');
    expect(thumbnail?.className).toContain('lg:group-hover:ring-slate-300/40');
    const hoverActions = container.querySelector('.desktop-state-hover-actions');
    expect(hoverActions?.className).toContain('justify-between');
    expect(hoverActions?.firstElementChild?.getAttribute('aria-label')).toBe('Reject');
    expect(hoverActions?.lastElementChild?.getAttribute('aria-label')).toBe('Favorite');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Favorite"]')?.click();
      container.querySelector<HTMLButtonElement>('button[aria-label="Reject"]')?.click();
    });

    expect(onToggleFavorite).toHaveBeenCalledWith('output/a.png');
    expect(onToggleRejected).toHaveBeenCalledWith('output/a.png');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('dismisses hover controls after a click and keeps only the bare active state', async () => {
    const onToggleFavorite = vi.fn();
    const renderCard = (isFavorited: boolean) => root.render(
      <FileCard
        file={makeFile()}
        viewMode="list"
        selectionMode={false}
        isSelected={false}
        isFavorited={isFavorited}
        onNavigateFolder={() => {}}
        onOpen={() => {}}
        onMenu={() => {}}
        onToggleSelection={() => {}}
        onToggleFavorite={onToggleFavorite}
        onToggleRejected={() => {}}
      />,
    );

    await act(async () => {
      renderCard(false);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Favorite"]')?.click();
      renderCard(true);
    });

    expect(onToggleFavorite).toHaveBeenCalledWith('output/a.png');
    const hoverActions = container.querySelector('.desktop-state-hover-actions');
    expect(hoverActions?.className).not.toContain('group-hover:visible');
    expect(hoverActions?.querySelector('button[aria-label="Reject"]')).toBeNull();

    const persistentButton = container.querySelector<HTMLButtonElement>(
      '.persistent-state-action button[aria-label="Unfavorite"]',
    );
    expect(persistentButton).not.toBeNull();
    expect(persistentButton?.className).not.toContain('bg-black/40');
    expect(persistentButton?.closest('.persistent-state-action')?.className).toContain('right-0');

    await act(async () => {
      persistentButton?.click();
      renderCard(false);
    });

    expect(onToggleFavorite).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.desktop-state-hover-actions')?.className)
      .toContain('group-hover:visible');
  });

  it('shows only Reject on hover for a rejected item and keeps it bottom-right', async () => {
    await act(async () => {
      root.render(
        <FileCard
          file={makeFile()}
          viewMode="grid"
          selectionMode={false}
          isSelected={false}
          isFavorited={false}
          isRejected
          onNavigateFolder={() => {}}
          onOpen={() => {}}
          onMenu={() => {}}
          onToggleSelection={() => {}}
          onToggleFavorite={() => {}}
          onToggleRejected={() => {}}
        />,
      );
    });

    const hoverActions = container.querySelector('.desktop-state-hover-actions');
    expect(hoverActions?.querySelector('button[aria-label="Clear rejected mark"]')).not.toBeNull();
    expect(hoverActions?.querySelector('button[aria-label="Favorite"]')).toBeNull();
    const persistent = container.querySelector('.persistent-state-action');
    expect(persistent?.className).toContain('bottom-2');
    expect(persistent?.className).toContain('right-2');
  });

  it('offers favorite but not reject on folder rows', async () => {
    await act(async () => {
      root.render(
        <FileCard
          file={{ id: 'output/folder', name: 'folder', type: 'folder' }}
          viewMode="list"
          selectionMode={false}
          isSelected={false}
          isFavorited={false}
          onNavigateFolder={() => {}}
          onOpen={() => {}}
          onMenu={() => {}}
          onToggleSelection={() => {}}
          onToggleFavorite={() => {}}
          onToggleRejected={() => {}}
        />,
      );
    });

    expect(container.querySelector('button[aria-label="Favorite"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Reject"]')).toBeNull();
  });
});

describe('FileCard state badges in selection mode', () => {
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

  const renderRejected = (viewMode: 'grid' | 'list', selectionMode: boolean) => root.render(
    <FileCard
      file={makeFile()}
      viewMode={viewMode}
      selectionMode={selectionMode}
      isSelected={false}
      isFavorited={false}
      isRejected
      onNavigateFolder={() => {}}
      onOpen={() => {}}
      onMenu={() => {}}
      onToggleSelection={() => {}}
      onToggleFavorite={() => {}}
      onToggleRejected={() => {}}
    />,
  );

  for (const viewMode of ['grid', 'list'] as const) {
    it(`keeps the rejected badge visible on desktop in selection mode (${viewMode})`, async () => {
      await act(async () => {
        renderRejected(viewMode, true);
      });

      // Selection mode suppresses the desktop hover/persistent buttons, so the
      // static badge has to stay on at every breakpoint.
      expect(container.querySelector('.persistent-state-action')).toBeNull();
      const badges = container.querySelector('.file-card-state-badges');
      expect(badges).not.toBeNull();
      expect(badges?.className).not.toContain('lg:hidden');
      expect(container.querySelector('.rejected-badge-container, .file-card-state-badges svg'))
        .not.toBeNull();
    });

    it(`leaves the badge to the desktop controls outside selection mode (${viewMode})`, async () => {
      await act(async () => {
        renderRejected(viewMode, false);
      });

      expect(container.querySelector('.file-card-state-badges')?.className)
        .toContain('lg:hidden');
      expect(container.querySelector('.persistent-state-action')).not.toBeNull();
    });
  }
});

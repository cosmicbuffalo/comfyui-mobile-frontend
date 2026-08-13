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
    expect(metadata?.textContent).toContain('12 个项目');
    expect(metadata?.textContent).toContain('2.0 KB');
    expect(metadata?.textContent).toContain('2 小时前');

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
      .toContain('3 天前');
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
    expect(metadata?.textContent).toContain('3 小时前');

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
      .toContain('4 天前');
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

    expect(container.querySelector('.folder-reject-count')?.textContent).toBe('其中 3 个拒收');
    expect(container.querySelector('.folder-metadata')).toBeNull();
  });
});

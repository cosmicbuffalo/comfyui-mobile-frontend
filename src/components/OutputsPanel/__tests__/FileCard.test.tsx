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
});

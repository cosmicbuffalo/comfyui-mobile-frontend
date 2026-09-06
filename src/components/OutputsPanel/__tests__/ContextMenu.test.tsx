import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileItem } from '@/api/client';
import { OutputsContextMenu } from '../ContextMenu';

describe('OutputsContextMenu reject action', () => {
  let container: HTMLDivElement;
  let root: Root;
  const image: FileItem = { id: 'output/a.png', name: 'a.png', type: 'image' };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(
    file: FileItem,
    rejected: string[] = [],
    handleReject = vi.fn(),
    videoWorkflowAvailable = false,
  ) {
    await act(async () => {
      root.render(
        <OutputsContextMenu
          menuTarget={{ file }}
          favorites={[]}
          rejected={rejected}
          setMenuTarget={() => {}}
          menuRef={createRef<HTMLDivElement>()}
          menuStyle={{}}
          handleFavorite={() => {}}
          handleReject={handleReject}
          handleToggleHidden={() => {}}
          handleSelectSingle={() => {}}
          handleMoveSingle={() => {}}
          handleRenameRequest={() => {}}
          handleLoadWorkflow={() => {}}
          handleLoadInWorkflow={() => {}}
          videoWorkflowAvailable={videoWorkflowAvailable}
          handleDownload={() => {}}
          handleDeleteRequest={() => {}}
        />,
      );
    });
    return handleReject;
  }

  it('offers Reject for a file and invokes it', async () => {
    const handleReject = await render(image);
    const button = Array.from(container.querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Reject'));
    button?.click();
    expect(handleReject).toHaveBeenCalledOnce();
  });

  it('offers clearing an existing rejected mark', async () => {
    await render(image, [image.id]);
    expect(container.textContent).toContain('Clear rejected mark');
  });

  it('does not offer Reject for folders', async () => {
    await render({ id: 'output/folder', name: 'folder', type: 'folder' });
    expect(container.textContent).not.toContain('Reject');
    expect(container.textContent).not.toContain('Clear rejected mark');
  });
});

describe('OutputsContextMenu load workflow action', () => {
  let container: HTMLDivElement;
  let root: Root;
  const video: FileItem = { id: 'output/clip.mp4', name: 'clip.mp4', type: 'video' };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(file: FileItem, videoWorkflowAvailable = false) {
    const handleLoadWorkflow = vi.fn();
    await act(async () => {
      root.render(
        <OutputsContextMenu
          menuTarget={{ file }}
          favorites={[]}
          rejected={[]}
          setMenuTarget={() => {}}
          menuRef={createRef<HTMLDivElement>()}
          menuStyle={{}}
          handleFavorite={() => {}}
          handleReject={() => {}}
          handleToggleHidden={() => {}}
          handleSelectSingle={() => {}}
          handleMoveSingle={() => {}}
          handleRenameRequest={() => {}}
          handleLoadWorkflow={handleLoadWorkflow}
          handleLoadInWorkflow={() => {}}
          videoWorkflowAvailable={videoWorkflowAvailable}
          handleDownload={() => {}}
          handleDeleteRequest={() => {}}
        />,
      );
    });
    return handleLoadWorkflow;
  }

  function loadWorkflowButton() {
    return Array.from(container.querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Load workflow'));
  }

  it('offers Load workflow for a video whose workflow is reachable', async () => {
    const handleLoadWorkflow = await render(video, true);
    const button = loadWorkflowButton();
    expect(button).toBeTruthy();
    button?.click();
    expect(handleLoadWorkflow).toHaveBeenCalledOnce();
  });

  it('omits Load workflow for a video with no reachable workflow', async () => {
    await render(video, false);
    expect(loadWorkflowButton()).toBeUndefined();
  });

  it('still offers Load workflow for stills regardless of the video probe', async () => {
    await render({ id: 'output/a.png', name: 'a.png', type: 'image' }, false);
    expect(loadWorkflowButton()).toBeTruthy();
  });

  it('never offers Load workflow for folders', async () => {
    await render({ id: 'output/folder', name: 'folder', type: 'folder' }, true);
    expect(loadWorkflowButton()).toBeUndefined();
  });
});

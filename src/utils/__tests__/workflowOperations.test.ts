import { describe, it, expect } from 'vitest';
import {
  resolveFileSource,
  resolveFilePath,
  buildWorkflowFilename,
  resolveViewerItemWorkflowLoad,
} from '../workflowOperations';
import type { FileItem } from '@/api/client';
import type { Workflow } from '@/api/types';
import type { ViewerImage } from '../viewerImages';

function makeFile(id: string): FileItem {
  return { id, name: id.split('/').pop() ?? id, type: 'image' };
}

describe('resolveFileSource', () => {
  it('returns "input" for files starting with input/', () => {
    expect(resolveFileSource(makeFile('input/photo.png'))).toBe('input');
  });

  it('returns "temp" for files starting with temp/', () => {
    expect(resolveFileSource(makeFile('temp/preview.png'))).toBe('temp');
  });

  it('returns "output" for files without input/ prefix', () => {
    expect(resolveFileSource(makeFile('output/result.png'))).toBe('output');
    expect(resolveFileSource(makeFile('result.png'))).toBe('output');
  });
});

describe('resolveFilePath', () => {
  it('strips the source prefix from the id', () => {
    expect(resolveFilePath(makeFile('output/img.png'))).toBe('img.png');
    expect(resolveFilePath(makeFile('input/photo.jpg'))).toBe('photo.jpg');
    expect(resolveFilePath(makeFile('temp/preview.png'))).toBe('preview.png');
  });

  it('returns id unchanged when no matching prefix', () => {
    expect(resolveFilePath(makeFile('other/file.png'))).toBe('other/file.png');
  });

  it('respects explicit source parameter', () => {
    expect(resolveFilePath(makeFile('input/img.png'), 'output')).toBe('input/img.png');
    expect(resolveFilePath(makeFile('output/img.png'), 'input')).toBe('output/img.png');
  });
});

describe('buildWorkflowFilename', () => {
  it('converts path to workflow filename', () => {
    expect(buildWorkflowFilename('img.png')).toBe('output-img.png.json');
  });

  it('replaces slashes with underscores', () => {
    expect(buildWorkflowFilename('sub/dir/img.png')).toBe('output-sub_dir_img.png.json');
  });

  it('replaces backslashes with underscores', () => {
    expect(buildWorkflowFilename('sub\\dir\\img.png')).toBe('output-sub_dir_img.png.json');
  });
});

describe('resolveViewerItemWorkflowLoad', () => {
  const mockWorkflow = { nodes: [], links: [] } as unknown as Workflow;

  it('uses full file path to build filename for non-history items', () => {
    const item: ViewerImage = {
      src: 'x',
      mediaType: 'image',
      workflow: mockWorkflow,
      file: makeFile('output/sub/dir/img.png')
    };
    const resolved = resolveViewerItemWorkflowLoad(item);
    expect(resolved?.filename).toBe('output-sub_dir_img.png.json');
    expect(resolved?.source).toEqual({ type: 'other' });
  });

  it('uses history filename format when promptId exists', () => {
    const item: ViewerImage = {
      src: 'x',
      mediaType: 'image',
      workflow: mockWorkflow,
      promptId: 'p-123',
      file: makeFile('output/sub/dir/img.png')
    };
    const resolved = resolveViewerItemWorkflowLoad(item);
    expect(resolved?.filename).toBe('history-p-123.json');
    expect(resolved?.source).toEqual({ type: 'history', promptId: 'p-123' });
  });

  it('falls back to history map when viewer item has no embedded workflow', () => {
    const historyWorkflow = { nodes: [{ id: 1 }], links: [] } as unknown as Workflow;
    const historyMap = new Map([
      ['output/sub/dir/img.png', { workflow: historyWorkflow, promptId: 'p-from-history' }],
    ]);
    const item: ViewerImage = {
      src: 'x',
      mediaType: 'image',
      file: makeFile('output/sub/dir/img.png'),
    };
    const resolved = resolveViewerItemWorkflowLoad(item, historyMap);
    expect(resolved?.workflow).toBe(historyWorkflow);
    expect(resolved?.filename).toBe('history-p-from-history.json');
    expect(resolved?.source).toEqual({ type: 'history', promptId: 'p-from-history' });
  });

  it('prefers item workflow over history map workflow', () => {
    const itemWorkflow = { nodes: [{ id: 11 }], links: [] } as unknown as Workflow;
    const historyWorkflow = { nodes: [{ id: 22 }], links: [] } as unknown as Workflow;
    const historyMap = new Map([
      ['output/sub/dir/img.png', { workflow: historyWorkflow, promptId: 'history-prompt' }],
    ]);
    const item: ViewerImage = {
      src: 'x',
      mediaType: 'image',
      workflow: itemWorkflow,
      file: makeFile('output/sub/dir/img.png'),
    };
    const resolved = resolveViewerItemWorkflowLoad(item, historyMap);
    expect(resolved?.workflow).toBe(itemWorkflow);
  });

  it('uses default workflow filename when item has workflow but no file', () => {
    const item: ViewerImage = {
      src: 'x',
      mediaType: 'image',
      workflow: mockWorkflow,
    };
    const resolved = resolveViewerItemWorkflowLoad(item);
    expect(resolved?.filename).toBe('workflow.json');
    expect(resolved?.source).toEqual({ type: 'other' });
  });
});

import { describe, it, expect } from 'vitest';
import type { FileItem } from '@/api/client';
import {
  downloadTargetFromFileId,
  resolveSelectionDownloadTargets,
} from '../selectionDownload';

describe('downloadTargetFromFileId', () => {
  it('reconstructs a /view target for a nested file id', () => {
    expect(downloadTargetFromFileId('output/sub/img.png')).toEqual({
      src: '/view?filename=img.png&type=output&subfolder=sub',
      filename: 'img.png',
    });
  });

  it('reconstructs a root-level file id (empty subfolder)', () => {
    expect(downloadTargetFromFileId('input/clip.mp4')).toEqual({
      src: '/view?filename=clip.mp4&type=input&subfolder=',
      filename: 'clip.mp4',
    });
  });

  it('returns null for folders / non-media ids', () => {
    expect(downloadTargetFromFileId('output/some_folder')).toBeNull();
    expect(downloadTargetFromFileId('output/notes.txt')).toBeNull();
    expect(downloadTargetFromFileId('output/')).toBeNull();
    expect(downloadTargetFromFileId('nope')).toBeNull();
  });

  it('returns null for ids whose source is not a known asset root', () => {
    expect(downloadTargetFromFileId('evil/x.png')).toBeNull();
    expect(downloadTargetFromFileId('temp/clip.mp4')).not.toBeNull();
  });
});

describe('resolveSelectionDownloadTargets', () => {
  const displayed = new Map<string, FileItem>([
    [
      'output/here.png',
      { id: 'output/here.png', name: 'here.png', type: 'image', fullUrl: '/real-url' } as FileItem,
    ],
  ]);

  it('uses the in-view file fullUrl and reconstructs cross-folder selections', () => {
    const targets = resolveSelectionDownloadTargets(
      ['output/here.png', 'output/elsewhere/there.png'],
      displayed,
    );
    expect(targets).toEqual([
      { src: '/real-url', filename: 'here.png' },
      { src: '/view?filename=there.png&type=output&subfolder=elsewhere', filename: 'there.png' },
    ]);
  });

  it('skips selected folders that are not downloadable', () => {
    const targets = resolveSelectionDownloadTargets(['output/a_folder'], new Map());
    expect(targets).toEqual([]);
  });
});

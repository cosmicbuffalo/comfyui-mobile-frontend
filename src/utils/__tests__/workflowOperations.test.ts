import { describe, it, expect } from 'vitest';
import { resolveFileSource, resolveFilePath, buildWorkflowFilename } from '../workflowOperations';
import type { FileItem } from '@/api/client';

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

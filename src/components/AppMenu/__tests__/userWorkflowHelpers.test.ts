import { describe, it, expect } from 'vitest';
import { getRelativePath, getDirectChildren, getDisplayName } from '../userWorkflowHelpers';
import type { UserDataFile } from '@/api/client';

function file(name: string, path: string, modified?: number): UserDataFile {
  return { name, path, type: 'file', size: 100, modified };
}

function dir(name: string, path: string): UserDataFile {
  return { name, path, type: 'directory' };
}

// Sample data mimicking the v2 userdata API response for:
//   workflows/
//     root_workflow.json
//     portraits/
//       headshot.json
//       styles/
//         anime.json
//     landscapes/
//       sunset.json
const SAMPLE_DATA: UserDataFile[] = [
  dir('portraits', 'workflows/portraits'),
  dir('landscapes', 'workflows/landscapes'),
  dir('styles', 'workflows/portraits/styles'),
  file('root_workflow.json', 'workflows/root_workflow.json', 1000),
  file('headshot.json', 'workflows/portraits/headshot.json', 2000),
  file('anime.json', 'workflows/portraits/styles/anime.json', 3000),
  file('sunset.json', 'workflows/landscapes/sunset.json', 4000),
];

describe('getRelativePath', () => {
  it('strips the workflows/ prefix from a root-level file', () => {
    expect(getRelativePath(file('root_workflow.json', 'workflows/root_workflow.json')))
      .toBe('root_workflow.json');
  });

  it('strips the workflows/ prefix from a nested file', () => {
    expect(getRelativePath(file('headshot.json', 'workflows/portraits/headshot.json')))
      .toBe('portraits/headshot.json');
  });

  it('strips the workflows/ prefix from a deeply nested file', () => {
    expect(getRelativePath(file('anime.json', 'workflows/portraits/styles/anime.json')))
      .toBe('portraits/styles/anime.json');
  });

  it('returns the path unchanged if there is no workflows/ prefix', () => {
    expect(getRelativePath(file('other.json', 'other/other.json')))
      .toBe('other/other.json');
  });
});

describe('getDirectChildren', () => {
  it('returns only direct children of the root workflows folder', () => {
    const children = getDirectChildren(SAMPLE_DATA, 'workflows');
    const names = children.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['portraits', 'landscapes', 'root_workflow.json']),
    );
    expect(children).toHaveLength(3);
  });

  it('returns direct children of a subfolder', () => {
    const children = getDirectChildren(SAMPLE_DATA, 'workflows/portraits');
    const names = children.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['styles', 'headshot.json']));
    expect(children).toHaveLength(2);
  });

  it('returns direct children of a deeply nested folder', () => {
    const children = getDirectChildren(SAMPLE_DATA, 'workflows/portraits/styles');
    expect(children).toHaveLength(1);
    expect(children[0].name).toBe('anime.json');
  });

  it('returns empty array for a folder with no children', () => {
    const children = getDirectChildren(SAMPLE_DATA, 'workflows/nonexistent');
    expect(children).toEqual([]);
  });

  it('does not include grandchildren', () => {
    const children = getDirectChildren(SAMPLE_DATA, 'workflows');
    const names = children.map((c) => c.name);
    expect(names).not.toContain('headshot.json');
    expect(names).not.toContain('anime.json');
    expect(names).not.toContain('sunset.json');
    expect(names).not.toContain('styles');
  });
});

describe('getDisplayName', () => {
  it('strips .json from a simple filename', () => {
    expect(getDisplayName('myworkflow.json')).toBe('myworkflow');
  });

  it('strips folder path and .json extension', () => {
    expect(getDisplayName('portraits/headshot.json')).toBe('headshot');
  });

  it('strips deeply nested folder path', () => {
    expect(getDisplayName('portraits/styles/anime.json')).toBe('anime');
  });

  it('handles filename without .json extension', () => {
    expect(getDisplayName('myworkflow')).toBe('myworkflow');
  });

  it('handles filename without folder path', () => {
    expect(getDisplayName('simple.json')).toBe('simple');
  });
});

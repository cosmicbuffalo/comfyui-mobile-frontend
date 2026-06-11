import { describe, it, expect } from 'vitest';
import {
  getRelativePath,
  getDirectChildren,
  getWorkflowParentPath,
  getWorkflowMoveDestinationPath,
  canBrowseWorkflowMoveDestination,
  canMoveWorkflowEntryToDirectory,
  getDisplayName,
  isHiddenWorkflowPath,
  isManuallyHiddenWorkflowPath,
  filterHiddenWorkflows,
  filterFavoriteWorkflows,
  buildFolderModifiedMap,
} from '../userWorkflowHelpers';
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

describe('workflow move helpers', () => {
  it('builds destination paths and identifies the source parent', () => {
    const target = file('headshot.json', 'workflows/portraits/headshot.json');
    expect(getWorkflowParentPath(getRelativePath(target))).toBe('portraits');
    expect(getWorkflowMoveDestinationPath(target, '')).toBe('headshot.json');
    expect(getWorkflowMoveDestinationPath(target, 'landscapes')).toBe(
      'landscapes/headshot.json',
    );
  });

  it('prevents no-op moves and destination name collisions', () => {
    const target = file('headshot.json', 'workflows/portraits/headshot.json');
    const collision = file('headshot.json', 'workflows/landscapes/headshot.json');
    expect(canMoveWorkflowEntryToDirectory(target, 'portraits', SAMPLE_DATA)).toBe(false);
    expect(canMoveWorkflowEntryToDirectory(target, 'landscapes', [...SAMPLE_DATA, collision]))
      .toBe(false);
    expect(canMoveWorkflowEntryToDirectory(target, '', SAMPLE_DATA)).toBe(true);
  });

  it('prevents moving or browsing a folder into itself or a descendant', () => {
    const target = dir('portraits', 'workflows/portraits');
    expect(canBrowseWorkflowMoveDestination(target, 'portraits')).toBe(false);
    expect(canBrowseWorkflowMoveDestination(target, 'portraits/styles')).toBe(false);
    expect(canMoveWorkflowEntryToDirectory(target, 'portraits/styles', SAMPLE_DATA)).toBe(false);
    expect(canMoveWorkflowEntryToDirectory(target, 'landscapes', SAMPLE_DATA)).toBe(true);
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

describe('isHiddenWorkflowPath', () => {
  it('flags dotfiles and dot-folders at any depth', () => {
    expect(isHiddenWorkflowPath('.secret.json')).toBe(true);
    expect(isHiddenWorkflowPath('portraits/.hidden/foo.json')).toBe(true);
    expect(isHiddenWorkflowPath('.trash')).toBe(true);
  });

  it('treats normal paths as visible', () => {
    expect(isHiddenWorkflowPath('foo.json')).toBe(false);
    expect(isHiddenWorkflowPath('portraits/headshot.json')).toBe(false);
  });
});

describe('filterHiddenWorkflows', () => {
  const items = [
    file('foo.json', 'workflows/foo.json'),
    file('.secret.json', 'workflows/.secret.json'),
    dir('.trash', 'workflows/.trash'),
  ];

  it('hides dot entries when showHidden is false', () => {
    expect(filterHiddenWorkflows(items, false).map((i) => i.path)).toEqual(['workflows/foo.json']);
  });

  it('keeps everything when showHidden is true', () => {
    expect(filterHiddenWorkflows(items, true)).toHaveLength(3);
  });

  it('hides manually-marked entries (and contents of hidden folders) when showHidden is false', () => {
    const manualItems = [
      file('foo.json', 'workflows/foo.json'),
      file('bar.json', 'workflows/bar.json'),
      dir('archive', 'workflows/archive'),
      file('old.json', 'workflows/archive/old.json'),
    ];
    const result = filterHiddenWorkflows(manualItems, false, ['bar.json', 'archive']).map(
      (i) => i.path,
    );
    // bar.json is marked hidden; archive (folder) and its child are hidden too.
    expect(result).toEqual(['workflows/foo.json']);
  });

  it('keeps manually-hidden entries when showHidden is true', () => {
    expect(filterHiddenWorkflows(items, true, ['foo.json'])).toHaveLength(3);
  });
});

describe('isManuallyHiddenWorkflowPath', () => {
  it('matches the path itself and any descendant of a hidden folder', () => {
    expect(isManuallyHiddenWorkflowPath('foo.json', ['foo.json'])).toBe(true);
    expect(isManuallyHiddenWorkflowPath('sub/foo.json', ['sub'])).toBe(true);
    expect(isManuallyHiddenWorkflowPath('sub/deep/foo.json', ['sub'])).toBe(true);
  });

  it('does not match unrelated or sibling-prefixed paths', () => {
    expect(isManuallyHiddenWorkflowPath('foo.json', ['bar.json'])).toBe(false);
    // "subway.json" is not under the hidden "sub" folder.
    expect(isManuallyHiddenWorkflowPath('subway.json', ['sub'])).toBe(false);
    expect(isManuallyHiddenWorkflowPath('foo.json', [])).toBe(false);
  });
});

describe('filterFavoriteWorkflows', () => {
  it('keeps favorited files and folders containing a favorited descendant', () => {
    const items = [
      file('a.json', 'workflows/a.json'),
      file('b.json', 'workflows/b.json'),
      dir('portraits', 'workflows/portraits'),
      dir('empty', 'workflows/empty'),
    ];
    const favorites = ['a.json', 'portraits/styles/c.json'];
    expect(filterFavoriteWorkflows(items, favorites).map((i) => i.path)).toEqual([
      'workflows/a.json',
      'workflows/portraits',
    ]);
  });

  it('returns nothing when there are no favorites', () => {
    expect(
      filterFavoriteWorkflows([file('a.json', 'workflows/a.json'), dir('x', 'workflows/x')], []),
    ).toEqual([]);
  });
});

describe('buildFolderModifiedMap', () => {
  it('uses the most recent modified time among a folder and its descendants', () => {
    const map = buildFolderModifiedMap(SAMPLE_DATA);
    // portraits has headshot (2000) + nested styles/anime (3000) → 3000
    expect(map.get('workflows/portraits')).toBe(3000);
    // styles only contains anime (3000)
    expect(map.get('workflows/portraits/styles')).toBe(3000);
    // landscapes only contains sunset (4000)
    expect(map.get('workflows/landscapes')).toBe(4000);
  });

  it("prefers a folder's own modified time when it is newer than its contents", () => {
    const data: UserDataFile[] = [
      { name: 'empty', path: 'workflows/empty', type: 'directory', modified: 9000 },
      file('old.json', 'workflows/empty/old.json', 1000),
    ];
    expect(buildFolderModifiedMap(data).get('workflows/empty')).toBe(9000);
  });

  it('omits folders with no modified time anywhere', () => {
    const data: UserDataFile[] = [dir('bare', 'workflows/bare')];
    expect(buildFolderModifiedMap(data).has('workflows/bare')).toBe(false);
  });
});

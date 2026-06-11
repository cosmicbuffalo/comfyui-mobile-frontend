import { describe, expect, it } from 'vitest';
import type { FileItem } from '@/api/client';
import {
  buildBreadcrumbs,
  buildFileSections,
  collapseBreadcrumbs,
  isCrumbHidden,
} from '@/utils/outputsBrowser';

function file(overrides: Partial<FileItem> & { name: string }): FileItem {
  return { id: overrides.name, type: 'image', ...overrides };
}

describe('buildFileSections', () => {
  const opts = (o: Partial<{ isNameSort: boolean; isSizeSort: boolean; shouldGroupByDate: boolean }>) => ({
    isNameSort: false,
    isSizeSort: false,
    shouldGroupByDate: false,
    ...o,
  });

  it('groups by initial letter when name-sorting', () => {
    const files = [file({ name: 'apple' }), file({ name: 'avocado' }), file({ name: 'banana' })];
    const sections = buildFileSections(files, opts({ isNameSort: true }));
    expect(sections.map((s) => s.key)).toEqual(['A', 'B']);
    expect(sections[0].files).toHaveLength(2);
    expect(sections[0].label).toBe('Starting with A');
  });

  it('groups by rounded size when size-sorting', () => {
    const files = [
      file({ name: 'tiny', size: 500 }),
      file({ name: 'small', size: 1.4 * 1024 * 1024 }),
    ];
    const sections = buildFileSections(files, opts({ isSizeSort: true }));
    expect(sections.map((s) => s.label)).toEqual(['<1MB', '1MB']);
  });

  it('returns a single "All files" section when not grouping by date', () => {
    const files = [file({ name: 'a' }), file({ name: 'b' })];
    const sections = buildFileSections(files, opts({ shouldGroupByDate: false }));
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ key: 'all', label: 'All files' });
    expect(sections[0].files).toHaveLength(2);
  });

  it('groups consecutive same-day files into one date section', () => {
    const day = Date.UTC(2026, 0, 2);
    const files = [
      file({ name: 'a', date: day }),
      file({ name: 'b', date: day }),
    ];
    const sections = buildFileSections(files, opts({ shouldGroupByDate: true }));
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe('2026-01-02');
  });
});

describe('buildBreadcrumbs', () => {
  it('starts with a source-specific root and one crumb per folder segment', () => {
    expect(buildBreadcrumbs('output', 'a/b/c')).toEqual([
      { name: 'Outputs', path: null },
      { name: 'a', path: 'a' },
      { name: 'b', path: 'a/b' },
      { name: 'c', path: 'a/b/c' },
    ]);
  });

  it('uses Inputs/Temp root names', () => {
    expect(buildBreadcrumbs('input', null)[0].name).toBe('Inputs');
    expect(buildBreadcrumbs('temp', null)[0].name).toBe('Temp');
  });
});

describe('isCrumbHidden', () => {
  it('treats null path (root) as visible', () => {
    expect(isCrumbHidden(null, [])).toBe(false);
  });

  it('hides dot-prefixed segments', () => {
    expect(isCrumbHidden('a/.secret/b', [])).toBe(true);
  });

  it('hides a path whose ancestor is in the hidden set', () => {
    expect(isCrumbHidden('a/b/c', ['a/b'])).toBe(true);
    expect(isCrumbHidden('a/b/c', ['a/x'])).toBe(false);
  });
});

describe('collapseBreadcrumbs', () => {
  it('keeps all crumbs when 3 or fewer, last is not clickable', () => {
    const display = collapseBreadcrumbs([
      { name: 'Outputs', path: null },
      { name: 'a', path: 'a' },
    ]);
    expect(display).toHaveLength(2);
    expect(display[0].isClickable).toBe(true);
    expect(display[1].isClickable).toBe(false);
  });

  it('collapses long trails to Root / … / Parent / Current', () => {
    const display = collapseBreadcrumbs([
      { name: 'Outputs', path: null },
      { name: 'a', path: 'a' },
      { name: 'b', path: 'a/b' },
      { name: 'c', path: 'a/b/c' },
      { name: 'd', path: 'a/b/c/d' },
    ]);
    expect(display.map((c) => c.name)).toEqual(['Outputs', '...', 'c', 'd']);
    expect(display[1].isEllipsis).toBe(true);
    expect(display[3].isClickable).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  buildAlternativesHashMap,
  buildCustomNodeRows,
  getCustomNodeActionOptions,
  isUnknownVersion,
} from '../customNodesManager';

describe('isUnknownVersion', () => {
  it('treats missing/empty/"unknown" as unknown, a real version as known', () => {
    expect(isUnknownVersion(undefined)).toBe(true);
    expect(isUnknownVersion('')).toBe(true);
    expect(isUnknownVersion('unknown')).toBe(true);
    expect(isUnknownVersion('1.2.3')).toBe(false);
  });
});

describe('buildCustomNodeRows version classification', () => {
  it('classifies missing/unknown version as "unknown" and a real version as "cnr"', () => {
    const rows = buildCustomNodeRows({
      withVer: { version: '1.2.3', state: 'enabled' },
      missingVer: { state: 'enabled' },
      unknownVer: { version: 'unknown', state: 'enabled' },
    } as never);
    const filters = Object.fromEntries(rows.map((r) => [r.key, r.filterTypes]));
    expect(filters.withVer).toContain('cnr');
    expect(filters.missingVer).toContain('unknown');
    expect(filters.unknownVer).toContain('unknown');
    expect(filters.missingVer).not.toContain('cnr');
  });
});

describe('getCustomNodeActionOptions switch-version gating', () => {
  it('offers "Switch ver" only for known (CNR) versions', () => {
    const rows = buildCustomNodeRows({
      missingVer: { state: 'enabled' },
      withVer: { version: '1.0.0', state: 'enabled' },
    } as never);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(getCustomNodeActionOptions(byKey.missingVer).some((o) => o.mode === 'switch')).toBe(false);
    expect(getCustomNodeActionOptions(byKey.withVer).some((o) => o.mode === 'switch')).toBe(true);
  });
});

describe('buildAlternativesHashMap', () => {
  it('only maps rows that have actual alternatives text', () => {
    const rows = buildCustomNodeRows({
      withAlt: { version: '1', state: 'enabled' },
      emptyAlt: { version: '1', state: 'enabled' },
    } as never);
    const hashByKey = Object.fromEntries(rows.map((r) => [r.key, r.hash]));
    const map = buildAlternativesHashMap(rows, {
      withAlt: { tags: ['comfy'], description: 'use this instead' },
      emptyAlt: { tags: [], description: '' },
    } as never);
    expect(map[hashByKey.withAlt]?.alternatives).toBe('comfy use this instead');
    expect(map[hashByKey.emptyAlt]).toBeUndefined();
  });
});

describe('buildCustomNodeRows combined filter hashmaps', () => {
  // The modal accumulates each special filter's derived hashmap; this guards the
  // property it relies on — a row present in multiple hashmaps keeps ALL the
  // corresponding filter tags, so switching In Workflow → Alternatives → In
  // Workflow doesn't leave a re-selected filter empty.
  it('tags a row with every matching special filter when multiple hashmaps are passed', () => {
    const packs = { mypack: { version: '1', state: 'enabled' } } as never;
    const hash = buildCustomNodeRows(packs)[0].hash;
    const rows = buildCustomNodeRows(packs, {
      inWorkflowHashMap: { [hash]: true },
      alternativesHashMap: { [hash]: { alternatives: 'use X' } },
      favoritesHashMap: { [hash]: true },
    } as never);
    expect(rows[0].filterTypes).toEqual(
      expect.arrayContaining(['In Workflow', 'Alternatives', 'Favorites']),
    );
  });
});

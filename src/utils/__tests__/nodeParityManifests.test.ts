import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error -- plain-JS manifest data, shared with scripts/check-node-parity.mjs
import { MANIFESTS } from '../../../scripts/node-parity/manifests.mjs';

/**
 * The parity check itself clones upstream repos, so it lives in
 * `scripts/check-node-parity.mjs` and runs on a schedule rather than in the unit
 * suite. What *is* checked here is the manifest data: a typo'd path or a
 * reference to a file we deleted would make the scheduled job report a false
 * failure — or worse, quietly stop covering something.
 */

interface Assumption {
  id: string;
  why: string;
  ours: string;
  file: string;
  since?: string;
  contains?: RegExp[];
  absent?: RegExp[];
}

interface Manifest {
  pack: string;
  repo: string;
  verifiedVersion: string;
  assumptions: Assumption[];
}

const manifests = MANIFESTS as Manifest[];

describe('node parity manifests', () => {
  it('covers the packs whose behaviour this frontend reimplements', () => {
    const packs = manifests.map((m) => m.pack);
    expect(packs).toContain('cg-use-everywhere');
    expect(packs).toContain('comfyui-kjnodes');
    expect(packs).toContain('rgthree-comfy');
  });

  it.each(manifests.map((m) => [m.pack, m] as const))('%s is well-formed', (_pack, manifest) => {
    expect(manifest.repo).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
    expect(manifest.verifiedVersion).toBeTruthy();
    expect(manifest.assumptions.length).toBeGreaterThan(0);

    const ids = manifest.assumptions.map((a) => a.id);
    expect(new Set(ids).size, `duplicate assumption id in ${manifest.pack}`).toBe(ids.length);

    for (const assumption of manifest.assumptions) {
      expect(assumption.id, 'id must be a kebab-case slug').toMatch(/^[a-z0-9-]+$/);
      // `why` is what a failure prints; a vague one makes the alert useless.
      expect(assumption.why.length, `${assumption.id}: why is too terse`).toBeGreaterThan(40);
      expect(
        (assumption.contains?.length ?? 0) + (assumption.absent?.length ?? 0),
        `${assumption.id}: no patterns to check`,
      ).toBeGreaterThan(0);
      expect(assumption.file, `${assumption.id}: upstream path looks absolute`).not.toMatch(/^\//);
    }
  });

  // A manifest pointing at a file we have since deleted or renamed is stale: the
  // scheduled job would keep passing while nothing in our code depends on it.
  it.each(
    manifests.flatMap((m) => m.assumptions.map((a) => [`${m.pack}/${a.id}`, a.ours] as const)),
  )('%s names a file in this repo that still exists', (_label, ours) => {
    expect(existsSync(resolve(process.cwd(), ours)), `missing: ${ours}`).toBe(true);
  });
});

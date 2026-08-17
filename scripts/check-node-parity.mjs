#!/usr/bin/env node
/**
 * Upstream parity checker.
 *
 * Clones each supported custom-node pack fresh at its latest revision and
 * re-verifies every assumption our port of it depends on (see
 * `scripts/node-parity/manifests.mjs` for the why).
 *
 *   node scripts/check-node-parity.mjs                     # all packs
 *   node scripts/check-node-parity.mjs --pack cg-use-everywhere
 *   node scripts/check-node-parity.mjs --local /path/to/custom_nodes
 *   node scripts/check-node-parity.mjs --json
 *
 * `--local` points at an existing custom_nodes directory instead of cloning,
 * which is how the manifests get validated while they are being written, and
 * how you reproduce a CI failure against the version you actually have
 * installed. Clones are cached under node_modules/.cache/node-parity; pass
 * --refresh to re-fetch.
 *
 * Exit status is 1 if any assumption failed, so this can gate a scheduled job.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { MANIFESTS } from './node-parity/manifests.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const onlyPack = value('--pack');
const localRoot = value('--local');
const asJson = flag('--json');
const refresh = flag('--refresh');

const CACHE = resolve(process.cwd(), 'node_modules/.cache/node-parity');

function log(...parts) {
  if (!asJson) console.log(...parts);
}

/** Shallow-clone (or reuse) a pack at its default branch, returning its path. */
function fetchPack(manifest) {
  if (localRoot) {
    const path = resolve(localRoot, manifest.pack);
    if (!existsSync(path)) throw new Error(`not installed at ${path}`);
    return { path, ref: 'local' };
  }
  mkdirSync(CACHE, { recursive: true });
  const path = resolve(CACHE, manifest.pack);
  if (refresh && existsSync(path)) rmSync(path, { recursive: true, force: true });
  if (!existsSync(path)) {
    execFileSync('git', ['clone', '--depth', '1', manifest.repo, path], { stdio: 'pipe' });
  } else {
    // Cached from an earlier run — move it to the current tip.
    execFileSync('git', ['-C', path, 'fetch', '--depth', '1', 'origin', 'HEAD'], { stdio: 'pipe' });
    execFileSync('git', ['-C', path, 'reset', '--hard', 'FETCH_HEAD'], { stdio: 'pipe' });
  }
  const ref = execFileSync('git', ['-C', path, 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  return { path, ref };
}

function readUpstreamVersion(manifest, packPath) {
  if (!manifest.versionFile || !manifest.versionPattern) return null;
  const file = resolve(packPath, manifest.versionFile);
  if (!existsSync(file)) return null;
  const match = readFileSync(file, 'utf8').match(manifest.versionPattern);
  return match?.[1] ?? null;
}

/** Loose numeric-segment compare; enough for the "x.y.z" versions packs use. */
function isOlderThan(version, floor) {
  if (!version || !floor) return false;
  const parse = (v) => String(v).split(/[.\-+]/).map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(version);
  const b = parse(floor);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
}

function checkAssumption(packPath, assumption) {
  const file = resolve(packPath, assumption.file);
  if (!existsSync(file)) {
    return { ok: false, reason: `upstream file is gone: ${assumption.file}` };
  }
  const source = readFileSync(file, 'utf8');
  const missing = (assumption.contains ?? []).filter((re) => !re.test(source));
  const present = (assumption.absent ?? []).filter((re) => re.test(source));
  if (missing.length === 0 && present.length === 0) return { ok: true };
  const reasons = [];
  if (missing.length) reasons.push(`no longer present: ${missing.map(String).join(', ')}`);
  if (present.length) reasons.push(`unexpectedly present: ${present.map(String).join(', ')}`);
  return { ok: false, reason: reasons.join('; ') };
}

const report = [];
let failed = 0;

for (const manifest of MANIFESTS) {
  if (onlyPack && manifest.pack !== onlyPack) continue;

  const entry = { pack: manifest.pack, assumptions: [] };
  report.push(entry);

  let packPath;
  let ref;
  try {
    ({ path: packPath, ref } = fetchPack(manifest));
  } catch (error) {
    entry.error = String(error.message ?? error);
    failed += 1;
    log(`\n✗ ${manifest.pack}: could not fetch — ${entry.error}`);
    continue;
  }

  entry.ref = ref;
  const upstreamVersion = readUpstreamVersion(manifest, packPath);
  entry.verifiedVersion = manifest.verifiedVersion;
  entry.upstreamVersion = upstreamVersion;

  log(`\n${manifest.pack} @ ${ref}`);
  if (upstreamVersion && upstreamVersion !== manifest.verifiedVersion) {
    // Not a failure on its own — a version bump is only interesting if an
    // assumption also broke. It is worth printing either way.
    log(`  note: verified against ${manifest.verifiedVersion}, upstream is now ${upstreamVersion}`);
  }

  for (const assumption of manifest.assumptions) {
    // Checking a copy older than the release that introduced a behaviour is not
    // drift — it just predates it. Common when --local points at an installed
    // pack that has not been updated yet.
    if (assumption.since && isOlderThan(upstreamVersion, assumption.since)) {
      entry.assumptions.push({ id: assumption.id, ok: true, skipped: true });
      log(`  – ${assumption.id} (new in ${assumption.since}; this copy is ${upstreamVersion})`);
      continue;
    }
    const result = checkAssumption(packPath, assumption);
    entry.assumptions.push({ id: assumption.id, ok: result.ok, reason: result.reason ?? null });
    if (result.ok) {
      log(`  ✓ ${assumption.id}`);
    } else {
      failed += 1;
      log(`  ✗ ${assumption.id}`);
      log(`      we assume: ${assumption.why}`);
      log(`      our code:  ${assumption.ours}`);
      log(`      upstream:  ${assumption.file}`);
      log(`      drift:     ${result.reason}`);
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({ failed, packs: report }, null, 2));
} else if (failed === 0) {
  log(`\nAll parity assumptions hold.`);
} else {
  log(`\n${failed} parity assumption(s) no longer hold. Re-read the upstream source, update our port, then update the manifest.`);
}

process.exit(failed === 0 ? 0 : 1);

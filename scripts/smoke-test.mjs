#!/usr/bin/env node
/**
 * End-to-end smoke test: drives a real browser against a running ComfyUI.
 *
 * Covers the paths unit tests can't reach — the app actually loading, a
 * workflow actually running, media actually decoding, and state actually
 * round-tripping to the server. Run it before tagging a release, after any
 * change to the queue panel, the outputs panel, video playback, or file state.
 *
 *   node scripts/smoke-test.mjs
 *   node scripts/smoke-test.mjs --server http://127.0.0.1:8188 --workflow "Basic SDXL" --runs 4
 *   node scripts/smoke-test.mjs --keep-outputs      # skip cleanup of what it created
 *
 * Requires Playwright's chromium: npx playwright install chromium
 *
 * It generates real images, so it needs a workflow that runs quickly and needs
 * no inputs; any small txt2img will do. Everything it changes server-side is
 * undone before it exits (see CLEANUP below) — except the generations
 * themselves, which are left in place like any other run.
 *
 * See SMOKE_TEST.md for what this deliberately does NOT cover.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const SERVER = option('server', 'http://127.0.0.1:8188').replace(/\/$/, '');
const APP = `${SERVER}/mobile/`;
const WORKFLOW = option('workflow', 'Basic SDXL');
const RUNS = Number(option('runs', '4'));
const KEEP = process.argv.includes('--keep-outputs');
// Desktop viewport on purpose: the stacked queue layout and the one-page height
// cap are desktop-only, and they are the parts most likely to regress silently.
const VIEWPORT = { width: 1400, height: 900 };

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok === true ? '  PASS' : ok === 'skip' ? '  SKIP' : '  FAIL';
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
}
/** A step returns a detail string, or `skip('reason')` when it doesn't apply here. */
const skip = (reason) => ({ __skip: reason });

async function step(name, fn) {
  try {
    const detail = await fn();
    if (detail && detail.__skip) record(name, 'skip', detail.__skip);
    else record(name, true, detail);
  } catch (err) {
    record(name, false, String(err && err.message ? err.message : err).split('\n')[0]);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

/** Collect console errors, page exceptions and failed requests for the whole run. */
function watchForFailures(page, sink) {
  page.on('console', (m) => { if (m.type() === 'error') sink.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => sink.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    const failure = r.failure();
    // ERR_ABORTED is normal: the app cancels in-flight media when you navigate.
    if (failure && !/ERR_ABORTED/.test(failure.errorText)) {
      sink.push(`request failed: ${r.url()} ${failure.errorText}`);
    }
  });
}

const api = (page, url, init) => page.evaluate(
  async ([u, i]) => {
    const r = await fetch(u, i);
    return { status: r.status, body: r.ok ? await r.json().catch(() => null) : null };
  },
  [url, init],
);

/** The queue store persists to IndexedDB, not localStorage. */
const queueState = (page) => page.evaluate(async () => {
  const raw = await new Promise((resolve) => {
    const request = indexedDB.open('comfy-mobile-frontend');
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('zustand')) return resolve(null);
      const get = db.transaction('zustand', 'readonly').objectStore('zustand').get('queue-storage');
      get.onsuccess = () => resolve(get.result ?? null);
      get.onerror = () => resolve(null);
    };
    request.onerror = () => resolve(null);
  });
  if (!raw) return null;
  const parsed = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
  return parsed.state ?? parsed;
});

/** Count DOM mutations over a quiet window — a re-render storm shows up here. */
async function idleChurn(page, ms = 4000) {
  await page.evaluate(() => {
    window.__churn = 0;
    window.__churnObserver = new MutationObserver(() => { window.__churn += 1; });
    window.__churnObserver.observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await page.waitForTimeout(ms);
  const ticks = await page.evaluate(() => {
    window.__churnObserver.disconnect();
    return window.__churn;
  });
  return ticks;
}

async function waitForQueueIdle(page, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { body } = await api(page, '/queue');
    if (body && body.queue_running.length === 0 && body.queue_pending.length === 0) return true;
    await page.waitForTimeout(2000);
  }
  throw new Error(`queue still busy after ${timeoutMs / 1000}s`);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const browser = await chromium.launch();
// A fresh browser profile every time, so persisted UI state (fold state, layout
// preference) starts from defaults and nothing here touches a real profile.
const page = await browser.newPage({ viewport: VIEWPORT });
const failures = [];
watchForFailures(page, failures);

const created = { favorites: [], inputCopies: [] };
let firstOutput = null;

console.log(`\nSmoke test — ${SERVER} — workflow "${WORKFLOW}" x${RUNS}\n`);

await step('app loads', async () => {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  assert(await page.getByLabel('Menu').count(), 'main menu button not found');
  return await page.title();
});

await step(`workflow "${WORKFLOW}" loads`, async () => {
  await page.getByLabel('Menu').click();
  await page.waitForTimeout(800);
  await page.getByText('My Workflows', { exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByText(WORKFLOW, { exact: true }).first().click();
  await page.waitForTimeout(3000);
  const runButton = page.getByRole('button', { name: /^Run$/ });
  assert(await runButton.isEnabled(), 'Run button did not become enabled');
  return 'Run enabled';
});

await step(`${RUNS} generations complete`, async () => {
  const run = page.getByRole('button', { name: /^Run$/ });
  for (let i = 0; i < RUNS; i += 1) {
    await run.click();
    await page.waitForTimeout(1500); // the button reads "Queueing..." mid-submit
  }
  await page.getByLabel('Go to Queue').click();
  await page.waitForTimeout(1500);
  await waitForQueueIdle(page);
  await page.waitForTimeout(4000);
  const { body } = await api(page, '/history?max_items=50');
  const ids = Object.keys(body ?? {});
  assert(ids.length >= RUNS, `history has ${ids.length} entries, expected at least ${RUNS}`);
  for (const entry of Object.values(body)) {
    for (const node of Object.values(entry.outputs ?? {})) {
      for (const image of node.images ?? []) {
        if (!firstOutput && image.type === 'output') firstOutput = image;
      }
    }
  }
  return `${ids.length} history entries`;
});

await step('queue cards render with a correct resolution badge', async () => {
  const badges = await page.locator('.resolution-badge').count();
  assert(badges > 0, 'no resolution badge rendered');
  const text = (await page.locator('.resolution-badge').first().innerText()).replace(/\s+/g, '');
  assert(/^\d+x\d+$/.test(text), `badge reads "${text}"`);
  return text;
});

await step('a queue card fits the viewport on desktop', async () => {
  const card = page.locator('[data-scroll-anchor-id]').first();
  const box = await card.boundingBox();
  assert(box, 'no queue card found');
  assert(box.height <= VIEWPORT.height, `card is ${Math.round(box.height)}px tall in a ${VIEWPORT.height}px viewport`);
  return `${Math.round(box.height)}px tall`;
});

await step('queue panel is quiet when idle (no re-render storm)', async () => {
  const ticks = await idleChurn(page);
  assert(ticks === 0, `${ticks} DOM mutations while idle`);
  return '0 mutations in 4s';
});

await step('Fold All folds every card and survives a reload', async () => {
  await page.getByLabel('Queue options').click();
  await page.waitForTimeout(600);
  await page.getByText('Fold All', { exact: true }).click();
  await page.waitForTimeout(1500);
  const folded = await queueState(page);
  const values = Object.values(folded?.queueItemExpanded ?? {});
  assert(values.length > 0 && values.every((v) => v === false), 'not every card folded');
  assert(
    Object.values(folded?.queueItemUserToggled ?? {}).some(Boolean),
    'the fold was not recorded as an explicit user choice',
  );

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  const after = await queueState(page);
  assert(
    Object.values(after?.queueItemExpanded ?? {}).every((v) => v === false),
    'cards re-opened after reload — an automatic path is overriding an explicit fold',
  );
  const visibleMedia = await page.locator('img[alt="Generation"]').count();
  assert(visibleMedia === 0, `${visibleMedia} media elements visible while folded`);
  return `${values.length} cards stayed folded`;
});

await step('Stack Outputs applies and persists', async () => {
  await page.getByLabel('Queue options').click();
  await page.waitForTimeout(600);
  await page.getByText('Stack Outputs', { exact: true }).click();
  await page.waitForTimeout(1500);
  const state = await queueState(page);
  assert(state?.queueOutputLayout === 'stacked', `layout is "${state?.queueOutputLayout}"`);
  // Put it back so the rest of the run sees the default.
  await page.getByLabel('Queue options').click();
  await page.waitForTimeout(600);
  await page.getByText('Tab Outputs', { exact: true }).click();
  await page.waitForTimeout(1000);
  return 'stacked, then restored to tabbed';
});

await step('favorite round-trips to the server', async () => {
  assert(firstOutput, 'no output image to favorite');
  const relPath = firstOutput.subfolder
    ? `${firstOutput.subfolder}/${firstOutput.filename}`
    : firstOutput.filename;
  const before = (await api(page, '/mobile/api/files/state?source=output')).body?.favorite ?? [];
  assert(!before.includes(relPath), 'test file was already favorited; skipping to avoid clobbering state');

  const set = await api(page, '/mobile/api/files/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'output', path: relPath, state: 'favorite', value: true }),
  });
  assert(set.status === 200, `server answered ${set.status}`);
  created.favorites.push(relPath);

  const after = (await api(page, '/mobile/api/files/state?source=output')).body?.favorite ?? [];
  assert(after.includes(relPath), 'favorite did not persist server-side');
  return relPath;
});

await step('download names the file after the original', async () => {
  await page.getByLabel('Go to Outputs').click();
  await page.waitForTimeout(3000);
  await page.locator('img').first().click();
  await page.waitForTimeout(2000);
  const download = page.waitForEvent('download', { timeout: 10000 });
  await page.getByLabel('Download').first().click();
  const saved = await download;
  const name = saved.suggestedFilename();
  assert(/\.(png|jpe?g|webp|mp4|webm)$/i.test(name), `suggested filename is "${name}"`);
  assert(!/^playable\./i.test(name), 'download fell back to the URL path segment');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  return name;
});

await step('"use image" materializes an input without duplicating bytes', async () => {
  assert(firstOutput, 'no output image available');
  const relPath = firstOutput.subfolder
    ? `${firstOutput.subfolder}/${firstOutput.filename}`
    : firstOutput.filename;
  const res = await api(page, '/mobile/api/files/copy-to-input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relPath, source: 'output' }),
  });
  assert(res.status === 200, `server answered ${res.status}`);
  assert(res.body?.type === 'input', `response says type "${res.body?.type}"`);
  created.inputCopies.push(res.body.name);
  return res.body.name;
});

// Video is discovered rather than hard-coded: an install with no video outputs
// simply skips these instead of failing on a path that doesn't exist there.
await step('video playback serves a stable, correct Content-Type', async () => {
  const listing = await api(page, '/mobile/api/files?source=output&recursive=true&limit=4000');
  const files = listing.body?.files ?? listing.body?.items ?? [];
  const video = files.find((f) => /\.(mp4|webm|mkv|mov)$/i.test(f.name ?? f.filename ?? ''));
  if (!video) return skip('no video outputs on this install');
  const rel = video.path ?? video.id ?? video.name;
  const subfolder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const filename = rel.slice(rel.lastIndexOf('/') + 1);
  const url = `/mobile/api/video/playable?filename=${encodeURIComponent(filename)}`
    + `&subfolder=${encodeURIComponent(subfolder)}&type=output`;

  const seen = [];
  for (let i = 0; i < 3; i += 1) {
    const headers = await page.evaluate(async (u) => {
      const r = await fetch(u, { headers: { Range: 'bytes=0-1023' } });
      return {
        status: r.status,
        type: r.headers.get('content-type'),
        mode: r.headers.get('x-mobile-video-mode'),
        disposition: r.headers.get('content-disposition'),
      };
    }, url);
    seen.push(headers);
  }
  assert(seen.every((h) => h.status === 206), 'range requests did not return 206');
  const types = new Set(seen.map((h) => h.type));
  assert(types.size === 1, `Content-Type changed between range requests: ${[...types].join(' then ')}`);
  assert(
    seen[0].disposition?.includes(filename),
    'Content-Disposition does not carry the original filename',
  );

  const playback = await page.evaluate(async (src) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.src = src;
    document.body.appendChild(v);
    const ok = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 30000);
      v.onloadedmetadata = () => { clearTimeout(timer); resolve(true); };
      v.onerror = () => { clearTimeout(timer); resolve(false); };
    });
    if (!ok) { v.remove(); return null; }
    await v.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 3000));
    const out = { w: v.videoWidth, h: v.videoHeight, t: v.currentTime };
    v.remove();
    return out;
  }, url);
  assert(playback, 'video never reported metadata');
  assert(playback.w > 0 && playback.h > 0, 'video reported no dimensions');
  assert(playback.t > 0, 'playback position never advanced');
  return `${seen[0].mode}, ${playback.w}x${playback.h}, played ${playback.t.toFixed(1)}s`;
});

// ---------------------------------------------------------------------------
// CLEANUP — undo every server-side change except the generations themselves
// ---------------------------------------------------------------------------

if (!KEEP) {
  for (const relPath of created.favorites) {
    await api(page, '/mobile/api/files/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'output', path: relPath, state: 'favorite', value: false }),
    });
  }
  for (const name of created.inputCopies) {
    await api(page, '/mobile/api/files', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: name, source: 'input' }),
    });
  }
  if (created.favorites.length || created.inputCopies.length) {
    console.log(`\n  cleaned up: ${created.favorites.length} favorite(s), ${created.inputCopies.length} input file(s)`);
  }
}

await browser.close();

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

const failed = results.filter((r) => r.ok === false);
const skipped = results.filter((r) => r.ok === 'skip');
console.log(`\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`);

if (failures.length) {
  console.log('\nBrowser errors observed during the run:');
  for (const f of [...new Set(failures)]) console.log(`  - ${f}`);
}
if (failed.length || failures.length) {
  console.log('\nSMOKE TEST FAILED');
  process.exit(1);
}
console.log('\nSMOKE TEST PASSED — no console errors, no failed requests');

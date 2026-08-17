#!/usr/bin/env node
/**
 * Real-server check for latent previews, end to end and without a model.
 *
 *   node scripts/latent-preview-smoke.mjs --install     # first run only
 *   node scripts/latent-preview-smoke.mjs
 *   node scripts/latent-preview-smoke.mjs --token <session-token>
 *   node scripts/latent-preview-smoke.mjs --batch 4     # animated sequence
 *
 * What this covers that nothing else does
 * ---------------------------------------
 * Every other test of this pipeline stops at a boundary. The unit tests parse
 * bytes we hand them. The parity check reads upstream source. `smoke:workflow-
 * video` drives the real app but its workflow is model-free, so no sampler ever
 * runs, `get_previewer()` is never called, and not one preview frame is
 * produced. That gap is why a 4-byte error in VHS's binary envelope shipped in
 * 3.1.2 and survived six days: every layer was green and none of them had ever
 * seen a real frame.
 *
 * So this runs the whole chain for real — ComfyUI emits, VHS wraps, the socket
 * carries, the client parses and routes, React renders — and then asks the
 * browser the only question that actually matters:
 *
 *     does the <img> the user is looking at decode?
 *
 * `createImageBitmap` on the rendered blob is the assertion. Under the 3.1.2
 * parser it throws, because the blob starts with 24 bytes of protocol.
 *
 * The sampler is replaced by scripts/fixtures/latent_preview_probe, which asks
 * for a previewer through the real `latent_preview.get_previewer()` and drives
 * a real ProgressBar. No checkpoint, no GPU, ~2 seconds.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const SERVER = option('server', 'http://127.0.0.1:8188').replace(/\/$/, '');
const APP = `${SERVER}/mobile/`;
// Only needed if the server sits behind an auth layer; empty is the norm.
const TOKEN = option('token', process.env.MOBILE_SMOKE_TOKEN ?? '');
const COMFY_ROOT = option('comfy-root', fileURLToPath(new URL('../../../', import.meta.url)));
const PROBE_SOURCE = fileURLToPath(new URL('./fixtures/latent_preview_probe', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/latent-preview-probe.json', import.meta.url));
const PROBE_TYPE = 'MobileLatentPreviewProbe';
const NODE_ID = '1';
const PREVIEW_METHOD = option('preview-method', 'latent2rgb');
const BATCH = Number(option('batch', '1'));
// ~4s of stepping. Long enough that the preview is comfortably on screen before
// the run ends and the store revokes its blob URLs.
const STEPS = Number(option('steps', '20'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** The fixture with its widgets set from the CLI, as a file-picker upload. */
function probeWorkflowUpload() {
  const workflow = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const probe = workflow.nodes.find((node) => String(node.id) === NODE_ID);
  assert(probe?.widgets_values, 'fixture has no probe node');
  probe.widgets_values = [STEPS, BATCH, probe.widgets_values[2], probe.widgets_values[3]];
  return {
    name: 'latent-preview-probe.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(workflow)),
  };
}

function authHeaders() {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

function chromiumLaunchOptions() {
  if (existsSync(chromium.executablePath())) return {};
  const systemCandidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  const executablePath = systemCandidates.find((candidate) => existsSync(candidate));
  return executablePath ? { executablePath } : {};
}

function installProbe() {
  const target = join(COMFY_ROOT, 'custom_nodes', 'latent_preview_probe');
  if (existsSync(target)) {
    console.log(`probe already linked at ${target}`);
    return;
  }
  symlinkSync(PROBE_SOURCE, target, 'dir');
  console.log(`linked ${target} -> ${PROBE_SOURCE}`);
  console.log('Restart ComfyUI to register it: systemctl --user restart comfyui.service');
}

if (process.argv.includes('--install')) {
  installProbe();
  process.exit(0);
}

// The mobile preview setting is persisted client-side and defaults to off, so
// the run would produce nothing at all unless we seed it before the app boots.
const seedSettings = (previewMethod) => {
  const key = 'generation-settings-storage';
  const existing = (() => {
    try { return JSON.parse(localStorage.getItem(key)) ?? {}; } catch { return {}; }
  })();
  localStorage.setItem(key, JSON.stringify({
    ...existing,
    state: { ...(existing.state ?? {}), previewMethod },
    version: existing.version ?? 0,
  }));
};

let browser;
const browserFailures = [];

try {
  const stats = await fetch(`${SERVER}/system_stats`, { headers: authHeaders() }).catch(() => null);
  assert(stats?.status !== 401, `${SERVER} needs credentials; pass --token`);
  assert(stats?.ok, `ComfyUI is not reachable at ${SERVER}`);

  const objectInfo = await fetch(`${SERVER}/object_info/${PROBE_TYPE}`, { headers: authHeaders() });
  const probeRegistered = objectInfo.ok && Object.keys(await objectInfo.json()).length > 0;
  if (!probeRegistered) {
    console.error(
      `${PROBE_TYPE} is not registered on this server.\n`
      + '  node scripts/latent-preview-smoke.mjs --install\n'
      + '  systemctl --user restart comfyui.service',
    );
    process.exit(2);
  }

  browser = await chromium.launch(chromiumLaunchOptions());
  const context = await browser.newContext({
    viewport: { width: 1100, height: 850 },
    serviceWorkers: 'block',
  });
  if (TOKEN) {
    await context.addCookies([{
      name: 'session', value: TOKEN, domain: new URL(SERVER).hostname, path: '/',
    }]);
  }
  await context.addInitScript(seedSettings, PREVIEW_METHOD);

  const page = await context.newPage();
  page.on('console', (message) => {
    // The parser logs exactly once when it cannot decode a frame. That line is
    // a failure here by definition — it is the symptom this smoke exists for.
    if (message.text().includes('undecodable binary preview frame')) {
      browserFailures.push(`parser rejected a frame: ${message.text()}`);
    }
    if (message.type() === 'error') browserFailures.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => browserFailures.push(`pageerror: ${error.message}`));

  console.log(`Latent preview smoke — ${SERVER} (preview_method=${PREVIEW_METHOD}, batch=${BATCH})`);
  await page.goto(APP, { waitUntil: 'networkidle' });

  await page.getByLabel('Menu').click();
  const workflowInput = page.locator('input[type="file"][accept*=".json"]').first();
  await workflowInput.setInputFiles(probeWorkflowUpload());

  const runButton = page.getByRole('button', { name: /^Run$/ });
  await runButton.waitFor({ state: 'visible' });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(
    (button) => button.textContent?.trim() === 'Run' && !button.disabled,
  ));
  console.log('  PASS  imported the probe workflow');

  const card = page.locator(`#node-card-${NODE_ID}`);
  await card.scrollIntoViewIfNeeded();

  const promptResponse = page.waitForResponse((response) => (
    response.url().endsWith('/api/prompt') && response.request().method() === 'POST'
  ));
  await runButton.click();
  const response = await promptResponse;
  assert(response.ok(), `/api/prompt answered ${response.status()}`);
  const queued = await response.json();
  assert(queued.prompt_id, '/api/prompt returned no prompt_id');

  // The preview only exists mid-run: the store revokes every blob URL when the
  // node finishes. Polling from Node and fetching afterwards would race that
  // revoke, so the wait AND the decode both happen inside the page, snapshotting
  // the bytes the instant a blob-backed <img> appears.
  const decoded = await page.evaluate(async ({ selector, timeoutMs }) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const image = document.querySelector(selector);
      const src = image?.getAttribute('src') ?? '';
      if (src.startsWith('blob:')) {
        let blob;
        try {
          blob = await (await fetch(src)).blob();
        } catch {
          // Revoked between the query and the fetch — the next frame will do.
          await new Promise((r) => setTimeout(r, 20));
          continue;
        }
        const head = Array.from(new Uint8Array(await blob.slice(0, 8).arrayBuffer()));
        try {
          const bitmap = await createImageBitmap(blob);
          return { found: true, ok: true, width: bitmap.width, height: bitmap.height, size: blob.size, head };
        } catch (error) {
          return { found: true, ok: false, error: String(error), size: blob.size, head };
        }
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return { found: false };
  }, { selector: `#node-card-${NODE_ID} .output-preview img`, timeoutMs: 60000 });

  assert(decoded.found, 'no latent preview ever reached the node card during the run');
  console.log('  PASS  a latent preview reached the node card mid-run');

  const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
  assert(
    decoded.ok,
    `the rendered latent preview does not decode (${decoded.error}); `
    + `${decoded.size} bytes starting ${hex(decoded.head)}`
    + ' — this is the 3.1.2 envelope bug, or a new one like it',
  );
  assert(decoded.width > 0 && decoded.height > 0, 'preview decoded to a zero-sized image');
  console.log(`  PASS  the rendered preview decodes (${decoded.width}x${decoded.height}, ${decoded.size} bytes)`);

  // Which previewer actually ran. "WrappedPreviewer" proves VHS's hook applied
  // and that the frames measured above came through its envelope, not the
  // stock one — without this the smoke could pass while testing nothing.
  const summary = await card.locator('.output-preview').textContent({ timeout: 60000 })
    .catch(() => '');
  const previewerMatch = /previewer=(\w+)/.exec(summary ?? '');
  if (previewerMatch) {
    console.log(`  INFO  server-side previewer: ${previewerMatch[1]}`);
    if (previewerMatch[1] !== 'WrappedPreviewer') {
      console.log('  INFO  VHS did not wrap this run — the stock envelope was under test');
    }
  }

  assert(browserFailures.length === 0, `browser reported failures:\n  ${browserFailures.join('\n  ')}`);
  console.log('\nLatent preview smoke passed.');
} catch (error) {
  console.error(`\nFAIL  ${error.message}`);
  if (browserFailures.length) console.error(`  ${browserFailures.join('\n  ')}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}

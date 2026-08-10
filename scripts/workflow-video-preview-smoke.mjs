#!/usr/bin/env node
/**
 * Targeted real-server check for workflow-panel video output previews.
 *
 * Imports a tiny model-free core workflow from scripts/fixtures, runs it, and
 * verifies that SaveVideo's executed output becomes a real inline player whose
 * source goes through the mobile seekable-video gateway. The generated file and
 * history entry are removed unless --keep-output is supplied.
 *
 *   node scripts/workflow-video-preview-smoke.mjs
 *   node scripts/workflow-video-preview-smoke.mjs --server http://127.0.0.1:8188
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
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
const KEEP_OUTPUT = process.argv.includes('--keep-output');
const FIXTURE = fileURLToPath(new URL('./fixtures/workflow-video-preview.json', import.meta.url));
const VIDEO_NODE_ID = '4';
const VHS_NODE_ID = '5';
const COMFY_ROOT = option('comfy-root', fileURLToPath(new URL('../../../', import.meta.url)));

function isolatedWorkflowUpload() {
  const workflow = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const saveVideo = workflow.nodes.find((node) => String(node.id) === VIDEO_NODE_ID);
  assert(saveVideo && Array.isArray(saveVideo.widgets_values), 'fixture has no SaveVideo node');
  saveVideo.widgets_values[0] = `video/mobile_workflow_preview_smoke_${Date.now()}`;
  return {
    name: 'workflow-video-preview.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(workflow)),
  };
}

function vhsPathWorkflowUpload(descriptor) {
  const absolutePath = join(
    COMFY_ROOT,
    descriptor.type === 'temp' ? 'temp' : descriptor.type === 'input' ? 'input' : 'output',
    descriptor.subfolder || '',
    descriptor.filename,
  );
  const workflow = {
    id: 'workflow-vhs-path-preview-smoke', revision: 0,
    last_node_id: Number(VHS_NODE_ID), last_link_id: 0,
    nodes: [{
      id: Number(VHS_NODE_ID), type: 'VHS_LoadVideoFFmpegPath', pos: [0, 0], size: [380, 360],
      flags: {}, order: 0, mode: 0, inputs: [],
      outputs: [
        { name: 'IMAGE', type: 'IMAGE', links: null },
        { name: 'frame_count', type: 'INT', links: null },
        { name: 'audio', type: 'AUDIO', links: null },
        { name: 'video_info', type: 'VHS_VIDEOINFO', links: null },
      ],
      properties: { cnr_id: 'comfyui-videohelpersuite', 'Node name for S&R': 'VHS_LoadVideoFFmpegPath' },
      widgets_values: {
        video: absolutePath,
        force_rate: 8,
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: 24,
        skip_first_frames: 0,
        select_every_nth: 1,
        videopreview: {
          hidden: false,
          paused: false,
          params: { filename: absolutePath, type: 'path', format: 'video/mp4' },
        },
      },
    }],
    links: [], groups: [], config: {}, extra: {}, version: 0.4,
  };
  return {
    name: 'workflow-vhs-path-preview.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(workflow)),
  };
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForHistory(page, promptId, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const history = await page.evaluate(async (id) => {
      const response = await fetch(`/api/history/${encodeURIComponent(id)}`, { cache: 'no-store' });
      return response.ok ? response.json() : null;
    }, promptId);
    if (history?.[promptId]) return history[promptId];
    await page.waitForTimeout(500);
  }
  throw new Error(`generation ${promptId} did not reach history within ${timeoutMs / 1000}s`);
}

function findVideoDescriptor(historyEntry) {
  const output = historyEntry?.outputs?.[VIDEO_NODE_ID] ?? {};
  for (const key of ['images', 'gifs', 'videos']) {
    for (const descriptor of output[key] ?? []) {
      if (/\.(mp4|webm|mkv|mov|avi|m4v)$/i.test(descriptor.filename ?? '')) {
        return descriptor;
      }
    }
  }
  return null;
}

let browser;
let page;
let promptId = null;
let videoDescriptor = null;
const browserFailures = [];

try {
  const stats = await fetch(`${SERVER}/system_stats`).catch(() => null);
  assert(stats?.ok, `ComfyUI is not reachable at ${SERVER}`);

  browser = await chromium.launch(chromiumLaunchOptions());
  const context = await browser.newContext({
    viewport: { width: 1100, height: 850 },
    serviceWorkers: 'block',
  });
  page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error' || (
      message.type() === 'warning' && message.text().includes('[video] Playback issue')
    )) browserFailures.push(`${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => browserFailures.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    if (failure && !/ERR_ABORTED/.test(failure.errorText)) {
      browserFailures.push(`request failed: ${request.url()} ${failure.errorText}`);
    }
  });

  console.log(`Workflow video preview smoke — ${SERVER}`);
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByLabel('Menu').click();
  const workflowInput = page.locator('input[type="file"][accept*=".json"]').first();
  await workflowInput.setInputFiles(isolatedWorkflowUpload());
  const runButton = page.getByRole('button', { name: /^Run$/ });
  await runButton.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('button')).some(
      (button) => button.textContent?.trim() === 'Run' && !button.disabled,
    ),
  );
  assert(await runButton.isEnabled(), 'workflow loaded but Run did not become enabled');
  console.log('  PASS  imported model-free core video workflow');

  // Keep the output node visible when the executed event arrives. Record
  // whether autoplay succeeds, then explicitly play as a compatibility check.
  const outputCard = page.locator(`#node-card-${VIDEO_NODE_ID}`);
  await outputCard.evaluate((element) => element.scrollIntoView({ block: 'start' }));

  const promptResponse = page.waitForResponse((response) => (
    response.url().endsWith('/api/prompt') && response.request().method() === 'POST'
  ));
  await runButton.click();
  const response = await promptResponse;
  assert(response.ok(), `/api/prompt answered ${response.status()}`);
  const queued = await response.json();
  promptId = queued.prompt_id;
  assert(promptId, '/api/prompt returned no prompt_id');

  const historyEntry = await waitForHistory(page, promptId);
  videoDescriptor = findVideoDescriptor(historyEntry);
  assert(videoDescriptor, 'SaveVideo emitted no video in images, gifs, or videos');
  console.log(`  PASS  generated ${videoDescriptor.type}/${videoDescriptor.subfolder}/${videoDescriptor.filename}`);

  await outputCard.scrollIntoViewIfNeeded();
  const video = outputCard.locator('video[data-workflow-output-video]');
  await video.waitFor({ state: 'visible', timeout: 30000 });
  const videoHandle = await video.elementHandle();
  assert(videoHandle, 'inline video element disappeared');
  const autoplayed = await video.evaluate((element) => (
    !element.paused && element.currentTime > 0
  ));
  await video.evaluate((element) => element.play());
  await page.waitForFunction(
    (element) => element.readyState >= HTMLMediaElement.HAVE_METADATA && element.currentTime > 0.25,
    videoHandle,
    { timeout: 30000 },
  );

  const mediaState = await video.evaluate((element) => {
    const media = /** @type {HTMLVideoElement} */ (element);
    const url = new URL(media.currentSrc || media.src, location.href);
    return {
      srcPath: url.pathname,
      width: media.videoWidth,
      height: media.videoHeight,
      duration: media.duration,
      currentTime: media.currentTime,
      paused: media.paused,
      controls: media.controls,
      muted: media.muted,
      playsInline: media.playsInline,
      preload: media.preload,
    };
  });

  assert(mediaState.srcPath === '/mobile/api/video/playable', `player source is ${mediaState.srcPath}`);
  assert(mediaState.width === 320 && mediaState.height === 192,
    `video dimensions are ${mediaState.width}x${mediaState.height}`);
  assert(mediaState.duration >= 2.5, `video duration is ${mediaState.duration}s`);
  assert(
    mediaState.currentTime > 0.25,
    `inline playback did not advance (paused=${mediaState.paused}, time=${mediaState.currentTime}s)`,
  );
  assert(mediaState.controls && mediaState.muted && mediaState.playsInline,
    'inline player is missing controls, muted, or playsInline');
  assert(mediaState.preload === 'metadata', `single-video preload is ${mediaState.preload}`);
  assert(await outputCard.locator('img[src*=".mp4"], img[src*=".webm"]').count() === 0,
    'video output was also rendered through an img element');
  console.log(
    `  PASS  inline player decoded ${mediaState.width}x${mediaState.height}`
    + ` and advanced to ${mediaState.currentTime.toFixed(2)}s`
    + ` (${autoplayed ? 'autoplay' : 'explicit play'})`,
  );

  const vhsInstalled = await page.evaluate(async () => {
    const response = await fetch('/api/object_info/VHS_LoadVideoFFmpegPath');
    if (!response.ok) return false;
    const info = await response.json();
    return Boolean(info?.VHS_LoadVideoFFmpegPath);
  });
  if (vhsInstalled) {
    // Reuse the picker captured before the first import. This guards against a
    // regression where closing the app menu unmounts its hidden file input.
    await workflowInput.setInputFiles(vhsPathWorkflowUpload(videoDescriptor));
    const vhsCard = page.locator(`#node-card-${VHS_NODE_ID}`);
    await vhsCard.scrollIntoViewIfNeeded();
    const vhsVideo = vhsCard.locator('video[data-workflow-output-video]');
    await vhsVideo.waitFor({ state: 'visible', timeout: 30000 });
    const vhsHandle = await vhsVideo.elementHandle();
    assert(vhsHandle, 'VHS FFmpeg Path preview element disappeared');
    await vhsVideo.evaluate((element) => element.play());
    await page.waitForFunction(
      (element) => element.readyState >= HTMLMediaElement.HAVE_METADATA && element.currentTime > 0.25,
      vhsHandle,
      { timeout: 30000 },
    );
    const vhsState = await vhsVideo.evaluate((element) => {
      const media = /** @type {HTMLVideoElement} */ (element);
      const url = new URL(media.currentSrc || media.src, location.href);
      return {
        srcPath: url.pathname,
        sourceType: url.searchParams.get('type'),
        forceRate: url.searchParams.get('force_rate'),
        width: media.videoWidth,
        height: media.videoHeight,
        currentTime: media.currentTime,
        loop: media.loop,
        playsInline: media.playsInline,
      };
    });
    assert(vhsState.srcPath === '/vhs/viewvideo', `VHS player source is ${vhsState.srcPath}`);
    assert(vhsState.sourceType === 'path', `VHS source type is ${vhsState.sourceType}`);
    assert(vhsState.forceRate === '8', `VHS force_rate is ${vhsState.forceRate}`);
    assert(vhsState.width === 320 && vhsState.height === 192,
      `VHS preview dimensions are ${vhsState.width}x${vhsState.height}`);
    assert(vhsState.currentTime > 0.25 && vhsState.loop && vhsState.playsInline,
      'VHS FFmpeg Path preview did not play inline and loop');
    console.log(
      `  PASS  VHS Load Video FFmpeg (Path) decoded ${vhsState.width}x${vhsState.height}`
      + ` and advanced to ${vhsState.currentTime.toFixed(2)}s`,
    );
  } else {
    console.log('  SKIP  VHS Load Video FFmpeg (Path) is not installed on this server');
  }

  assert(browserFailures.length === 0, browserFailures.join('\n'));
  console.log('  PASS  no browser or playback errors');
  console.log('\nWORKFLOW VIDEO PREVIEW SMOKE PASSED');
} catch (error) {
  console.error(`\nWORKFLOW VIDEO PREVIEW SMOKE FAILED — ${error?.message ?? error}`);
  if (browserFailures.length) {
    for (const failure of [...new Set(browserFailures)]) console.error(`  - ${failure}`);
  }
  process.exitCode = 1;
} finally {
  if (page && !KEEP_OUTPUT) {
    if (videoDescriptor) {
      const path = videoDescriptor.subfolder
        ? `${videoDescriptor.subfolder}/${videoDescriptor.filename}`
        : videoDescriptor.filename;
      await page.evaluate(async ({ path, source }) => {
        await fetch('/mobile/api/files', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, source }),
        });
      }, { path, source: videoDescriptor.type }).catch(() => {});
    }
    if (promptId) {
      await page.evaluate(async (id) => {
        await fetch('/api/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delete: [id] }),
        });
      }, promptId).catch(() => {});
    }
  }
  await browser?.close();
}

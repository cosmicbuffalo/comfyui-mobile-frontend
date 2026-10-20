#!/usr/bin/env node
/** Production frontend benchmark with synthetic backend data; no ComfyUI required.
 * node scripts/profile-browser.mjs --nodes 100 --cpu 6 --output /tmp/browser.json
 * Uses real DOM controls. CPU slowdown is relative to the host, not phone emulation.
 */
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { chromium } from 'playwright';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';

const option = (key, fallback) => {
  const i = process.argv.indexOf(`--${key}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const count = Number(option('nodes', 100));
const cpu = Number(option('cpu', 1));
const choices = Number(option('choices', 1000));
const mbps = Number(option('mbps', 0));
const latency = Number(option('latency', 150));
const blur = option('blur', 'off') === 'on';
const lowResource = option('low-resource', 'off') === 'on';
const longOptions = process.argv.includes('--long-options');
const choiceFor = (i) => `folder/${longOptions && i % 7 === 1 ? 'a-very-long-model-folder-name-'.repeat(8) + '/' : ''}option-${i}`;
const output = resolve(option('output', '/tmp/cueforge-browser-profile.json'));
if (![count, choices].every((n) => Number.isSafeInteger(n) && n > 0)
  || !Number.isFinite(cpu) || cpu < 1
  || !Number.isFinite(mbps) || mbps < 0
  || !Number.isFinite(latency) || latency < 0) {
  throw new Error('nodes/choices must be positive integers, cpu >= 1, and mbps/latency >= 0');
}
await mkdir(dirname(output), { recursive: true });
const dist = resolve(import.meta.dirname, '../dist');
const definition = {
  input: { required: {
    text: ['STRING', { multiline: true, default: 'A benchmark prompt' }],
    amount: ['INT', { default: 20, min: 0, max: 10000, step: 1 }],
    enabled: ['BOOLEAN', { default: true }],
    choice: [Array.from({ length: choices }, (_, i) => choiceFor(i))],
  } },
  input_order: { required: ['text', 'amount', 'enabled', 'choice'] },
  output: [], output_name: [], output_is_list: [], output_node: false,
  name: 'ResourceProbe', display_name: 'Resource probe', category: 'testing',
};
const workflow = {
  id: 'resource-probe', version: 0.4, revision: 0,
  last_node_id: count, last_link_id: 0, links: [], groups: [], config: {}, extra: {},
  nodes: Array.from({ length: count }, (_, i) => ({
    id: i + 1, type: 'ResourceProbe', title: `Probe ${i + 1}`,
    pos: [0, i * 400], size: [300, 350], flags: {}, order: i, mode: 0,
    inputs: [], outputs: [], properties: { 'Node name for S&R': 'ResourceProbe' },
    widgets_values: ['A benchmark prompt', 20, true, 'folder/option-0'],
  })),
};
const unknown = new Set();
const userdata = new Map([
  ['mobile/workflow_hidden.json', '[]'],
  ['mobile/workflow_favorites.json', '[]'],
  ['mobile/workflow_lineages.json', '{}'],
  ['mobile-debug.log', ''],
]);
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const fixtures = {
      '/api/object_info': { ResourceProbe: definition },
      '/api/queue': { queue_running: [], queue_pending: [] },
      '/api/history': {}, '/api/v2/userdata': [],
      '/api/workflow_templates': {}, '/embeddings': [],
      '/mobile/api/preferences': { autocompleteEnabled: false, telemetryEnabled: false, civitaiMetadataEnabled: false },
      '/mobile/api/files/state': { favorite: [], reject: [], hidden: [] },
      '/mobile/api/feedback/follows': { follows: [] },
      '/mobile/api/history-count': { count: 0, hidden_count: 0 },
      '/mobile/api/cpu-stats': { cpu_percent: 0 },
      '/mobile/api/capabilities': {},
      '/system_stats': { system: {}, devices: [] },
    };
    if (path.startsWith('/api/userdata/')) {
      const key = decodeURIComponent(path.slice('/api/userdata/'.length));
      if (req.method === 'POST') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        userdata.set(key, Buffer.concat(chunks).toString());
      }
      res.writeHead(userdata.has(key) ? 200 : 404, { 'Content-Type': key.endsWith('.json') ? 'application/json' : 'text/plain' });
      res.end(userdata.get(key) ?? '');
      return;
    }
    if (path in fixtures) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fixtures[path]));
      return;
    }
    if (path.startsWith('/api/') || path.startsWith('/mobile/api/') || path.startsWith('/auth/')) {
      unknown.add(`${req.method} ${path}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    const rel = path.startsWith('/mobile/assets/') ? path.slice('/mobile/'.length) : 'index.html';
    let file = resolve(dist, rel);
    if (!file.startsWith(`${dist}/`)) { res.writeHead(403); res.end(); return; }
    const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(file)] ?? 'application/octet-stream';
    let encoding;
    if ((req.headers['accept-encoding'] ?? '').includes('br') && await stat(`${file}.br`).catch(() => null)) {
      file += '.br'; encoding = 'br';
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': contentType, ...(encoding ? { 'Content-Encoding': encoding } : {}) });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let browser;
let page;
const errors = [];
const report = { fixture: { nodes: count, choices, workflowBytes: Buffer.byteLength(JSON.stringify(workflow)) }, cpuSlowdown: cpu, network: mbps ? { downloadMbps: mbps, uploadMbps: mbps / 2, latencyMs: latency } : 'unthrottled loopback', blur, hostCPU: cpus()[0]?.model, productionIndexSHA256: createHash('sha256').update(await readFile(resolve(dist, 'index.html'))).digest('hex'), phases: [], errors };
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true });
  const browserCDP = await browser.newBrowserCDPSession();
  report.gpu = (await browserCDP.send('SystemInfo.getInfo')).gpu.devices;
  const browserMemory = async () => {
    const { processInfo } = await browserCDP.send('SystemInfo.getProcessInfo');
    return Promise.all(processInfo.map(async ({ id, type }) => {
      const raw = await readFile(`/proc/${id}/smaps_rollup`, 'utf8').catch(() => '');
      const kib = (name) => Number(raw.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
      return { type, rssMiB: kib('Rss') / 1024, pssMiB: kib('Pss') / 1024, privateMiB: (kib('Private_Clean') + kib('Private_Dirty')) / 1024 };
    }));
  };
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await context.routeWebSocket(/\/ws(?:\?|\/|$)/, (ws) => {
    if (new URL(ws.url()).pathname === '/ws') ws.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: 'resource-profile' } }));
    ws.onMessage(() => {});
  });
  await context.addInitScript(({ blur, lowResource }) => {
    localStorage.setItem('generation-settings-storage', JSON.stringify({ state: { lowResourceMode: lowResource }, version: 1 }));
    if (!blur) document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }';
      document.head.appendChild(style);
    });
    window.__profile = { events: [], longTasks: [] };
    new PerformanceObserver((list) => window.__profile.longTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })))).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((list) => window.__profile.events.push(...list.getEntries().map(({ name, startTime, duration, processingStart, processingEnd, interactionId }) => ({ name, startTime, duration, processingStart, processingEnd, interactionId })))).observe({ type: 'event', buffered: true, durationThreshold: 16 });
  }, { blur, lowResource });
  report.lowResourceMode = lowResource;
  report.fixture.longOptions = longOptions;
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await cdp.send('Performance.enable');
  if (mbps) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: mbps * 1e6 / 8, uploadThroughput: mbps * 1e6 / 16 });
  }
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
  const snapshot = async (name, action) => {
    const captureCPU = process.argv.includes('--cpu-profile') && name === 'number-commit';
    if (captureCPU) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
    const before = await metrics();
    const start = await page.evaluate(() => performance.now());
    const wall = performance.now();
    await action();
    // Include the 300 ms text-commit and 250 ms persistence windows.
    await page.waitForTimeout(1000);
    const after = await metrics();
    if (captureCPU) {
      const { profile } = await cdp.send('Profiler.stop');
      await writeFile(output.replace(/\.json$/, '') + '.cpuprofile', JSON.stringify(profile));
    }
    const entries = await page.evaluate((start) => ({
      events: window.__profile.events.filter((e) => e.startTime >= start),
      longTasks: window.__profile.longTasks.filter((e) => e.startTime >= start),
      domElements: document.querySelectorAll('*').length,
      renderedOptions: document.querySelectorAll('.rs__option').length,
    }), start);
    report.phases.push({ name, wallMsIncludingSettle: performance.now() - wall, heapUsedMiB: after.JSHeapUsedSize / 2**20, browserProcesses: await browserMemory(),
      taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000, ...entries });
    console.log(name, JSON.stringify({ taskMs: report.phases.at(-1).taskMs, heapUsedMiB: report.phases.at(-1).heapUsedMiB, renderedOptions: entries.renderedOptions, maxInteractionMs: Math.max(0, ...entries.events.filter((e) => e.interactionId).map((e) => e.duration)), maxLongTaskMs: Math.max(0, ...entries.longTasks.map((e) => e.duration)) }));
  };
  const navigationStart = performance.now();
  await page.goto(`http://127.0.0.1:${server.address().port}/mobile/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByLabel('Menu', { exact: true }).waitFor();
  report.menuReadyMs = performance.now() - navigationStart;
  await page.waitForTimeout(3500);
  await page.getByLabel('Menu', { exact: true }).click();
  await page.locator('input[type="file"][accept*=".json"]').first().setInputFiles({ name: 'resource-probe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(workflow)) });
  await page.locator('#node-card-1 input[type="number"]').first().waitFor();
  await page.waitForTimeout(1500);
  await snapshot('idle', async () => {});
  const card = page.locator('#node-card-1');
  await snapshot('number-commit', async () => {
    const input = card.locator('input[type="number"]').first();
    await input.fill('21');
    await input.press('Tab');
    if (await input.inputValue() !== '21') throw new Error('Number edit failed');
  });
  await snapshot('boolean-select', async () => {
    await card.locator('.rs__control').first().click();
    await page.getByRole('option', { name: 'false', exact: true }).click();
    if (!(await card.locator('.rs__single-value').first().innerText()).includes('false')) throw new Error('Boolean selection failed');
  });
  await snapshot('picker-open', async () => {
    await card.locator('.combo-control-trigger').click();
    await page.locator('.rs__option').first().waitFor();
  });
  await snapshot('picker-search', async () => {
    await page.locator('.rs__control input:visible').last().pressSequentially('option-99', { delay: 50 });
  });
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await snapshot('text-enter', async () => {
    await card.getByText('A benchmark prompt', { exact: true }).click();
    const modal = page.locator('textarea:visible').last();
    await modal.press('End');
    await modal.press('Enter');
    await modal.pressSequentially('Benchmark text', { delay: 50 });
  });
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  if (process.argv.includes('--check-picker')) {
    const inScrollViewport = async (locator) => {
      await page.waitForFunction((id) => {
        const option = document.getElementById(id);
        const list = option?.closest('.rs__menu-list');
        const scroll = list && (getComputedStyle(list).overflowY === 'visible' ? list.closest('.scroll-container') : list);
        if (!option || !scroll) return false;
        const row = option.getBoundingClientRect();
        const view = scroll.getBoundingClientRect();
        return row.top >= view.top - 1 && row.bottom <= view.bottom + 1;
      }, await locator.getAttribute('id'), { timeout: 3000 });
    };
    await card.locator('.combo-control-trigger').click();
    const input = page.locator('.rs__control input:visible').last();
    await input.press('End');
    const last = page.getByRole('option', { name: choiceFor(choices - 1), exact: true });
    await last.waitFor({ state: 'visible' });
    await inScrollViewport(last);
    const activeId = await input.getAttribute('aria-activedescendant');
    if (!activeId || !(await page.locator(`[id="${activeId}"]`).count())) throw new Error('Keyboard focus points to an unmounted option');
    await input.press('Enter');
    await card.locator('.combo-control-trigger').click();
    await page.waitForTimeout(250);
    report.pickerDebug = await page.evaluate(() => ({
      trigger: document.querySelector('#node-card-1 .combo-control-trigger')?.textContent,
      active: document.querySelector('.rs__control input:focus')?.getAttribute('aria-activedescendant'),
      options: [...document.querySelectorAll('.rs__option')].map((el) => el.textContent),
      lists: [...document.querySelectorAll('.rs__menu-list, .fullscreen-widget-modal .scroll-container')].map((el) => ({ className: el.className, scrollTop: el.scrollTop, height: el.clientHeight, scrollHeight: el.scrollHeight, overflow: getComputedStyle(el).overflowY })),
    }));
    await page.locator('.rs__option--is-selected').waitFor({ state: 'visible', timeout: 3000 });
    await inScrollViewport(page.locator('.rs__option--is-selected'));
    // Keep hover from changing focus while testing keyboard resumption after
    // a user scrolls away from the already-focused final option.
    await page.mouse.move(0, 0);
    await page.locator('.rs__menu-list').evaluate((list) => {
      const scroll = getComputedStyle(list).overflowY === 'visible' ? list.closest('.scroll-container') : list;
      scroll.dispatchEvent(new WheelEvent('wheel', { deltaY: -100000 }));
      scroll.scrollTop = 0;
      scroll.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(250);
    await page.getByRole('option', { name: 'folder/option-0', exact: true }).waitFor({ state: 'visible' });
    await inScrollViewport(page.getByRole('option', { name: 'folder/option-0', exact: true }));
    await page.waitForTimeout(250);
    await page.getByRole('option', { name: 'folder/option-0', exact: true }).waitFor({ state: 'visible' });
    await input.press('End');
    await last.waitFor({ state: 'visible' });
    await inScrollViewport(last);
    report.pickerChecks = { keyboardEnd: true, activeDescendantMounted: true, selectedValueOnReopen: true, scrollBackToStart: true, keyboardResumesAfterScroll: true, viewportBoundsChecked: true, renderedOptions: await page.locator('.rs__option').count() };
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  }
  await page.waitForTimeout(750);
  report.committedValues = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('comfy-mobile-frontend', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const stored = await new Promise((resolve, reject) => {
        const request = db.transaction('zustand').objectStore('zustand').get('workflow-storage');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return JSON.parse(stored).state.workflow.nodes.find((node) => node.id === 1).widgets_values;
    } finally { db.close(); }
  });
  if (report.committedValues[1] !== 21 || report.committedValues[2] !== false || !report.committedValues[0].includes('\nBenchmark text')) {
    throw new Error(`Edits did not persist: ${JSON.stringify(report.committedValues)}`);
  }
  if (process.argv.includes('--check-preset')) {
    await page.getByLabel('Menu', { exact: true }).click();
    const preferences = page.getByRole('button', { name: 'Preferences', exact: true });
    if (!(await preferences.isVisible())) await page.getByRole('button', { name: 'Server', exact: true }).click();
    await preferences.click();
    const toggle = page.getByRole('switch', { name: 'Low resource mode', exact: true });
    if (await page.getByText('Blur effects', { exact: true }).count()) throw new Error('Old blur switch is still present');
    await toggle.click();
    await page.waitForFunction((expected) => document.documentElement.classList.contains('low-resource') === expected, !lowResource);
    await toggle.click();
    await page.waitForFunction((expected) => document.documentElement.classList.contains('low-resource') === expected, lowResource);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('generation-settings-storage')));
    if (stored.version !== 1 || stored.state.lowResourceMode !== lowResource) throw new Error('Low resource setting did not persist');
    report.presetChecks = { singleSwitch: true, appliesImmediately: true, persists: true };
  }
  report.resources = await page.evaluate(() => performance.getEntriesByType('resource').map(({ name, transferSize, encodedBodySize, decodedBodySize }) => ({ path: new URL(name).pathname, transferSize, encodedBodySize, decodedBodySize })));
  report.finalBrowserProcesses = await browserMemory();
  report.unsupportedFixtureRequests = [...unknown];
  await page.screenshot({ path: output.replace(/\.json$/, '') + '.png' });
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
} catch (e) {
  report.failure = e.stack;
  report.failureViewport = await page?.evaluate(() => ({
    focus: document.querySelector('.rs__control input:focus')?.getAttribute('aria-activedescendant'),
    options: [...document.querySelectorAll('.rs__option')].map((el) => ({ value: el.textContent, id: el.id, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })),
    lists: [...document.querySelectorAll('.rs__menu-list, .fullscreen-widget-modal .scroll-container')].map((el) => ({ scrollTop: el.scrollTop, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, height: el.clientHeight, total: el.scrollHeight })),
  })).catch(() => null);
  await page?.screenshot({ path: output.replace(/\.json$/, '') + '.png' }).catch(() => {});
  throw e;
} finally {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await new Promise((r) => server.close(r));
}

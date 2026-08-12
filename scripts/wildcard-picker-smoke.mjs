#!/usr/bin/env node
/**
 * Targeted real-server check for the Impact-Pack wildcard picker.
 *
 * Loads a single ImpactWildcardProcessor from scripts/fixtures and verifies the
 * "Select to add Wildcard" dropdown — which ships with only a placeholder and is
 * filled from the browser at run time — actually offers the server's wildcards,
 * that picking one appends it to the prompt box, and that the dropdown's own
 * slot keeps the placeholder so the workflow round-trips to desktop unchanged.
 *
 * Nothing is queued and nothing is written to disk.
 *
 *   node scripts/wildcard-picker-smoke.mjs
 *   node scripts/wildcard-picker-smoke.mjs --server http://127.0.0.1:8188
 *   node scripts/wildcard-picker-smoke.mjs --fixture path/to/workflow.json
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

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
const FIXTURE = option(
  'fixture',
  fileURLToPath(new URL('./fixtures/wildcard-picker.json', import.meta.url)),
);
const PLACEHOLDER = 'Select the Wildcard to add to the text';

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

function workflowUpload() {
  return {
    name: 'wildcard-picker.json',
    mimeType: 'application/json',
    buffer: Buffer.from(readFileSync(FIXTURE, 'utf8')),
  };
}

/** The wildcard dropdown's own control, addressed via its label. */
function picker(page) {
  return page.locator('.combo-control-root').filter({
    has: page.locator('label', { hasText: 'Select to add Wildcard' }),
  }).first();
}

/**
 * The prompt box and the value the picker is displaying. That displayed value
 * is rendered straight from the node's widgets_values slot, so it doubles as
 * proof of what the workflow would serialize.
 */
async function readCard(page) {
  const promptText = await page.locator('#node-list-container textarea').first()
    .inputValue().catch(() => null);
  const shown = await picker(page).locator('.rs__single-value').first()
    .textContent().catch(() => null);
  return { promptText, pickerValue: shown?.trim() ?? null };
}

let browser;
let page;
const browserFailures = [];

try {
  const stats = await fetch(`${SERVER}/system_stats`).catch(() => null);
  assert(stats?.ok, `ComfyUI is not reachable at ${SERVER}`);

  const listResponse = await fetch(`${SERVER}/impact/wildcards/list`).catch(() => null);
  assert(
    listResponse?.ok,
    'Impact Pack is not installed on this server (no /impact/wildcards/list) — nothing to smoke test',
  );
  const serverWildcards = (await listResponse.json()).data ?? [];
  assert(
    Array.isArray(serverWildcards) && serverWildcards.length > 0,
    'the server reports no wildcards; add one under ComfyUI/custom_nodes/comfyui-impact-pack/wildcards to run this check',
  );
  console.log(`Wildcard picker smoke — ${SERVER}`);
  console.log(`  server reports ${serverWildcards.length} wildcard(s): ${serverWildcards.join(', ')}`);

  browser = await chromium.launch(chromiumLaunchOptions());
  const context = await browser.newContext({
    viewport: { width: 1100, height: 850 },
    serviceWorkers: 'block',
  });
  page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') browserFailures.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => browserFailures.push(`pageerror: ${error.message}`));
  // The list is cached for the page's lifetime and shared by every card, so a
  // whole session should cost exactly one request no matter how much we poke.
  let listRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/impact/wildcards/list')) listRequests += 1;
  });

  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByLabel('Menu').click();
  await page.locator('input[type="file"][accept*=".json"]').first().setInputFiles(workflowUpload());
  await page.getByRole('button', { name: /^Run$/ }).waitFor({ state: 'visible' });

  assert(await picker(page).count() > 0, 'no "Select to add Wildcard" dropdown rendered on the card');
  const before = await readCard(page);
  assert(before.promptText !== null, 'the ImpactWildcardProcessor card rendered no prompt box');
  assert(
    before.pickerValue === PLACEHOLDER,
    `picker should start on its placeholder, shows ${JSON.stringify(before.pickerValue)}`,
  );
  console.log(`  prompt box starts as: ${JSON.stringify(before.promptText)}`);

  // Open the picker and read what it actually offers.
  await picker(page).locator('.rs__control').click();
  await page.locator('.rs__option').first().waitFor({ state: 'visible' });
  const offered = await page.locator('.rs__option').allTextContents();

  const missing = serverWildcards.filter((wildcard) => !offered.includes(wildcard));
  assert(
    missing.length === 0,
    `dropdown is missing wildcards the server knows about: ${missing.join(', ')}\n  offered: ${JSON.stringify(offered)}`,
  );
  console.log(`  dropdown offers all ${serverWildcards.length} server wildcard(s) plus the placeholder`);

  // Pick the first real wildcard.
  const picked = serverWildcards[0];
  await page.locator('.rs__option', { hasText: picked }).first().click();
  await page.waitForTimeout(500);

  const after = await readCard(page);
  const expectedText = before.promptText ? `${before.promptText}, ${picked}` : picked;
  assert(
    after.promptText === expectedText,
    `prompt box should have become ${JSON.stringify(expectedText)}, got ${JSON.stringify(after.promptText)}`,
  );
  console.log(`  picking ${picked} appended it: ${JSON.stringify(after.promptText)}`);

  // The dropdown is a menu, not a value. What it displays is rendered from the
  // node's widgets_values slot, so it still reading the placeholder is proof
  // the slot was untouched and the workflow round-trips to desktop unchanged.
  assert(
    after.pickerValue === PLACEHOLDER,
    `the picker's slot should still hold the placeholder, shows ${JSON.stringify(after.pickerValue)}`,
  );
  console.log('  picker slot still holds the placeholder (workflow round-trips unchanged)');

  // A second pick appends again rather than replacing.
  await picker(page).locator('.rs__control').click();
  await page.locator('.rs__option').first().waitFor({ state: 'visible' });
  const second = serverWildcards[1] ?? serverWildcards[0];
  await page.locator('.rs__option', { hasText: second }).first().click();
  await page.waitForTimeout(500);
  const twice = await readCard(page);
  assert(
    twice.promptText === `${expectedText}, ${second}`,
    `a second pick should append again, got ${JSON.stringify(twice.promptText)}`,
  );
  console.log(`  a second pick appended too: ${JSON.stringify(twice.promptText)}`);

  assert(
    listRequests === 1,
    `the wildcard list should be fetched exactly once per page load, saw ${listRequests} request(s)`,
  );
  console.log(`  fetched the wildcard list ${listRequests}× for the whole session`);

  assert(browserFailures.length === 0, `browser reported errors:\n  ${browserFailures.join('\n  ')}`);
  console.log('\nPASS — wildcard picker populates, inserts, and keeps its slot clean');
} catch (error) {
  console.error(`\nFAIL — ${error.message}`);
  if (browserFailures.length) console.error(`browser noise:\n  ${browserFailures.join('\n  ')}`);
  if (page) {
    await page.screenshot({ path: '/tmp/wildcard-smoke-failure.png' }).catch(() => {});
    console.error('screenshot: /tmp/wildcard-smoke-failure.png');
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
}

#!/usr/bin/env node
/**
 * End-to-end test for the mask editor.
 *
 * Unit tests cannot reach this feature's real risks. Everything that has
 * actually gone wrong in it lived either in a canvas operation (which jsdom
 * cannot run) or in the seam between modules that were each individually
 * correct:
 *
 *   - `/view?channel=a` returns transparent black, not greyscale, so reading
 *     the wrong channel opened every image fully masked. The unit test restated
 *     the same wrong assumption and passed.
 *   - The reopen path kept " [input]" glued to the filename, so the ref no
 *     longer matched the one a save had recorded and undo history was lost
 *     across openings.
 *
 * So this drives the real component in a real browser against an in-page fake
 * of ComfyUI that reimplements the same pixel operations server.py performs
 * (see fixtures/mask-e2e/fakeComfy.ts).
 *
 *   node scripts/mask-editor-e2e.mjs
 *   node scripts/mask-editor-e2e.mjs --headed --keep
 *
 * Requires playwright and a chromium: npx playwright install chromium
 * (or set CHROMIUM_PATH to a system browser).
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const REPO = resolve(import.meta.dirname, '..');
const PORT = 5196;
const headed = process.argv.includes('--headed');
const keep = process.argv.includes('--keep');

// ---------------------------------------------------------------------------
// Dev server
// ---------------------------------------------------------------------------

const configPath = join(REPO, 'scripts/fixtures/mask-e2e/vite.config.mjs');

const vite = spawn('npx', ['vite', '--config', configPath], {
  cwd: REPO, stdio: keep ? 'inherit' : 'ignore',
});

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('vite did not start');
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

let failures = 0;
const pageErrors = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  await waitForServer();

  const browser = await chromium.launch({
    headless: !headed,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    // The harness page declares no favicon; that 404 is not a product error.
    if (m.type() === 'error' && !m.text().includes('404')) {
      pageErrors.push('console: ' + m.text());
    }
  });
  const load = async () => {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.maskE2EReady === true);
  };
  await load();

  const open = async () => {
    await page.evaluate(() => window.maskE2E.open());
    await page.waitForSelector('.mask-editor-canvas', { state: 'visible' });
    // Wait for the load to settle rather than a fixed sleep.
    await page.waitForFunction(() => !document.querySelector('.mask-editor-loading'));
    await page.waitForTimeout(150);
  };

  /** Colour at the centre of the visible canvas. */
  const centre = () => page.evaluate(() => {
    const c = document.querySelector('.mask-editor-canvas');
    const d = c.getContext('2d').getImageData(
      Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
    return [d[0], d[1], d[2]];
  });

  const paintAcrossCentre = async () => {
    const box = await page.locator('.mask-editor-canvas').boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2 - 60, y);
    await page.mouse.down();
    for (let dx = -60; dx <= 60; dx += 10) {
      await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(150);
  };

  /** Dispatch a wheel event of a chosen shape at the canvas centre. */
  const wheel = (init) => page.evaluate((detail) => {
    const c = document.querySelector('.mask-editor-canvas');
    const rect = c.getBoundingClientRect();
    c.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaMode: 0, deltaX: 0, deltaY: 0, ...detail,
    }));
  }, init);

  const clickTool = (index) =>
    page.locator('.mask-editor-tool').nth(index).click();

  // The image's top-left corner within the canvas, which moves when the view
  // pans. Measured on both axes: fit-to-view can letterbox on either one, so a
  // single axis is not always free to move.
  const readPan = () => page.evaluate(() => {
    const c = document.querySelector('.mask-editor-canvas');
    const ctx = c.getContext('2d');
    const row = ctx.getImageData(0, Math.floor(c.height / 2), c.width, 1).data;
    const col = ctx.getImageData(Math.floor(c.width / 2), 0, 1, c.height).data;
    let left = -1;
    for (let x = 0; x < c.width; x++) if (row[x * 4 + 3] !== 0) { left = x; break; }
    let top = -1;
    for (let y = 0; y < c.height; y++) if (col[y * 4 + 3] !== 0) { top = y; break; }
    return `${left},${top}`;
  });

  /**
   * Read a pixel at a fixed offset from the image's own top-left corner.
   *
   * Screen-space sampling is useless across a pan -- the content under a fixed
   * screen point legitimately changes -- so anything asserting "this gesture
   * did not alter the image" has to follow the image.
   */
  const sampleImage = async (dx, dy) => {
    const [left, top] = (await readPan()).split(',').map(Number);
    if (left < 0 || top < 0) return null;
    return page.evaluate(([x, y]) => {
      const c = document.querySelector('.mask-editor-canvas');
      const d = c.getContext('2d').getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    }, [left + dx, top + dy]);
  };

  /**
   * Fit, then zoom out, so the image sits clear of every canvas edge. Panning
   * can then be observed on either axis; at plain fit the image spans the full
   * width and its left edge cannot move.
   */
  const framed = async () => {
    await page.locator('.mask-editor-fit').click();
    await page.waitForTimeout(120);
    for (let i = 0; i < 3; i++) {
      await wheel({ deltaY: 120 });
      await page.waitForTimeout(60);
    }
  };


  /**
   * Click a toolbar control, failing fast instead of waiting out the default
   * timeout. A disabled Undo is itself a symptom, and letting it hang for 30s
   * buries every check after it.
   */
  const clickControl = async (selector) => {
    try {
      await page.locator(selector).click({ timeout: 2000 });
      return true;
    } catch {
      check(`${selector} was clickable`, false, 'still disabled');
      return false;
    }
  };

  console.log('\nmask editor e2e\n');

  // --- open ---------------------------------------------------------------
  console.log('opening');
  await open();
  const original = await centre();
  check('a plain photo opens with an EMPTY mask', JSON.stringify(original) === '[220,80,60]',
    `centre=${original}`);

  // --- mask brush ---------------------------------------------------------
  console.log('mask brush');
  await paintAcrossCentre();
  const masked = await centre();
  check('painting darkens the centre under the mask overlay',
    JSON.stringify(masked) !== JSON.stringify(original), `${original} -> ${masked}`);
  check('undo is enabled after a stroke',
    !(await page.locator('.mask-editor-undo').isDisabled()));

  await clickControl('.mask-editor-undo');
  check('undo restores the original', JSON.stringify(await centre()) === JSON.stringify(original));
  await clickControl('.mask-editor-redo');
  check('redo re-applies it', JSON.stringify(await centre()) === JSON.stringify(masked));

  // --- save ---------------------------------------------------------------
  console.log('save');
  await page.locator('.mask-editor-save').click();
  await page.waitForSelector('.mask-editor-canvas', { state: 'detached' });
  const widget = await page.evaluate(() => window.maskE2E.widgetValue());
  check('the widget points at the painted-masked layer',
    /^clipspace\/clipspace-painted-masked-\d+\.png \[input\]$/.test(widget), widget);
  const stored = await page.evaluate(() => window.maskE2E.storedFiles());
  check('all four clipspace layers were uploaded',
    ['mask', 'paint', 'painted', 'painted-masked']
      .every((part) => stored.some((f) => f.includes(`clipspace-${part}-`))),
    stored.filter((f) => f.includes('clipspace')).length + ' files');

  // --- reopen -------------------------------------------------------------
  console.log('reopen');
  await open();
  const reopened = await centre();
  check('the saved mask comes back', JSON.stringify(reopened) === JSON.stringify(masked),
    `${reopened} vs ${masked}`);
  check('undo reaches back into the previous session',
    !(await page.locator('.mask-editor-undo').isDisabled()));

  await clickControl('.mask-editor-undo');
  check('undo removes the previously SAVED edit',
    JSON.stringify(await centre()) === JSON.stringify(original),
    `${await centre()} vs ${original}`);

  // --- rgb paint across a save -------------------------------------------
  console.log('rgb paint across a save');
  await clickControl('.mask-editor-redo');
  await clickTool(4); // paint pen
  await paintAcrossCentre();
  const painted = await centre();
  check('the paint pen changes the centre',
    JSON.stringify(painted) !== JSON.stringify(masked), `${masked} -> ${painted}`);

  await page.locator('.mask-editor-save').click();
  await page.waitForSelector('.mask-editor-canvas', { state: 'detached' });
  await open();
  check('paint survives the round trip',
    JSON.stringify(await centre()) === JSON.stringify(painted));
  await clickControl('.mask-editor-undo');
  check('undo removes the previous session’s PAINT',
    JSON.stringify(await centre()) === JSON.stringify(masked),
    `${await centre()} vs ${masked}`);

  // --- keyboard shortcuts -------------------------------------------------
  console.log('keyboard');
  await open();
  // Start from a clean canvas: the centre is already masked from the sections
  // above, and more mask over full mask changes no pixels, which would make
  // every assertion below vacuously true.
  await page.locator('.mask-editor-clear').click();
  await page.waitForTimeout(120);
  const kbBefore = await centre();
  await clickTool(0); // mask brush
  await paintAcrossCentre();
  const kbPainted = await centre();
  check('painting changes the centre, so the checks below mean something',
    JSON.stringify(kbPainted) !== JSON.stringify(kbBefore), `${kbBefore} -> ${kbPainted}`);

  // Modifier is Meta on macOS, Control elsewhere; Playwright maps ControlOrMeta.
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(120);
  check('Ctrl/Cmd+Z undoes', JSON.stringify(await centre()) === JSON.stringify(kbBefore),
    `${await centre()} vs ${kbBefore}`);

  await page.keyboard.press('ControlOrMeta+y');
  await page.waitForTimeout(120);
  check('Ctrl/Cmd+Y redoes', JSON.stringify(await centre()) === JSON.stringify(kbPainted));

  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(120);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.waitForTimeout(120);
  check('Ctrl/Cmd+Shift+Z redoes too',
    JSON.stringify(await centre()) === JSON.stringify(kbPainted));

  // --- panning ------------------------------------------------------------
  console.log('pan');
  await framed();
  const box = await page.locator('.mask-editor-canvas').boundingBox();
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const edgeBefore = await readPan();
  const [edgeBeforeLeft, edgeBeforeTop] = edgeBefore.split(',').map(Number);
  const panProbeOffset = {
    x: Math.floor(box.width / 2 - edgeBeforeLeft),
    y: Math.floor(box.height / 2 - edgeBeforeTop),
  };
  const beforePan = await sampleImage(panProbeOffset.x, panProbeOffset.y);

  // Middle-drag.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(from.x + 90, from.y, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(120);
  // Compare the numeric left edge — "185,50" sorts before "95,50" as strings,
  // so a pan crossing a digit-count boundary would flip a string comparison.
  const leftOf = (pan) => Number(pan.split(',')[0]);
  const edgeAfterMiddle = await readPan();
  check('middle-drag pans the view', leftOf(edgeAfterMiddle) > edgeBeforeLeft,
    `left edge ${edgeBefore} -> ${edgeAfterMiddle}`);

  // Space + left-drag.
  await page.keyboard.down(' ');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 60, from.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  await page.waitForTimeout(120);
  const edgeAfterSpace = await readPan();
  check('space + drag pans the view', leftOf(edgeAfterSpace) < leftOf(edgeAfterMiddle),
    `left edge ${edgeAfterMiddle} -> ${edgeAfterSpace}`);

  // The important half: panning must not have left paint behind.
  const afterPan = await sampleImage(panProbeOffset.x, panProbeOffset.y);
  check('panning never draws', JSON.stringify(afterPan) === JSON.stringify(beforePan),
    `${afterPan} vs ${beforePan}`);

  // --- wheel / trackpad ---------------------------------------------------
  console.log('wheel and trackpad');

  const zoomPct = async () =>
    parseInt((await page.locator('.mask-editor-zoom').textContent()).replace('%', ''), 10);

  await framed();

  // A mouse wheel: one large whole-number vertical delta, no horizontal.
  const zoomAtRest = await zoomPct();
  await wheel({ deltaY: -120 });
  await page.waitForTimeout(120);
  check('a plain mouse wheel zooms', (await zoomPct()) > zoomAtRest,
    `${zoomAtRest}% -> ${await zoomPct()}%`);

  // A trackpad two-finger scroll: small fractional deltas with drift.
  await framed();
  const zoomBeforeScroll = await zoomPct();
  const edgeBeforeScroll = await readPan();
  await wheel({ deltaX: 12.5, deltaY: 4.25 });
  await page.waitForTimeout(120);
  check('a trackpad two-finger scroll pans, not zooms',
    (await zoomPct()) === zoomBeforeScroll && (await readPan()) !== edgeBeforeScroll,
    `zoom ${zoomBeforeScroll}% -> ${await zoomPct()}%, edge ${edgeBeforeScroll} -> ${await readPan()}`);

  // A trackpad pinch: the browser sets ctrlKey.
  const zoomBeforePinch = await zoomPct();
  await wheel({ deltaY: -6, ctrlKey: true });
  await page.waitForTimeout(120);
  check('a trackpad pinch zooms the canvas', (await zoomPct()) > zoomBeforePinch,
    `${zoomBeforePinch}% -> ${await zoomPct()}%`);

  // Modifiers force panning even for a mouse-wheel-shaped event.
  for (const [name, mod] of [['shift', { shiftKey: true }], ['cmd', { metaKey: true }]]) {
    const zoomBefore = await zoomPct();
    const edgeBefore = await readPan();
    await wheel({ deltaY: -120, ...mod });
    await page.waitForTimeout(120);
    check(`${name} + wheel pans instead of zooming`,
      (await zoomPct()) === zoomBefore && (await readPan()) !== edgeBefore,
      `zoom ${zoomBefore}% -> ${await zoomPct()}%, edge ${edgeBefore} -> ${await readPan()}`);
  }

  // --- drag on the empty area around the image ----------------------------
  console.log('drag off-image');
  await framed();

  const canvasBox = await page.locator('.mask-editor-canvas').boundingBox();
  // framed() leaves the image clear of every edge, so a few pixels in from the
  // canvas edge is reliably outside it.
  const offImage = { x: canvasBox.x + 8, y: canvasBox.y + canvasBox.height / 2 };
  const edgeBeforeDrag = await readPan();
  const contentBeforeDrag = await sampleImage(20, 20);

  await page.mouse.move(offImage.x, offImage.y);
  await page.mouse.down();
  await page.mouse.move(offImage.x + 70, offImage.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);

  check('dragging beside the image pans it', (await readPan()) !== edgeBeforeDrag,
    `origin ${edgeBeforeDrag} -> ${await readPan()}`);
  const cursorAt = async (x, y) => {
    await page.mouse.move(x, y);
    await page.waitForTimeout(60);
    return page.evaluate(() => document.querySelector('.mask-editor-canvas').style.cursor);
  };
  check('the cursor is a grab hand beside the image',
    (await cursorAt(offImage.x, offImage.y)) === 'grab', await cursorAt(offImage.x, offImage.y));
  check('the cursor is a crosshair over the image',
    (await cursorAt(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2)) === 'crosshair');

  check('dragging beside the image does not paint',
    JSON.stringify(await sampleImage(20, 20)) === JSON.stringify(contentBeforeDrag),
    `${await sampleImage(20, 20)} vs ${contentBeforeDrag}`);

  // And a drag that starts ON the image must still draw.
  await page.locator('.mask-editor-clear').click();
  await page.waitForTimeout(120);
  const beforeOnImage = await centre();
  await paintAcrossCentre();
  check('a drag starting on the image still paints',
    JSON.stringify(await centre()) !== JSON.stringify(beforeOnImage),
    `${beforeOnImage} -> ${await centre()}`);

  // --- across a page reload ----------------------------------------------
  console.log('reload');
  await page.locator('.mask-editor-clear').click();
  await page.waitForTimeout(120);
  const beforeReloadEdit = await centre();
  await clickTool(0);
  await paintAcrossCentre();
  const reloadPainted = await centre();
  check('painted before reloading',
    JSON.stringify(reloadPainted) !== JSON.stringify(beforeReloadEdit));

  await page.locator('.mask-editor-save').click();
  await page.waitForSelector('.mask-editor-canvas', { state: 'detached' });
  // The history is encoded to PNG after the save returns, so give it a moment
  // to reach IndexedDB before pulling the rug out.
  await page.waitForTimeout(1200);

  await load();
  await open();
  // Not pixel-exact: the fake decodes uploaded PNGs through a canvas, which is
  // not bit-preserving for partially transparent pixels the way a real server
  // writing bytes to disk is. What matters is that the edit survived at all --
  // the exact assertion is the undo below, which compares against a state the
  // editor reconstructs rather than one that round-tripped through storage.
  const afterReload = await centre();
  check('the saved edit survived the reload',
    JSON.stringify(afterReload) !== JSON.stringify(beforeReloadEdit),
    `${afterReload}, pre-edit was ${beforeReloadEdit}`);
  check('undo survives a reload',
    !(await page.locator('.mask-editor-undo').isDisabled()));
  await clickControl('.mask-editor-undo');
  check('undo reaches the pre-edit state from before the reload',
    JSON.stringify(await centre()) === JSON.stringify(beforeReloadEdit),
    `${await centre()} vs ${beforeReloadEdit}`);

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));

  if (!keep) await browser.close();
  console.log(`\n${failures === 0 ? 'All mask editor e2e checks passed.' : `${failures} check(s) failed.`}\n`);
}

try {
  await main();
} catch (error) {
  console.error('\ne2e run failed:', error.message);
  if (pageErrors.length) console.error('page errors:\n' + pageErrors.join('\n'));
  failures = failures || 1;
} finally {
  vite.kill();
}
process.exit(failures === 0 ? 0 : 1);

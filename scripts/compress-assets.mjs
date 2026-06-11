// Post-build step: emit .gz and .br siblings for the static assets so the
// ComfyUI Python backend can serve them precompressed (the asset route in
// __init__.py negotiates Accept-Encoding and returns the sibling). Vite ships a
// single ~1 MB JS chunk uncompressed otherwise; brotli takes it to ~250 KB on
// the wire. Zero external deps — uses Node's built-in zlib.
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = join(ROOT, 'dist', 'assets');

// Only compress text-y assets; skip already-binary files (images/fonts) where
// compression is a loss, and skip tiny files where the header overhead isn't
// worth it / the round-trip saving is negligible.
const COMPRESSIBLE = /\.(js|css|html|json|svg|map|txt|wasm)$/;
const MIN_BYTES = 1024;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let count = 0;
let rawTotal = 0;
let brTotal = 0;
for (const file of walk(ASSETS_DIR)) {
  if (!COMPRESSIBLE.test(file)) continue;
  if (file.endsWith('.gz') || file.endsWith('.br')) continue;
  const buf = readFileSync(file);
  if (buf.length < MIN_BYTES) continue;

  const gz = gzipSync(buf, { level: 9 });
  const br = brotliCompressSync(buf, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
  writeFileSync(`${file}.gz`, gz);
  writeFileSync(`${file}.br`, br);

  count += 1;
  rawTotal += buf.length;
  brTotal += br.length;
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(
  `compress-assets: ${count} file(s) precompressed (.gz + .br); ` +
    `raw ${kb(rawTotal)} → brotli ${kb(brTotal)}`,
);

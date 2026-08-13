// Heuristic audit for unwrapped user-visible English strings in src.
// Scans .tsx files for (a) plain JSX text nodes and (b) literal values of
// common UI attributes (title/aria-label/placeholder/alt) that are not
// wrapped in t(). Expect some false positives; review each hit manually.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'src');
const results = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'icons' || entry === 'node_modules') continue;
      walk(full);
    } else if (full.endsWith('.tsx')) {
      const rel = full.replace(process.cwd() + '\\', '').replace(/\\/g, '/');
      if (rel.includes('__tests__') || rel.includes('/icons/')) continue;
      auditFile(rel, readFileSync(full, 'utf8'));
    }
  }
}

// Data-ish single words that routinely appear in JSX text.
const dataWords = new Set([
  'node', 'nodes', 'workflow', 'group', 'subgraph', 'type', 'name', 'value', 'key',
  'input', 'output', 'model', 'widget', 'file', 'folder', 'path', 'url', 'source',
  'status', 'mode', 'text', 'string', 'number', 'boolean', 'color', 'queue', 'prompt',
  'seed', 'image', 'images', 'video', 'audio', 'latent', 'preview', 'data', 'meta',
  'tab', 'panel', 'list', 'item', 'items', 'order', 'sort', 'filter', 'search',
  'index', 'size', 'width', 'height', 'top', 'bottom', 'left', 'right', 'start',
  'end', 'open', 'close', 'hidden', 'visible', 'active', 'enabled', 'disabled',
  'default', 'custom', 'auto', 'manual', 'min', 'max', 'normal', 'primary',
  'secondary', 'danger', 'success', 'warning', 'error', 'info', 'none', 'all',
  'any', 'yes', 'no', 'true', 'false', 'null', 'undefined', 'loading', 'saved',
  'dirty', 'clean', 'new', 'old', 'first', 'last', 'next', 'previous', 'root',
  'temp', 'config', 'settings', 'options', 'menu', 'actions', 'button', 'icon',
  'link', 'page', 'view', 'views', 'session', 'sessions', 'blocks', 'section',
  'row', 'rows', 'column', 'grid', 'cell', 'field', 'form', 'json', 'api', 'http',
  'https', 'ws', 'svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'mobile', 'desktop',
  'app', 'css', 'html', 'theme', 'dark', 'light', 'slate', 'cyan', 'red', 'blue',
  'green', 'amber', 'current', 'previous', 'other', 'another', 'some', 'every',
  'comfyui', 'lora', 'loras', 'clip', 'vae', 'vram', 'ram', 'cpu', 'gpu', 'fps',
  'kb', 'mb', 'gb', 'ms', 'ok', 'abort', 'retry', 'cancel', 'confirm', 'reset',
  'clear', 'copy', 'paste', 'cut', 'delete', 'remove', 'add', 'create', 'edit',
  'rename', 'move', 'duplicate', 'import', 'export', 'download', 'upload', 'save',
  'load', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n',
  'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'side', 'by', 'and',
  'or', 'of', 'to', 'in', 'on', 'at', 'with', 'via', 'per', 'for', 'the', 'a',
]);

function isLikelyCopy(text) {
  const words = text.split(/[\s:：;，。.!?()[\]{}"'’—–-]+/).filter(Boolean);
  if (words.length === 0) return false;
  const meaningful = words.filter(
    (w) => !dataWords.has(w.toLowerCase()) && !/^\d+$/.test(w) && w.length > 1,
  );
  // Flag when there is a meaningful word OR the text has >= 3 words total
  // (e.g. "Dismiss" is a single meaningful word; "Queue is empty" has 3 words).
  return meaningful.length > 0 || words.length >= 3;
}

function auditFile(rel, src) {
  // (a) single-line JSX text nodes like  >Dismiss<  or  >Queue is empty<
  const textRe = />([A-Z][A-Za-z0-9 ,.!?'&…:—-]{1,80})</g;
  let m;
  while ((m = textRe.exec(src)) !== null) {
    const text = m[1].trim();
    // Skip attribute assignments like title="..." (those are caught by (b)).
    if (text.includes('=')) continue;
    if (isLikelyCopy(text)) {
      results.push(`${rel}: JSX text ${JSON.stringify(text)}`);
    }
  }
  // (b) unwrapped UI attribute literals: title/aria-label/placeholder/alt="..."
  const attrRe = /\b(title|aria-label|placeholder|alt)="([^"]*[A-Z][^"]*)"|\b(title|aria-label|placeholder|alt)=\{['"]([^'"]*[A-Z][^'"]*)['"]\}/g;
  while ((m = attrRe.exec(src)) !== null) {
    const val = m[2] ?? m[4];
    if (!val.includes('t(') && isLikelyCopy(val)) {
      results.push(`${rel}: attr ${m[1] ?? m[3]} ${JSON.stringify(val)}`);
    }
  }
}

walk(root);
console.log(`Audit found ${results.length} candidate hits (review each):`);
for (const r of results) console.log(`  ${r}`);

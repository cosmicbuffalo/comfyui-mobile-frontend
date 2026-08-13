// Audit: find useMemo/useCallback blocks that use t() but miss t in deps.
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
    } else if (full.endsWith('.tsx') || full.endsWith('.ts')) {
      const rel = full.replace(process.cwd() + '\\', '').replace(/\\/g, '/');
      if (rel.includes('__tests__') || rel.includes('/icons/')) continue;
      auditFile(rel, full);
    }
  }
}

function auditFile(rel, full) {
  const src = readFileSync(full, 'utf8');
  const re = /\b(useMemo|useCallback)\(\s*\(?[^)]*\)?\s*=>/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    // Find the opening paren right after the hook name
    const start = m.index + m[0].length;
    // scan body: skip string literals and template literals to find the deps array `[ ... ]`
    const bodyStart = start;
    let i = bodyStart;
    let depth = 1; // we are inside useMemo( already? No: start is after '=>', so find deps array after the closing of the arrow body.
    // Strategy: find the dep array: search for the last ']' after the arrow body. Simpler: capture until balanced parens of useMemo(...).
    // Walk from the hook name: count parens.
    let j = m.index + 'useMemo('.length;
    if (m[0].startsWith('useCallback')) j = m.index + 'useCallback('.length;
    let paren = 1;
    let inStr = null;
    let arrStart = -1;
    let arrEnd = -1;
    while (j < src.length) {
      const ch = src[j];
      if (inStr) {
        if (ch === '\\') { j += 2; continue; }
        if (ch === inStr) inStr = null;
        j += 1; continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; j += 1; continue; }
      if (ch === '(') paren += 1;
      else if (ch === ')') {
        paren -= 1;
        if (paren === 0) { arrEnd = j; break; }
      } else if (ch === '[' && paren === 1) {
        // the deps array — the LAST bracket at paren===1 before the final ')' is the deps array
        arrStart = j;
      }
      j += 1;
    }
    if (arrStart < 0 || arrEnd < 0) continue;
    const depsRaw = src.slice(arrStart, arrEnd + 1);
    const body = src.slice(bodyStart, arrStart);
    const usesT = /\bt\(['"`{]/.test(body) || /\bt\(/.test(body);
    const depsIncludeT = /\bt\b/.test(depsRaw);
    if (usesT && !depsIncludeT) {
      results.push({ file: rel, line: src.slice(0, m.index).split('\n').length, hook: m[0].slice(0, 12) });
    }
  }
}

walk(root);
console.log(`Found ${results.length} memoized blocks using t() without t in deps:`);
for (const r of results) console.log(`  ${r.file}:${r.line} (${r.hook}...)`);

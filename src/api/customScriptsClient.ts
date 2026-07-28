// Client for the ComfyUI-Custom-Scripts (pysssss) autocomplete data.
//
// Custom-Scripts' own suggestion UI is LiteGraph-only frontend code, so it can
// never run inside this app — but the data behind it is plain HTTP on the same
// origin: the user's custom word list at `/pysssss/autocomplete` (a CSV-ish
// text file managed through the desktop settings dialog), lora names at
// `/pysssss/loras`, and embeddings via ComfyUI core's `/embeddings`. We consume
// those read-only as a second autocomplete source alongside Autocomplete-Plus.

import type { TagEntry } from '@/utils/autocompleteSearch';

/** Sentinel category for user custom words: not a danbooru category, so it gets
 * the default row color and never claims a danbooru wiki link. */
export const CUSTOM_WORD_CATEGORY = -1;

/**
 * Detect whether ComfyUI-Custom-Scripts is installed. `/pysssss/loras` is
 * registered whenever the node loads (unlike `/pysssss/autocomplete`, which
 * 404s until the user saves a word list), so it doubles as the install probe.
 */
export async function isCustomScriptsAvailable(): Promise<boolean> {
  try {
    const response = await fetch('/pysssss/loras');
    return response.ok;
  } catch {
    return false;
  }
}

// Same quoted-field handling as the Autocomplete-Plus CSV: the a1111-style
// alias column is a quoted comma-separated list.
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Parse a Custom-Scripts word list into tag entries, mirroring the row shapes
 * its own `addCustomWords` accepts:
 * - `word`                     — bare word
 * - `word,123`                 — word with priority (numeric second column)
 * - `word,alias`               — typing the alias inserts the word
 * - `word,category,count,"a,b"`— a1111 csv (category ignored, aliases split)
 * - `word,alias,priority`      — anything else: insert word, match alias
 *
 * Priority maps onto `count` (the shared ranking field). Duplicate words keep
 * the last row's priority (parity with Custom-Scripts' key-overwrite) but the
 * alias sets are unioned. Result is sorted count-descending, as searchTags
 * expects.
 */
export function parseCustomWords(text: string): TagEntry[] {
  const byTag = new Map<string, TagEntry>();

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line).map((c) => c.trim());
    let tag = '';
    let count = 0;
    let aliases: string[] = [];

    if (cols.length === 1) {
      tag = cols[0];
    } else if (cols.length === 2) {
      const num = Number(cols[1]);
      tag = cols[0];
      if (Number.isNaN(num)) {
        if (cols[1]) aliases = [cols[1]];
      } else {
        count = num;
      }
    } else if (cols.length === 4) {
      // a1111 csv: name,category,count,"aliases" (a literal "null" alias cell
      // appears in common example files — Custom-Scripts skips it, so do we)
      tag = cols[0];
      count = Number(cols[2]) || 0;
      if (cols[3] && cols[3] !== 'null') {
        aliases = cols[3].split(',').map((a) => a.trim()).filter(Boolean);
      }
    } else {
      // word,alias,priority
      tag = cols[0];
      if (cols[1]) aliases = [cols[1]];
      count = Number(cols[2]) || 0;
    }

    if (!tag) continue;
    const existing = byTag.get(tag);
    if (existing) {
      existing.count = count;
      existing.aliases = [...new Set([...existing.aliases, ...aliases])];
    } else {
      byTag.set(tag, { tag, category: CUSTOM_WORD_CATEGORY, count, aliases });
    }
  }

  const entries = [...byTag.values()];
  entries.sort((a, b) => b.count - a.count);
  return entries;
}

/**
 * Fetch and parse the user's custom word list. Resolves empty when the file
 * doesn't exist yet (404) or on any error — the feature just contributes
 * nothing rather than failing the whole data load.
 */
export async function fetchCustomWords(): Promise<TagEntry[]> {
  try {
    const response = await fetch('/pysssss/autocomplete', { cache: 'no-store' });
    if (!response.ok) return [];
    return parseCustomWords(await response.text());
  } catch {
    return [];
  }
}

async function fetchNameList(url: string): Promise<string[]> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

/** Lora names from Custom-Scripts (extension already stripped server-side). */
export function fetchCustomScriptsLoraNames(): Promise<string[]> {
  return fetchNameList('/pysssss/loras');
}

/** Embedding names from ComfyUI core — available on every server, used when
 * Autocomplete-Plus isn't installed to provide its own list. The `/api` prefix
 * matters: some custom nodes (e.g. Lora Manager) shadow the bare `/embeddings`
 * route with an HTML page, while the `/api/`-mounted core route stays JSON. */
export function fetchCoreEmbeddingNames(): Promise<string[]> {
  return fetchNameList('/api/embeddings');
}

// Client for the ComfyUI-Autocomplete-Plus custom node's HTTP API.
//
// That node registers routes at the ComfyUI server root (`/autocomplete-plus/*`)
// — the same origin this app is served from — and owns the tag data lifecycle
// (download from HuggingFace, updates, etc.). We consume it read-only: probe for
// installation, then pull the tag CSV plus lora/embedding name lists. If the
// node isn't installed every call here fails and the feature stays dark.

import type { TagEntry } from '@/utils/autocompleteSearch';

const BASE = '/autocomplete-plus';

interface CsvStatus {
  base_tags: boolean;
  extra_tags: string[];
  base_cooccurrence: boolean;
  extra_cooccurrence: string[];
}

interface CsvListResponse {
  danbooru?: CsvStatus;
  e621?: CsvStatus;
}

/**
 * Detect whether Autocomplete-Plus is installed and has usable tag data.
 * Resolves false on any error (route absent → node not installed).
 */
export async function isAutocompletePlusAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/csv`);
    if (!response.ok) return false;
    const data = (await response.json()) as CsvListResponse;
    return Boolean(data?.danbooru?.base_tags || data?.e621?.base_tags);
  } catch {
    return false;
  }
}

// Mirrors Autocomplete-Plus's own CSV parsing: quoted fields may contain commas
// (the alias column is a quoted comma-separated list).
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
 * Fetch and parse the base danbooru tag table, sorted by post count descending
 * (so search can collect best-first). Header row: `tag,category,count,alias`.
 */
export async function fetchDanbooruTags(): Promise<TagEntry[]> {
  const response = await fetch(`${BASE}/csv/danbooru/tags/base`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to fetch tags: ${response.status}`);
  const text = await response.text();
  const lines = text.split('\n');

  const entries: TagEntry[] = [];
  const start = lines[0]?.toLowerCase().startsWith('tag,category,count') ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 4) continue;
    const tag = cols[0].trim();
    const count = parseInt(cols[2].trim(), 10);
    if (!tag || Number.isNaN(count)) continue;
    const aliasStr = cols[3].trim();
    entries.push({
      tag,
      category: parseInt(cols[1].trim(), 10) || 0,
      count,
      aliases: aliasStr ? aliasStr.split(',').map((a) => a.trim()).filter(Boolean) : [],
    });
  }

  for (const entry of entries) {
    entry.searchKey = entry.tag.toLowerCase();
    entry.aliasKeys = entry.aliases.map((alias) => alias.toLowerCase().replace(/ /g, '_'));
  }
  entries.sort((a, b) => b.count - a.count);
  return entries;
}

async function fetchNameList(path: string): Promise<string[]> {
  try {
    const response = await fetch(`${BASE}/${path}`, { cache: 'no-store' });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

export function fetchLoraNames(): Promise<string[]> {
  return fetchNameList('loras');
}

export function fetchEmbeddingNames(): Promise<string[]> {
  return fetchNameList('embeddings');
}

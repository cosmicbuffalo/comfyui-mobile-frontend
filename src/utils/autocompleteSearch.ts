// Pure helpers for tag autocomplete: extracting the token under the caret,
// matching it against the loaded tag / lora / embedding data, and computing the
// text to insert when a suggestion is accepted. Kept free of React/DOM so the
// matching logic can be unit-tested in isolation.

export interface TagEntry {
  tag: string;
  /** Category index within the source (e.g. danbooru: 0=general, 4=character). */
  category: number;
  /** Post frequency — suggestions are ranked by this. */
  count: number;
  aliases: string[];
  /** Lazily-cached lowercase search key (filled by the first search). The tag
   * table is ~150k entries and searchTags runs per keystroke on the main
   * thread, so re-lowercasing every tag every keystroke is pure churn. */
  searchKey?: string;
  /** Lazily-cached normalized aliases, same rationale. */
  aliasKeys?: string[];
}

export type SuggestionKind = 'tag' | 'lora' | 'embedding';

export interface Suggestion {
  kind: SuggestionKind;
  /** Text shown in the dropdown row. */
  label: string;
  /** Text that replaces the active token when accepted. */
  insertText: string;
  count?: number;
  category?: number;
  /** The tag's full alias list, shown as a column on every row (parity with the
   * desktop extension's always-on alias display). */
  aliases?: string[];
  /** Set when the match was on an alias rather than the canonical tag; surfaced
   * first in the alias column so the user sees why the row matched. */
  matchedAlias?: string;
}

/** The token currently under the caret and where it sits in the full string. */
export interface ActiveToken {
  text: string;
  start: number;
  end: number;
}

/** Minimum characters before plain-tag suggestions appear (lora/embedding
 * prefixes are explicit triggers, so they don't require this). */
export const MIN_TAG_QUERY_LENGTH = 2;

function normalize(value: string): string {
  // Booru tags are underscore-delimited; users typically type spaces.
  return value.toLowerCase().replace(/ /g, '_');
}

/**
 * Extract the comma/newline-delimited token ending at `caret`. Leading
 * whitespace after the separator is skipped so "a, blue" yields "blue".
 */
export function getActiveToken(value: string, caret: number): ActiveToken {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  let start = 0;
  for (let i = safeCaret - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === ',' || ch === '\n') {
      start = i + 1;
      break;
    }
  }
  while (start < safeCaret && (value[start] === ' ' || value[start] === '\t')) {
    start++;
  }
  return { text: value.slice(start, safeCaret), start, end: safeCaret };
}

export interface ParsedToken {
  kind: SuggestionKind;
  query: string;
}

/** Classify a token: `<lora:foo` → lora, `embedding:foo` → embedding, else tag. */
export function parseToken(tokenText: string): ParsedToken {
  const lora = tokenText.match(/^<lora:(.*)$/i);
  if (lora) return { kind: 'lora', query: lora[1] };
  const embedding = tokenText.match(/^embedding:(.*)$/i);
  if (embedding) return { kind: 'embedding', query: embedding[1] };
  return { kind: 'tag', query: tokenText };
}

function toTagSuggestion(entry: TagEntry, matchedAlias?: string): Suggestion {
  return {
    kind: 'tag',
    label: entry.tag,
    insertText: entry.tag,
    count: entry.count,
    category: entry.category,
    aliases: entry.aliases,
    matchedAlias,
  };
}

// Danbooru tag categories that have wiki pages (parity with the desktop
// extension's hasWikiPage): general(0), artist(1), copyright(3), character(4).
// Meta(5) and the model "kinds" (lora/embedding) have no wiki.
const WIKI_CATEGORIES = new Set([0, 1, 3, 4]);

/**
 * Build the Danbooru wiki URL for a tag suggestion, or undefined when the tag
 * has no wiki page (meta tags, loras, embeddings). Mirrors the desktop
 * extension: spaces→underscores, URI-encoded.
 */
export function getSuggestionWikiUrl(suggestion: Suggestion): string | undefined {
  if (suggestion.kind !== 'tag') return undefined;
  if (suggestion.category != null && !WIKI_CATEGORIES.has(suggestion.category)) {
    return undefined;
  }
  const tag = encodeURIComponent(suggestion.label.replace(/ /g, '_'));
  return `https://danbooru.donmai.us/wiki_pages/${tag}`;
}

/**
 * Rank tag matches by post count. `tags` is assumed pre-sorted by count
 * descending, so prefix matches are collected in best-first order and we can
 * stop once the limit is reached. Falls back to substring, then alias matches.
 */
export function searchTags(tags: TagEntry[], query: string, limit = 20): Suggestion[] {
  const nq = normalize(query.trim());
  if (nq.length < MIN_TAG_QUERY_LENGTH) return [];

  const prefix: Suggestion[] = [];
  const infix: Suggestion[] = [];
  const aliasHits: Suggestion[] = [];

  for (const entry of tags) {
    const nt = entry.searchKey ?? (entry.searchKey = entry.tag.toLowerCase());
    if (nt.startsWith(nq)) {
      prefix.push(toTagSuggestion(entry));
      if (prefix.length >= limit) break;
      continue;
    }
    // Entries are sorted best-first, so once a fallback bucket is full any
    // later match would be sliced away anyway. Keep scanning only for better
    // prefix matches.
    if (infix.length < limit && nt.includes(nq)) {
      infix.push(toTagSuggestion(entry));
      continue;
    }
    if (aliasHits.length < limit && entry.aliases.length > 0) {
      const aliasKeys = entry.aliasKeys ?? (entry.aliasKeys = entry.aliases.map(normalize));
      const aliasIndex = aliasKeys.findIndex((a) => a.includes(nq));
      if (aliasIndex >= 0) aliasHits.push(toTagSuggestion(entry, entry.aliases[aliasIndex]));
    }
  }

  return [...prefix, ...infix, ...aliasHits].slice(0, limit);
}

/** Match lora / embedding filenames. An empty query lists the top `limit`. */
export function searchNames(
  names: string[],
  query: string,
  kind: Exclude<SuggestionKind, 'tag'>,
  limit = 20,
): Suggestion[] {
  const nq = query.trim().toLowerCase();
  const prefix: string[] = [];
  const infix: string[] = [];

  for (const name of names) {
    const nn = name.toLowerCase();
    if (nq === '' || nn.startsWith(nq)) {
      prefix.push(name);
      if (prefix.length >= limit) break;
      continue;
    }
    if (nn.includes(nq)) infix.push(name);
  }

  return [...prefix, ...infix].slice(0, limit).map((name) => ({
    kind,
    label: name,
    insertText: kind === 'lora' ? `<lora:${name}>` : `embedding:${name}`,
  }));
}

// --- Insertion formatting (parity with ComfyUI-Autocomplete-Plus) ---

// Lookbehind avoids re-escaping an already-escaped paren.
const REG_OPEN_PAREN = /(?<!\\)\(/g;
const REG_CLOSE_PAREN = /(?<!\\)\)/g;
// At least one letter/number (Latin, JP, KR, CJK-ExtA, Cyrillic, Hebrew).
const REG_LETTER_NUMBER =
  /[a-zA-Z0-9぀-ヿ㐀-䶿一-龯가-힯Ѐ-ӿ֐-׿]/;

const LORA_DEFAULT_WEIGHT = 1.0;

/** Escape unescaped parentheses so booru tags like `heart_(symbol)` don't read
 * as prompt weighting groups. */
export function escapeParentheses(value: string): string {
  if (!value) return value;
  return value.replace(REG_OPEN_PAREN, '\\(').replace(REG_CLOSE_PAREN, '\\)');
}

/** Booru tags are stored underscore-delimited; prompts read better with spaces.
 * Wildcards (`__name__`) and pure-symbol tags (`^_^`) are left untouched. */
export function normalizeTagToInsert(tag: string): string {
  if (!tag) return tag;
  const isMultiTag = tag.includes(',');
  if (REG_LETTER_NUMBER.test(tag)) {
    const isWildcard = tag.startsWith('__') && tag.endsWith('__') && tag.length > 4;
    if (!isWildcard) {
      const spaced = tag.replace(/_/g, ' ');
      return isMultiTag ? spaced : escapeParentheses(spaced);
    }
  }
  return isMultiTag ? tag : escapeParentheses(tag);
}

/** Give a bare `<lora:name>` a default weight: `<lora:name:1.0>`. */
export function addWeightToLora(loraTag: string): string {
  const match = loraTag.match(/^(<lora:[^>:]+)(:[0-9.]+)?>$/i);
  if (!match) return loraTag;
  if (match[2]) return loraTag; // weight already present
  return `${match[1]}:${LORA_DEFAULT_WEIGHT.toFixed(1)}>`;
}

function formatInsertion(suggestion: Suggestion): string {
  if (suggestion.kind === 'lora') return addWeightToLora(suggestion.insertText);
  if (suggestion.kind === 'embedding') return suggestion.insertText;
  return normalizeTagToInsert(suggestion.insertText);
}

export interface ApplyResult {
  value: string;
  caret: number;
}

/**
 * Replace the active token with the formatted suggestion. Mirrors the desktop
 * extension: underscores→spaces and escaped parens for tags, default weight for
 * loras, a leading space after a bare comma, and a trailing ", " unless the next
 * character is already a comma or colon.
 */
export function applySuggestion(
  value: string,
  token: ActiveToken,
  suggestion: Suggestion,
): ApplyResult {
  const before = value.slice(0, token.start);
  const after = value.slice(token.end);

  const body = formatInsertion(suggestion);
  const prefix = before.endsWith(',') ? ' ' : '';
  const nextChar = after.charAt(0);
  const suffix = nextChar === ',' || nextChar === ':' ? '' : ', ';

  const head = before + prefix + body + suffix;
  return { value: head + after, caret: head.length };
}

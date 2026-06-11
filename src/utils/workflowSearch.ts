/**
 * Pure text-matching helpers for the workflow node search/filter UI.
 */

/** Split a comma-separated node type string into normalized, upper-cased tokens. */
export function normalizeTypes(type: string): string[] {
  return String(type)
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

/** Lower-case, collapse separators/whitespace to single spaces, and trim. */
export function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** True if `needle`'s characters appear in order (not necessarily contiguous) within `haystack`. */
export function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1;
      if (index >= needle.length) return true;
    }
  }
  return needle.length === 0;
}

/**
 * Fuzzy-match a query against text: every whitespace-separated query token must
 * either be a substring of, or a subsequence of, the normalized text.
 */
export function fuzzyMatch(query: string, text: string): boolean {
  if (!query.trim()) return true;
  const normalizedText = normalizeSearchText(text);
  return normalizeSearchText(query)
    .split(" ")
    .filter(Boolean)
    .every(
      (token) =>
        normalizedText.includes(token) || isSubsequence(token, normalizedText),
    );
}

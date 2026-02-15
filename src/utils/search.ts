export function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function fuzzyMatch(query: string, text: string): boolean {
  if (!query.trim()) return true;
  const normalizedText = normalizeSearchText(text);
  return normalizeSearchText(query)
    .split(" ")
    .filter(Boolean)
    .every((token) => normalizedText.includes(token));
}

export function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true;
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i += 1;
    if (i >= needle.length) return true;
  }
  return false;
}

export function getFieldScore(query: string, value: string): number {
  if (!query) return 0;
  const q = normalizeSearchText(query);
  const t = normalizeSearchText(value);
  if (!t) return 0;
  if (t === q) return 120;
  if (t.startsWith(q)) return 90;
  if (t.includes(q)) return 70;
  if (isSubsequence(q, t)) return 40;
  return 0;
}

export function prettyPackName(value: string): string {
  return value
    .replace(/^custom_nodes\./, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getTypeClass(type: string): string {
  const normalizedType = String(type).split(",")[0].trim().toUpperCase();
  const knownTypes = [
    "IMAGE",
    "LATENT",
    "MODEL",
    "CLIP",
    "VAE",
    "CONDITIONING",
    "INT",
    "FLOAT",
    "STRING",
    "BOOLEAN",
    "MASK",
  ];
  if (knownTypes.includes(normalizedType)) {
    return `type-${normalizedType}`;
  }
  return "type-default";
}

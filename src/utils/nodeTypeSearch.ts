import {
  fuzzyMatch,
  getFieldScore,
  isSubsequence,
  normalizeSearchText,
} from '@/utils/search';

interface NodeTypeSearchFields {
  displayName: string;
  typeName: string;
  category?: string;
  pack?: string;
}

export function searchAndSortNodeTypes<T>(
  items: T[],
  query: string,
  getFields: (item: T) => NodeTypeSearchFields,
  getStableIndex: (item: T) => number
): T[] {
  const trimmedQuery = query.trim();

  const scored = items
    .map((item) => {
      const { displayName, typeName, category = '', pack = '' } = getFields(item);
      const text = `${displayName} ${typeName} ${category} ${pack}`;
      const matches = !trimmedQuery
        || fuzzyMatch(trimmedQuery, text)
        || isSubsequence(normalizeSearchText(trimmedQuery), normalizeSearchText(text));
      if (!matches) return null;

      const score = trimmedQuery
        ? getFieldScore(trimmedQuery, displayName) * 10 + getFieldScore(trimmedQuery, typeName) * 4
        : 0;

      return { item, score };
    })
    .filter((entry): entry is { item: T; score: number } => entry !== null);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return getStableIndex(a.item) - getStableIndex(b.item);
  });

  return scored.map((entry) => entry.item);
}

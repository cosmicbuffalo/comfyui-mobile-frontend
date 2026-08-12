import { useEffect, useState } from 'react';
import { getImpactWildcards } from '@/api/impactWildcardsClient';

// One fetch per page load, shared by every wildcard dropdown on every card.
// The list only changes when the user edits files on disk (or hits Impact
// Pack's own refresh on desktop), so it isn't worth revalidating per render.
let wildcardsPromise: Promise<string[]> | null = null;

function loadWildcards(): Promise<string[]> {
  wildcardsPromise ??= getImpactWildcards();
  return wildcardsPromise;
}

/** Test seam: drop the cached list so the next consumer refetches. */
export function resetWildcardCache(): void {
  wildcardsPromise = null;
}

/**
 * Wildcard names for the "Select to add Wildcard" dropdown, or an empty list
 * when Impact Pack isn't installed. Pass `enabled: false` on cards that have no
 * wildcard widget so browsing a normal workflow makes no request at all.
 */
export function useWildcards(enabled: boolean): string[] {
  const [wildcards, setWildcards] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void loadWildcards().then((list) => {
      if (active) setWildcards(list);
    });
    return () => { active = false; };
  }, [enabled]);

  return wildcards;
}

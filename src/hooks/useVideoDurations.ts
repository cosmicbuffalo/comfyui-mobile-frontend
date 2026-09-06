import { useEffect, useState } from 'react';
import { getVideoDurations, type AssetSource } from '@/api/client';

export interface VideoDurationRequest {
  /** Asset root the path is relative to. */
  source: AssetSource;
  /** Path relative to that root, as the durations endpoint expects. */
  path: string;
  /**
   * Identity the caller looks the duration up by. Include whatever marks the
   * file's content (cache token, mtime, size) so a video re-rendered under the
   * same name is probed again instead of reading back the old length.
   */
  key: string;
}

/**
 * Durations for a set of videos, probed server-side and batched per source.
 *
 * Cards render a still poster, so there is no media element to read a length
 * from; the server probes the file instead. A failed probe simply leaves the
 * key absent — callers drop the badge rather than showing a wrong number.
 */
export function useVideoDurations(
  requests: VideoDurationRequest[],
): Record<string, number> {
  const [durations, setDurations] = useState<Record<string, number>>({});
  // Requests are rebuilt on every render; drive the effect off their content so
  // unrelated card state doesn't refetch what's already resolved.
  const requestKey = requests
    .map((request) => `${request.source}\0${request.path}\0${request.key}`)
    .join('\n');

  useEffect(() => {
    if (requests.length === 0) return;
    let cancelled = false;

    const bySource = new Map<AssetSource, VideoDurationRequest[]>();
    for (const request of requests) {
      const existing = bySource.get(request.source);
      if (existing) existing.push(request);
      else bySource.set(request.source, [request]);
    }

    void Promise.all(
      [...bySource].map(([source, sourceRequests]) => (
        getVideoDurations(source, sourceRequests.map((request) => request.path))
          .then((probed) => ({ sourceRequests, probed }))
      )),
    ).then((results) => {
      if (cancelled) return;
      const updates: Record<string, number> = {};
      for (const { sourceRequests, probed } of results) {
        for (const request of sourceRequests) {
          const seconds = probed[request.path];
          if (typeof seconds === 'number' && seconds > 0) {
            updates[request.key] = seconds;
          }
        }
      }
      if (Object.keys(updates).length === 0) return;
      setDurations((current) => ({ ...current, ...updates }));
    });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  return durations;
}

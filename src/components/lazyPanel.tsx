import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { StaleBuildNotice } from '@/components/StaleBuildNotice';

/**
 * `lazy`, but a chunk that cannot be fetched resolves to a reload prompt
 * instead of rejecting.
 *
 * One retry first: a chunk request can fail on a flaky connection too, and
 * telling someone their app is out of date because a phone changed cell would
 * be wrong. A second failure is treated as the build having moved, which is
 * what it almost always is.
 *
 * This deliberately never rejects, so it needs no error boundary above it and
 * cannot take down anything outside its own Suspense.
 */
const registeredLoaders: Array<() => Promise<unknown>> = [];

/**
 * Warm every lazyPanel chunk in the background.
 *
 * A running session that already holds all of its chunks cannot be stranded by
 * a server update: the content-hashed files it would need are exactly the ones
 * it has. Called once after startup has settled (see App), so the prefetch
 * never competes with the requests first paint depends on. Failures are
 * ignored — the render path retries and has the stale-build fallback.
 */
export function prefetchLazyPanels(): void {
  for (const load of registeredLoaders) {
    void load().catch(() => {});
  }
}

// The props are the loaded component's own; this only passes them through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPanel<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  registeredLoaders.push(load);
  return lazy(async (): Promise<{ default: T }> => {
    try {
      return await load();
    } catch (first) {
      try {
        return await load();
      } catch {
        console.warn('[app] panel chunk unavailable, offering a reload:', first);
        return { default: StaleBuildNotice as unknown as T };
      }
    }
  });
}

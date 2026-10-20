import type { UserDataFile } from './workflows';

const FRESH_MS = 30_000;
const ACTIVE_USER_KEY = 'comfy_multiuser_active_user';
export interface UserWorkflowListSnapshot {
  files: UserDataFile[] | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: Error | null;
  revision: number;
}
let revision = 0;
const listeners = new Set<() => void>();
function scope(): string {
  let user = '';
  try { user = localStorage.getItem(ACTIVE_USER_KEY) ?? ''; } catch { /* memory only */ }
  return `${window.location.origin}:${user}`;
}
function empty() {
  return { scope: scope(), fetchedAt: 0, pending: null as Promise<UserDataFile[]> | null,
    snapshot: { files: null, status: 'idle', error: null, revision: ++revision } as UserWorkflowListSnapshot };
}
let entry = empty();
function current() {
  if (entry.scope !== scope()) entry = empty();
  return entry;
}
function emit() { listeners.forEach(listener => listener()); }
function publish(next: UserWorkflowListSnapshot) { entry.snapshot = next; emit(); }
export function getUserWorkflowListSnapshot() { return current().snapshot; }
export function subscribeUserWorkflowList(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** No persistent cache: sign-in/impersonation navigates to a fresh document.
 * Also discard on account signals and when returning to a suspended page. */
export function clearUserWorkflowList() { entry = empty(); emit(); }
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === ACTIVE_USER_KEY || event.key === null) clearUserWorkflowList();
  });
  window.addEventListener('pagehide', clearUserWorkflowList);
  window.addEventListener('pageshow', event => { if (event.persisted) clearUserWorkflowList(); });
  document.addEventListener('visibilitychange', clearUserWorkflowList);
}

/** Mark stale after successful writes. An older in-flight response cannot
 * repopulate the cache; active consumers revalidate and share the replacement. */
export function invalidateUserWorkflowList() {
  const record = current();
  record.fetchedAt = 0;
  record.pending = null;
  publish({ ...record.snapshot, revision: ++revision });
}
export function dismissUserWorkflowListError() {
  publish({ ...current().snapshot, error: null });
}

export function listUserWorkflows({ force = false }: { force?: boolean } = {}): Promise<UserDataFile[]> {
  const record = current();
  if (record.pending) return record.pending;
  if (!force && record.snapshot.status === 'ready' && Date.now() - record.fetchedAt < FRESH_MS) {
    return Promise.resolve(record.snapshot.files!);
  }
  const startedRevision = record.snapshot.revision;
  publish({ ...record.snapshot, status: 'loading', error: null });
  let discard = false;
  const pending = (async () => {
    try {
      const response = await fetch('/api/v2/userdata?path=workflows', { cache: 'no-store' });
      discard = response.status === 401 || response.status === 403;
      if (!response.ok && response.status !== 404) throw new Error('Failed to list user workflows');
      const data: unknown = response.status === 404 ? [] : await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid user workflow listing');
      const files = data.filter((item): item is UserDataFile => item && typeof item.path === 'string' && typeof item.name === 'string' &&
        (item.type === 'directory' || (item.type === 'file' && item.name.endsWith('.json'))));
      if (current() !== record) throw new Error('Workflow listing context changed');
      if (record.snapshot.revision !== startedRevision) return listUserWorkflows();
      record.fetchedAt = Date.now();
      publish({ ...record.snapshot, files, status: 'ready', error: null });
      return files;
    } catch (cause) {
      if (current() === record && record.snapshot.revision === startedRevision) {
        publish({ ...record.snapshot, files: discard ? null : record.snapshot.files, status: 'error', error: cause instanceof Error ? cause : new Error(String(cause)) });
      }
      throw cause;
    } finally {
      if (record.snapshot.revision === startedRevision) record.pending = null;
    }
  })();
  record.pending = pending;
  return pending;
}

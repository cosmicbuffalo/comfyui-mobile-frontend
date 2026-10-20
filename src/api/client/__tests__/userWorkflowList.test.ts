import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  clearUserWorkflowList, getUserWorkflowListSnapshot, invalidateUserWorkflowList, listUserWorkflows,
} from '../userWorkflowList';
import {
  createUserWorkflowFolder, deleteUserWorkflow, deleteUserWorkflowFolder,
  renameUserWorkflowEntry, saveUserWorkflow,
} from '../workflows';
import type { Workflow } from '@/api/types';

const files = (name: string) => [{ type: 'file', name: `${name}.json`, path: `workflows/${name}.json` }];
const response = (name: string) => Response.json(files(name));
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => { localStorage.removeItem('comfy_multiuser_active_user'); clearUserWorkflowList(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); clearUserWorkflowList(); });

it('shares concurrent requests and reuses a fresh listing without another request', async () => {
  const pending = deferred(), fetch = vi.fn(() => pending.promise); vi.stubGlobal('fetch', fetch);
  const first = listUserWorkflows(), second = listUserWorkflows();
  expect(second).toBe(first); expect(fetch).toHaveBeenCalledTimes(1);
  pending.resolve(response('one')); expect(await first).toEqual(files('one'));
  expect(await listUserWorkflows()).toEqual(files('one')); expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('/api/v2/userdata?path=workflows', { cache: 'no-store' });
});
it('keeps cached rows visible while a stale listing refreshes', async () => {
  let now = 100_000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  const pending = deferred(), fetch = vi.fn().mockResolvedValueOnce(response('old')).mockReturnValueOnce(pending.promise);
  vi.stubGlobal('fetch', fetch); await listUserWorkflows(); now += 31_000;
  const refresh = listUserWorkflows();
  expect(getUserWorkflowListSnapshot()).toMatchObject({ files: files('old'), status: 'loading' });
  pending.resolve(response('new')); await refresh;
  expect(getUserWorkflowListSnapshot()).toMatchObject({ files: files('new'), status: 'ready' });
});
it('never repopulates with a response started before a successful mutation', async () => {
  const old = deferred();
  const fetch = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(response('saved'));
  vi.stubGlobal('fetch', fetch);
  const first = listUserWorkflows(); await saveUserWorkflow('saved.json', { nodes: [], links: [] } as unknown as Workflow);
  old.resolve(response('deleted'));
  expect(await first).toEqual(files('saved'));
  expect(getUserWorkflowListSnapshot().files).toEqual(files('saved')); expect(fetch).toHaveBeenCalledTimes(3);
});
it('invalidates after each successful save, deletion, rename/move and folder mutation', async () => {
  const fetch = vi.fn(async (_url: string, options?: RequestInit) => options?.method ? new Response(null, { status: 204 }) : response('file'));
  vi.stubGlobal('fetch', fetch);
  for (const mutate of [
    () => saveUserWorkflow('file.json', { nodes: [], links: [] } as unknown as Workflow),
    () => deleteUserWorkflow('file.json'), () => renameUserWorkflowEntry('file.json', 'folder/file.json'),
    () => createUserWorkflowFolder('folder'), () => deleteUserWorkflowFolder('folder'),
  ]) {
    await listUserWorkflows(); const before = getUserWorkflowListSnapshot().revision;
    await mutate(); expect(getUserWorkflowListSnapshot().revision).toBeGreaterThan(before);
    const calls = fetch.mock.calls.length; await listUserWorkflows(); expect(fetch).toHaveBeenCalledTimes(calls + 1);
  }
});
it('does not invalidate on a failed mutation and preserves rows on transient listing errors', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response('old')).mockResolvedValueOnce(new Response(null, { status: 500 })).mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetch); await listUserWorkflows(); const revision = getUserWorkflowListSnapshot().revision;
  await expect(deleteUserWorkflow('old.json')).rejects.toThrow(); expect(getUserWorkflowListSnapshot().revision).toBe(revision);
  await expect(listUserWorkflows({ force: true })).rejects.toThrow(); expect(getUserWorkflowListSnapshot().files).toEqual(files('old'));
});
it('clears cached names after authorization is refused', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response('old')).mockResolvedValueOnce(new Response(null, { status: 403 }));
  vi.stubGlobal('fetch', fetch); await listUserWorkflows();
  await expect(listUserWorkflows({ force: true })).rejects.toThrow(); expect(getUserWorkflowListSnapshot().files).toBeNull();
});
it('does not reuse or publish a previous account’s response', async () => {
  localStorage.setItem('comfy_multiuser_active_user', 'alice'); clearUserWorkflowList();
  const old = deferred(); vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('bob')));
  const alice = listUserWorkflows();
  localStorage.setItem('comfy_multiuser_active_user', 'bob');
  window.dispatchEvent(new StorageEvent('storage', { key: 'comfy_multiuser_active_user', newValue: 'bob' }));
  expect(getUserWorkflowListSnapshot().files).toBeNull(); await listUserWorkflows();
  old.resolve(response('alice')); await expect(alice).rejects.toThrow('context changed');
  expect(getUserWorkflowListSnapshot().files).toEqual(files('bob'));
});
it('scopes the memory cache to the server and discards it when a page is suspended', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('one'))); await listUserWorkflows();
  const origin = window.location.origin;
  vi.stubGlobal('window', { location: { origin: origin + '-other' } });
  expect(getUserWorkflowListSnapshot().files).toBeNull(); vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('two'))); await listUserWorkflows();
  window.dispatchEvent(new Event('pagehide')); expect(getUserWorkflowListSnapshot().files).toBeNull();
});
it('handles an absent workflows directory, and rejects malformed listings', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(Response.json({ nope: true })));
  expect(await listUserWorkflows()).toEqual([]); invalidateUserWorkflowList();
  await expect(listUserWorkflows()).rejects.toThrow('Invalid');
});

it('does not launch a third request when the replacement has already finished', async () => {
  const old = deferred();
  const fetch = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('new'));
  vi.stubGlobal('fetch', fetch); const first = listUserWorkflows();
  invalidateUserWorkflowList(); await listUserWorkflows();
  old.resolve(response('old')); expect(await first).toEqual(files('new'));
  expect(fetch).toHaveBeenCalledTimes(2);
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useUserWorkflowList } from '../useUserWorkflowList';
import { clearUserWorkflowList, invalidateUserWorkflowList } from '@/api/client/userWorkflowList';
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
function List({ open }: { open: boolean }) {
  const { files, loading, error } = useUserWorkflowList(open);
  return <div>{open && (loading ? 'Loading' : files.map(file => file.name).join(','))}{error}</div>;
}
beforeEach(() => { clearUserWorkflowList(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); clearUserWorkflowList(); });
it('renders warm rows immediately on reopen and during a mutation refresh', async () => {
  let finish!: (response: Response) => void;
  const file = (name: string) => Response.json([{ name, path: `workflows/${name}`, type: 'file' }]);
  const fetch = vi.fn().mockResolvedValueOnce(file('saved.json')).mockImplementationOnce(() => new Promise<Response>(yes => { finish = yes; }));
  vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<List open />)); expect(host.textContent).toBe('saved.json');
  await act(async () => root.render(<List open={false} />));
  await act(async () => root.render(<List open />)); expect(host.textContent).toBe('saved.json'); expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => invalidateUserWorkflowList());
  expect(host.textContent).toBe('saved.json'); expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => finish(file('renamed.json'))); expect(host.textContent).toBe('renamed.json');
});
it('shares one cold request between both workflow-picker consumers', async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn(() => new Promise<Response>(yes => { finish = yes; })); vi.stubGlobal('fetch', fetch);
  await act(async () => root.render(<><List open /><List open /></>));
  expect(fetch).toHaveBeenCalledTimes(1); expect(host.textContent).toBe('LoadingLoading');
  await act(async () => finish(Response.json([]))); expect(host.textContent).toBe('');
});

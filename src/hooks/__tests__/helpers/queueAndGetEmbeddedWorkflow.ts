import { expect, vi } from 'vitest';
import type { Workflow } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';

export async function queueAndGetEmbeddedWorkflow(): Promise<Workflow> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/queue')) {
      return {
        ok: true,
        json: async () => ({ queue_running: [], queue_pending: [] })
      };
    }
    return {
      ok: true,
      json: async () => ({ prompt_id: 'p-test', number: 1 })
    };
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

  await useWorkflowStore.getState().queueWorkflow(1);
  const promptCall = fetchMock.mock.calls.find(([input]) =>
    String(input).includes('/api/prompt')
  );
  expect(promptCall).toBeDefined();
  const requestInit = (promptCall as unknown as [RequestInfo | URL, RequestInit | undefined] | undefined)?.[1];
  const body = JSON.parse(String(requestInit?.body ?? '{}')) as {
    extra_data?: { extra_pnginfo?: { workflow?: Workflow } };
  };
  const embedded = body.extra_data?.extra_pnginfo?.workflow;
  expect(embedded).toBeDefined();
  return embedded as Workflow;
}

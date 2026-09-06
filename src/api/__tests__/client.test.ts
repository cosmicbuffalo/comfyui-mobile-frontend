import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteHistoryItems,
  getCoreWorkflowTemplates,
  getFileWorkflowMetadata,
  getHistory,
  getQueue,
  getTemplateThumbnailUrl,
  loadTemplateWorkflow,
  searchUserImagesByPrompt,
} from '@/api/client';

describe('getFileWorkflowMetadata', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the executed prompt beside the embedded workflow', async () => {
    const workflow = { nodes: [], links: [] };
    const prompt = { '7': { class_type: 'KSampler', inputs: { seed: 123 } } };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ workflow, prompt }),
    } as Response)));

    await expect(getFileWorkflowMetadata('folder/output.png', 'output'))
      .resolves.toEqual({ workflow, prompt });
  });

  it('omits prompt entirely when the file carries only a workflow', async () => {
    const workflow = { nodes: [], links: [] };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ workflow }),
    } as Response)));

    await expect(getFileWorkflowMetadata('folder/output.png', 'output'))
      .resolves.toEqual({ workflow });
  });

  it('surfaces the server error message when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'file not found' }),
    } as Response)));

    await expect(getFileWorkflowMetadata('missing.png', 'output'))
      .rejects.toThrow('file not found');
  });

  it('rejects a response that carries no workflow', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ prompt: {} }),
    } as Response)));

    await expect(getFileWorkflowMetadata('folder/output.png', 'output'))
      .rejects.toThrow('No workflow metadata found');
  });
});

describe('searchUserImagesByPrompt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unions name/path and prompt searches without trusting directory entries', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const params = new URL(`http://localhost${url}`).searchParams;
      const files = params.has('search')
        ? [
            { name: 'video', path: 'video', type: 'dir', date: 1 },
            {
              name: 'ComfyUI_04555_.png',
              path: '.hidden/batch/sample scene/ComfyUI_04555_.png',
              folder: '.hidden/batch/sample scene',
              type: 'image',
              date: 2,
              size: 100,
            },
          ]
        : [
            {
              name: 'ComfyUI_04555_.png',
              path: '.hidden/batch/sample scene/ComfyUI_04555_.png',
              folder: '.hidden/batch/sample scene',
              type: 'image',
              date: 2,
              size: 100,
            },
            {
              name: 'ComfyUI_04556_.png',
              path: '.hidden/batch/sample scene/ComfyUI_04556_.png',
              folder: '.hidden/batch/sample scene',
              type: 'image',
              date: 3,
              size: 101,
            },
          ];

      return {
        ok: true,
        json: async () => ({ files, total: files.length, offset: 0, limit: 0 }),
      } as Response;
    });

    vi.stubGlobal('fetch', fetchMock);

    const results = await searchUserImagesByPrompt('output', 'sample scene', null, true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes('search=sample+scene'))).toBe(true);
    expect(urls.some((url) => url.includes('prompt=sample+scene'))).toBe(true);
    expect(urls.some((url) => url.includes('q=sample+scene'))).toBe(false);
    expect(results.map((item) => item.id)).toEqual([
      'output/.hidden/batch/sample scene/ComfyUI_04555_.png',
      'output/.hidden/batch/sample scene/ComfyUI_04556_.png',
    ]);
  });
});

describe('queue bootstrap requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('bypasses browser caches for live queue and history state', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await getQueue();
    await getHistory(10);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/queue', { cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/history?max_items=10', { cache: 'no-store' });
  });

  it('reports a rejected server-side history deletion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 } as Response)));

    await expect(deleteHistoryItems(['prompt-with-deleted-video']))
      .rejects.toThrow('Failed to delete history items');
  });
});

describe('core workflow templates', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const jsonResponse = (data: unknown) => ({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => data,
  } as unknown as Response);

  const index = [
    { moduleName: 'default', title: 'Image', templates: [{ name: 'image_flux', title: 'Flux' }] },
  ];

  it('reads the catalog from the templates package index', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(index));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCoreWorkflowTemplates()).resolves.toEqual(index);
    expect(fetchMock).toHaveBeenCalledWith('/templates/index.json');
  });

  it('asks for the localized index of the current locale', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(index));
    vi.stubGlobal('fetch', fetchMock);

    await getCoreWorkflowTemplates('zh-CN');
    expect(fetchMock).toHaveBeenCalledWith('/templates/index.zh.json');
  });

  it('falls back to the English index when the locale has none', async () => {
    const fetchMock = vi.fn(async (path: string) =>
      path === '/templates/index.json'
        ? jsonResponse(index)
        : ({ ok: false, headers: { get: () => 'text/plain' } } as unknown as Response),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCoreWorkflowTemplates('ja')).resolves.toEqual(index);
    expect(fetchMock).toHaveBeenCalledWith('/templates/index.ja.json');
    expect(fetchMock).toHaveBeenCalledWith('/templates/index.json');
  });

  it('ignores an HTML answer from a server without the templates package', async () => {
    // A missing /templates mount can fall through to the app's own index.html.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'text/html' },
      json: async () => index,
    } as unknown as Response)));

    await expect(getCoreWorkflowTemplates()).resolves.toEqual([]);
  });

  it('resolves empty rather than throwing when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

    await expect(getCoreWorkflowTemplates()).resolves.toEqual([]);
  });

  it('drops entries that are not template categories', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([...index, { title: 'Broken' }, null])));

    await expect(getCoreWorkflowTemplates()).resolves.toEqual(index);
  });

  it('loads a core template from the flat templates path', async () => {
    const workflow = { nodes: [] };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => workflow } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadTemplateWorkflow('default', 'image_flux')).resolves.toEqual(workflow);
    expect(fetchMock).toHaveBeenCalledWith('/templates/image_flux.json');
  });

  it('still loads a custom node template from its module path', async () => {
    const workflow = { nodes: [] };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => workflow } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await loadTemplateWorkflow('some-pack', 'example');
    expect(fetchMock).toHaveBeenCalledWith('/api/workflow_templates/some-pack/example.json');
  });

  it('builds thumbnail urls per source', () => {
    expect(getTemplateThumbnailUrl('default', { name: 'image_flux', mediaSubtype: 'webp' }))
      .toBe('/templates/image_flux-1.webp');
    expect(getTemplateThumbnailUrl('some-pack', { name: 'example' }))
      .toBe('/api/workflow_templates/some-pack/example.jpg');
  });

  it('has no thumbnail for an audio template', () => {
    expect(getTemplateThumbnailUrl('default', {
      name: 'audio_ace',
      mediaType: 'audio',
      mediaSubtype: 'mp3',
    })).toBeNull();
  });
});

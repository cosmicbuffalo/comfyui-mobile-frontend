import { afterEach, describe, expect, it, vi } from 'vitest';
import { runningEntryChunk, serverEntryChunk } from '../appUpdate';

/**
 * Update detection compares content-hashed entry-chunk names, so both halves
 * must extract the same identity from their respective sources — and both must
 * fail OPEN (null) when their source doesn't look like a production build, or
 * dev servers and flaky connections would trigger phantom updates.
 */

function docWithScripts(srcs: string[]): Pick<Document, 'querySelectorAll'> {
  const doc = document.implementation.createHTMLDocument('');
  for (const src of srcs) {
    const script = doc.createElement('script');
    script.setAttribute('src', src);
    doc.body.appendChild(script);
  }
  return doc;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runningEntryChunk', () => {
  it('finds the hashed entry chunk among the document scripts', () => {
    const doc = docWithScripts([
      '/mobile/sw.js',
      '/mobile/assets/index-BrpYGFVV.js',
    ]);
    expect(runningEntryChunk(doc)).toBe('assets/index-BrpYGFVV.js');
  });

  it('returns null when no hashed entry is present (dev server)', () => {
    const doc = docWithScripts(['/src/main.tsx']);
    expect(runningEntryChunk(doc)).toBeNull();
  });
});

describe('serverEntryChunk', () => {
  it("extracts the entry chunk from the served index.html", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () =>
        '<script type="module" crossorigin src="/mobile/assets/index-Xyz12345.js"></script>',
    })) as unknown as typeof fetch);
    expect(await serverEntryChunk()).toBe('assets/index-Xyz12345.js');
  });

  it('returns null on a page without an entry chunk (auth gate sign-in page)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => '<html><body>Sign in</body></html>',
    })) as unknown as typeof fetch);
    expect(await serverEntryChunk()).toBeNull();
  });

  it('returns null on an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      text: async () => '',
    })) as unknown as typeof fetch);
    expect(await serverEntryChunk()).toBeNull();
  });

  it('returns null when the fetch dies at the network layer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Load failed');
    }) as unknown as typeof fetch);
    expect(await serverEntryChunk()).toBeNull();
  });
});

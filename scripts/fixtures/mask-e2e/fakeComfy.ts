/**
 * An in-page stand-in for the three ComfyUI endpoints the mask editor uses.
 *
 * The editor's contract with the server is almost entirely about *pixels*:
 * which channel `/view` hands back, and how `/upload/mask` merges an alpha onto
 * an existing file. Stubbing those with fixed fixtures would test nothing, so
 * this reimplements the same operations `server.py` performs, in canvas terms:
 *
 *   GET /view?channel=rgb   -> the pixels with alpha dropped
 *   GET /view?channel=a     -> transparent BLACK carrying the original alpha
 *                              (Image.new('RGBA') + putalpha), NOT greyscale
 *   GET /view (no channel)  -> the file as stored
 *   POST /upload/mask       -> copy the posted file's alpha onto `original_ref`
 *   POST /upload/image      -> store as posted
 *
 * Images are held as ImageData, so a save really does round-trip through the
 * same channel split the real server performs.
 */

interface StoredFile {
  data: ImageData;
}

const files = new Map<string, StoredFile>();

function key(filename: string, subfolder: string): string {
  return `${subfolder || ''}/${filename}`;
}

function toCanvas(data: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  return canvas;
}

async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  // Read the dimensions before closing: close() zeroes them.
  const { width, height } = bitmap;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, width, height);
}

/**
 * Files survive a reload, so the refresh test has something to reopen.
 *
 * Stored as RAW pixel buffers, not data URLs. Round-tripping through a canvas
 * premultiplies alpha, which destroys the colour channels of any pixel the
 * mask made transparent -- the restored image would come back subtly different
 * from the one in memory and every post-reload comparison would drift. A real
 * ComfyUI keeps PNGs on disk, where this does not happen.
 */
const PERSIST_KEY = 'mask-e2e-files';

function persistFiles(): void {
  // Everything here is best-effort, encoding included: a quota or size failure
  // must not propagate into the upload response that called it.
  try {
    const payload: Record<string, { w: number; h: number; b64: string }> = {};
    for (const [k, file] of files) {
      let binary = '';
      const bytes = new Uint8Array(file.data.data.buffer);
      // Chunked: String.fromCharCode(...bytes) blows the argument limit.
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      payload[k] = { w: file.data.width, h: file.data.height, b64: btoa(binary) };
    }
    sessionStorage.setItem(PERSIST_KEY, JSON.stringify(payload));
  } catch {
    // Quota or size — the non-reload checks still work.
  }
}

export function restoreFiles(): void {
  let payload: Record<string, { w: number; h: number; b64: string }>;
  try {
    payload = JSON.parse(sessionStorage.getItem(PERSIST_KEY) ?? '{}');
  } catch {
    return;
  }
  for (const [k, entry] of Object.entries(payload)) {
    const binary = atob(entry.b64);
    const bytes = new Uint8ClampedArray(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    files.set(k, { data: new ImageData(bytes, entry.w, entry.h) });
  }
}

export function seedFile(filename: string, subfolder: string, data: ImageData): void {
  if (files.has(key(filename, subfolder))) return; // a restored file wins
  files.set(key(filename, subfolder), { data });
  persistFiles();
}

export function storedFilenames(): string[] {
  return [...files.keys()];
}

function renderChannel(data: ImageData, channel: string | null): HTMLCanvasElement {
  const out = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  if (channel === 'rgb') {
    // img.convert("RGB") — alpha is discarded, so the file reads as opaque.
    for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  } else if (channel === 'a') {
    // Image.new('RGBA', size) then putalpha(a): colour channels are ZERO and
    // the value lives in alpha. Read as greyscale instead and every image
    // opens fully masked.
    for (let i = 0; i < out.data.length; i += 4) {
      out.data[i] = 0;
      out.data[i + 1] = 0;
      out.data[i + 2] = 0;
    }
  }
  return toCanvas(out);
}

/**
 * Patch `fetch` and `Image` so the editor talks to the store above.
 *
 * `Image` has to be patched too: the editor loads layers with `new Image()`,
 * which never goes through fetch.
 */
export function installFakeComfy(): void {
  const RealImage = window.Image;

  class FakeImage extends RealImage {
    override set src(value: string) {
      if (!value.includes('/view')) {
        super.src = value;
        return;
      }
      const url = new URL(value, window.location.origin);
      const filename = url.searchParams.get('filename') ?? '';
      const subfolder = url.searchParams.get('subfolder') ?? '';
      const stored = files.get(key(filename, subfolder));
      if (!stored) {
        // Mirror a 404: the editor treats a failed optional layer as absent.
        queueMicrotask(() => this.dispatchEvent(new Event('error')));
        return;
      }
      super.src = renderChannel(stored.data, url.searchParams.get('channel')).toDataURL('image/png');
    }
    override get src(): string {
      return super.src;
    }
  }
  window.Image = FakeImage as unknown as typeof Image;

  const realFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === 'string' ? input : (input as Request).url ?? input);
    if (!url.includes('/upload/')) return realFetch(input as RequestInfo, init);

    const form = init!.body as FormData;
    const file = form.get('image') as File;
    const subfolder = String(form.get('subfolder') ?? 'clipspace');
    const originalRef = JSON.parse(String(form.get('original_ref'))) as {
      filename: string; subfolder: string; type: string;
    };

    const posted = await blobToImageData(file);

    if (url.includes('/upload/mask')) {
      // The server-side merge: take OUR alpha, put it on THEIR pixels.
      const original = files.get(key(originalRef.filename, originalRef.subfolder));
      if (!original) {
        return new Response(JSON.stringify({ error: 'original missing' }), { status: 400 });
      }
      const merged = new ImageData(
        new Uint8ClampedArray(original.data.data), original.data.width, original.data.height,
      );
      for (let i = 3; i < merged.data.length; i += 4) merged.data[i] = posted.data[i];
      files.set(key(file.name, subfolder), { data: merged });
    } else {
      files.set(key(file.name, subfolder), { data: posted });
    }
    persistFiles();

    return new Response(
      JSON.stringify({ name: file.name, subfolder, type: 'input' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;
}

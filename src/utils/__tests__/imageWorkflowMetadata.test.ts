import { describe, expect, it } from 'vitest';
import {
  extractWorkflowMetadataFromImageBytes,
  extractWorkflowMetadataFromImageFile,
  isWorkflowImageFile,
} from '../imageWorkflowMetadata';

/** The workflow half of the metadata, which is all most of these cases assert on. */
const workflowFromBytes = (bytes: Uint8Array) =>
  extractWorkflowMetadataFromImageBytes(bytes)?.workflow ?? null;

const SAMPLE_WORKFLOW = JSON.stringify({
  nodes: [{ id: 1, type: 'KSampler' }],
  links: [],
});

function ascii(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0));
}

// --- PNG builders ---------------------------------------------------------
function pngChunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [
    (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff,
    ...ascii(type),
    ...data,
    0, 0, 0, 0, // dummy CRC (parser doesn't validate)
  ];
}

function makePng(textChunks: Array<{ keyword: string; text: string }>): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const body: number[] = [];
  for (const { keyword, text } of textChunks) {
    body.push(...pngChunk('tEXt', [...ascii(keyword), 0, ...ascii(text)]));
  }
  body.push(...pngChunk('IEND', []));
  return Uint8Array.from([...sig, ...body]);
}

// --- EXIF (TIFF, little-endian) builder, used by webp + jpeg -------------
function makeExifWithMake(value: string): number[] {
  return makeExifWithMakeBytes(ascii(value));
}

// Build EXIF whose Make tag holds the given raw bytes (null-terminated). Lets a
// test feed UTF-8-encoded content, not just Latin-1.
function makeExifWithMakeBytes(valueBytes: number[]): number[] {
  const str = [...valueBytes, 0]; // null-terminated
  const count = str.length;
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
  return [
    ...ascii('II'), ...u16(0x2a), ...u32(8), // TIFF header, IFD0 at offset 8
    ...u16(1), // one entry
    ...u16(0x010f), ...u16(2), ...u32(count), ...u32(26), // Make, ASCII, count, value@26
    ...u32(0), // no next IFD
    ...str, // value at offset 26
  ];
}

function makeWebp(exif: number[]): Uint8Array {
  const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
  const pad = exif.length & 1 ? [0] : [];
  const body = [...ascii('WEBP'), ...ascii('EXIF'), ...u32le(exif.length), ...exif, ...pad];
  return Uint8Array.from([...ascii('RIFF'), ...u32le(body.length), ...body]);
}

function makeJpeg(exif: number[]): Uint8Array {
  const payload = [...ascii('Exif'), 0, 0, ...exif];
  const len = payload.length + 2; // APP1 length includes the 2 length bytes
  return Uint8Array.from([
    0xff, 0xd8, // SOI
    0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload, // APP1 / EXIF
    0xff, 0xd9, // EOI
  ]);
}

describe('isWorkflowImageFile', () => {
  it('matches by mime type', () => {
    expect(isWorkflowImageFile({ type: 'image/png' })).toBe(true);
    expect(isWorkflowImageFile({ type: 'image/webp' })).toBe(true);
    expect(isWorkflowImageFile({ type: 'application/json' })).toBe(false);
  });
  it('matches by extension', () => {
    expect(isWorkflowImageFile({ name: 'out.PNG' })).toBe(true);
    expect(isWorkflowImageFile({ name: 'out.jpeg' })).toBe(true);
    expect(isWorkflowImageFile({ name: 'flow.json' })).toBe(false);
  });
});

describe('extractWorkflowMetadataFromImageBytes', () => {
  it('extracts a workflow from a PNG tEXt chunk', () => {
    const png = makePng([
      { keyword: 'prompt', text: '{"foo":1}' },
      { keyword: 'workflow', text: SAMPLE_WORKFLOW },
    ]);
    const wf = workflowFromBytes(png);
    expect(wf).not.toBeNull();
    expect(wf!.nodes[0].type).toBe('KSampler');
  });

  it('extracts the executed prompt alongside a PNG workflow', () => {
    const prompt = { '1': { class_type: 'KSampler', inputs: { seed: 123 } } };
    const png = makePng([
      { keyword: 'prompt', text: JSON.stringify(prompt) },
      { keyword: 'workflow', text: SAMPLE_WORKFLOW },
    ]);
    expect(extractWorkflowMetadataFromImageBytes(png)).toEqual({
      workflow: JSON.parse(SAMPLE_WORKFLOW),
      prompt,
    });
  });

  it('returns null for a PNG with no workflow chunk', () => {
    const png = makePng([{ keyword: 'prompt', text: '{"foo":1}' }]);
    expect(workflowFromBytes(png)).toBeNull();
  });

  it('returns null when the embedded value is not valid JSON', () => {
    const png = makePng([{ keyword: 'workflow', text: 'not json {{{' }]);
    expect(workflowFromBytes(png)).toBeNull();
  });

  it('returns null when the JSON lacks a nodes array', () => {
    const png = makePng([{ keyword: 'workflow', text: '{"links":[]}' }]);
    expect(workflowFromBytes(png)).toBeNull();
  });

  it('extracts a workflow from WEBP EXIF (Make = "workflow:{json}")', () => {
    const webp = makeWebp(makeExifWithMake(`workflow:${SAMPLE_WORKFLOW}`));
    const wf = workflowFromBytes(webp);
    expect(wf).not.toBeNull();
    expect(wf!.nodes[0].id).toBe(1);
  });

  it('extracts a workflow from JPEG EXIF (Make = "workflow:{json}")', () => {
    const jpeg = makeJpeg(makeExifWithMake(`workflow:${SAMPLE_WORKFLOW}`));
    const wf = workflowFromBytes(jpeg);
    expect(wf).not.toBeNull();
    expect(wf!.nodes[0].id).toBe(1);
  });

  it('decodes EXIF as UTF-8 so non-Latin-1 characters survive', () => {
    // ComfyUI packs UTF-8 JSON into the (nominally ASCII) EXIF tag; a Latin-1
    // decode would mojibake emoji/CJK in prompts and node titles. It still
    // parses as JSON, so the workflow loads looking fine but corrupted, and a
    // re-run generates from the mangled prompt.
    const wfWithEmoji = JSON.stringify({
      nodes: [{ id: 1, type: 'KSampler', title: 'Sampler \u{1F7E2} \u65E5\u672C\u8A9E' }],
      links: [],
    });
    const bytes = Array.from(new TextEncoder().encode(`workflow:${wfWithEmoji}`));
    const webp = makeWebp(makeExifWithMakeBytes(bytes));
    const wf = workflowFromBytes(webp);
    expect(wf).not.toBeNull();
    expect((wf!.nodes[0] as { title?: string }).title).toBe('Sampler \u{1F7E2} \u65E5\u672C\u8A9E');
  });

  it('ignores EXIF that holds only a prompt (no workflow tag)', () => {
    const webp = makeWebp(makeExifWithMake(`prompt:${SAMPLE_WORKFLOW}`));
    expect(workflowFromBytes(webp)).toBeNull();
  });

  it('returns null for non-image bytes', () => {
    expect(workflowFromBytes(Uint8Array.from(ascii('just text')))).toBeNull();
  });
});

describe('extractWorkflowMetadataFromImageFile', () => {
  // The picked/dropped-file entry point: everything above works on bytes, this
  // is the only path that reads a File first.
  // jsdom's Blob has no arrayBuffer(), so the real File gets the one method
  // this function calls patched on rather than being replaced by a bare stub.
  const asFile = (bytes: Uint8Array, name = 'output.png') => {
    const file = new File([bytes as BlobPart], name, { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    return file;
  };

  it('reads a File and returns its workflow and executed prompt', async () => {
    const prompt = { '1': { class_type: 'KSampler', inputs: { seed: 7 } } };
    const png = makePng([
      { keyword: 'prompt', text: JSON.stringify(prompt) },
      { keyword: 'workflow', text: SAMPLE_WORKFLOW },
    ]);

    await expect(extractWorkflowMetadataFromImageFile(asFile(png))).resolves.toEqual({
      workflow: JSON.parse(SAMPLE_WORKFLOW),
      prompt,
    });
  });

  it('resolves null for a File with no embedded workflow', async () => {
    const png = makePng([{ keyword: 'prompt', text: '{"foo":1}' }]);
    await expect(extractWorkflowMetadataFromImageFile(asFile(png))).resolves.toBeNull();
  });
});

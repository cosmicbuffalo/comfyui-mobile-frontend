import type { Workflow } from '@/api/types';

// Extract a ComfyUI workflow embedded in an image's metadata, entirely on the
// client (no upload/round-trip). ComfyUI embeds the litegraph workflow JSON as:
//   - PNG : a tEXt/iTXt chunk with keyword "workflow" (SaveImage uses PngInfo).
//   - WEBP/JPEG : EXIF, where the Make tag (0x010F) holds "workflow:{json}" and
//     the Model tag (0x0110) holds "prompt:{json}" (comfy_api ImageSaveHelper).
// Returns null when the file isn't a supported image, has no embedded workflow,
// or the embedded value isn't a valid workflow.

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const IMAGE_MIME = /^image\/(png|jpeg|jpg|webp)$/i;

/** Whether a file looks like a workflow-carrying image (by MIME or extension). */
export function isWorkflowImageFile(file: { name?: string; type?: string }): boolean {
  if (file.type && IMAGE_MIME.test(file.type)) return true;
  const name = (file.name ?? '').toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function fourCC(bytes: Uint8Array, off: number): string {
  return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(b: Uint8Array): boolean {
  return PNG_SIGNATURE.every((v, i) => b[i] === v);
}

// Walk PNG chunks and return the value of the first tEXt/iTXt chunk whose keyword
// matches. Handles uncompressed tEXt (what ComfyUI writes) and uncompressed iTXt;
// compressed (zTXt / iTXt flag) chunks are skipped.
function readPngTextValue(b: Uint8Array, keyword: string): string | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 8;
  while (off + 8 <= b.length) {
    const len = view.getUint32(off);
    const type = fourCC(b, off + 4);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > b.length) break;
    if (type === 'IEND') break;

    if (type === 'tEXt') {
      let z = dataStart;
      while (z < dataEnd && b[z] !== 0) z++;
      if (latin1(b, dataStart, z) === keyword) {
        return latin1(b, z + 1, dataEnd);
      }
    } else if (type === 'iTXt') {
      let z = dataStart;
      while (z < dataEnd && b[z] !== 0) z++;
      if (latin1(b, dataStart, z) === keyword) {
        const compressionFlag = b[z + 1];
        // z+2 = compression method; then null-terminated language tag and
        // translated keyword precede the text payload.
        let p = z + 3;
        while (p < dataEnd && b[p] !== 0) p++;
        p++;
        while (p < dataEnd && b[p] !== 0) p++;
        p++;
        if (compressionFlag === 0 && p <= dataEnd) {
          return new TextDecoder('utf-8').decode(b.subarray(p, dataEnd));
        }
      }
    }
    off = dataEnd + 4; // skip CRC
  }
  return null;
}

function isWebp(b: Uint8Array): boolean {
  return (
    b.length >= 12 &&
    fourCC(b, 0) === 'RIFF' &&
    fourCC(b, 8) === 'WEBP'
  );
}

function isJpeg(b: Uint8Array): boolean {
  return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

// EXIF payload may be prefixed with the "Exif\0\0" marker (JPEG always, WEBP
// sometimes) — strip it so the TIFF header is at offset 0.
function stripExifPrefix(b: Uint8Array): Uint8Array {
  if (b.length >= 6 && b[0] === 0x45 && b[1] === 0x78 && b[2] === 0x69 && b[3] === 0x66 && b[4] === 0 && b[5] === 0) {
    return b.subarray(6);
  }
  return b;
}

function readWebpExif(b: Uint8Array): Uint8Array | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 12;
  while (off + 8 <= b.length) {
    const cc = fourCC(b, off);
    const size = view.getUint32(off + 4, true);
    const dataStart = off + 8;
    if (dataStart + size > b.length) break;
    if (cc === 'EXIF') return stripExifPrefix(b.subarray(dataStart, dataStart + size));
    off = dataStart + size + (size & 1); // chunks are padded to even length
  }
  return null;
}

function readJpegExif(b: Uint8Array): Uint8Array | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 2;
  while (off + 4 <= b.length) {
    if (b[off] !== 0xff) break;
    const marker = b[off + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan
    const len = view.getUint16(off + 2);
    const segStart = off + 4;
    if (segStart + len - 2 > b.length) break;
    if (marker === 0xe1) {
      const seg = b.subarray(segStart, off + 2 + len);
      const stripped = stripExifPrefix(seg);
      if (stripped !== seg) return stripped;
    }
    off = off + 2 + len;
  }
  return null;
}

// Parse the TIFF/EXIF IFD0 and return the ASCII value of the first matching tag
// (Make 0x010F or ImageDescription 0x010E) — ComfyUI stores "workflow:{json}".
function readExifTagString(exif: Uint8Array, tags: number[]): string | null {
  if (exif.length < 8) return null;
  const little = exif[0] === 0x49 && exif[1] === 0x49;
  const big = exif[0] === 0x4d && exif[1] === 0x4d;
  if (!little && !big) return null;
  const view = new DataView(exif.buffer, exif.byteOffset, exif.byteLength);
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);

  const ifd0 = u32(4);
  if (ifd0 + 2 > exif.length) return null;
  const count = u16(ifd0);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > exif.length) break;
    const tag = u16(entry);
    if (!tags.includes(tag)) continue;
    const type = u16(entry + 2);
    if (type !== 2) continue; // ASCII
    const length = u32(entry + 4);
    const valueOffset = length <= 4 ? entry + 8 : u32(entry + 8);
    if (valueOffset + length > exif.length) continue;
    let end = valueOffset + length;
    while (end > valueOffset && exif[end - 1] === 0) end--;
    // The tag is nominally EXIF ASCII, but ComfyUI packs UTF-8 JSON into it, so
    // decode as UTF-8 (a superset of ASCII) to preserve non-Latin-1 characters
    // such as emoji/CJK in node titles and notes.
    return new TextDecoder('utf-8').decode(exif.subarray(valueOffset, end));
  }
  return null;
}

function readExifWorkflow(exif: Uint8Array | null): string | null {
  if (!exif) return null;
  const value = readExifTagString(exif, [0x010f, 0x010e]);
  if (!value) return null;
  const sep = value.indexOf(':');
  if (sep === -1) return null;
  if (value.slice(0, sep).trim().toLowerCase() !== 'workflow') return null;
  return value.slice(sep + 1);
}

function parseWorkflowJson(raw: string | null): Workflow | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Workflow;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.nodes)) {
      return parsed;
    }
  } catch {
    // not valid JSON — treat as "no workflow"
  }
  return null;
}

/** Extract an embedded workflow from raw image bytes, or null if none/invalid. */
export function extractWorkflowFromImageBytes(bytes: Uint8Array): Workflow | null {
  if (isPng(bytes)) return parseWorkflowJson(readPngTextValue(bytes, 'workflow'));
  if (isWebp(bytes)) return parseWorkflowJson(readExifWorkflow(readWebpExif(bytes)));
  if (isJpeg(bytes)) return parseWorkflowJson(readExifWorkflow(readJpegExif(bytes)));
  return null;
}

/** Read a File and extract its embedded ComfyUI workflow, or null if none. */
export async function extractWorkflowFromImageFile(file: File): Promise<Workflow | null> {
  const buffer = await file.arrayBuffer();
  return extractWorkflowFromImageBytes(new Uint8Array(buffer));
}

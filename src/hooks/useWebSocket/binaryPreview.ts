export type ParsedBinaryPreview =
  | { kind: 'image'; blob: Blob }
  | { kind: 'vhs'; nodeId: string; index: number; blob: Blob }
  | null;

/** Magic numbers for every container a preview could plausibly arrive in.
 * Core Comfy only ever sends JPEG or PNG (`PromptServer.send_image` hardcodes
 * both), but a custom node can push anything through the same envelope, so the
 * list stays permissive — its job is to separate images from protocol bytes,
 * not to police formats. Add to it rather than loosening the check. */
const looksLikeImage = (bytes: Uint8Array, offset: number): boolean => {
  const at = (i: number) => bytes[offset + i];
  if (at(0) === 0xff && at(1) === 0xd8) return true; // JPEG
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return true; // PNG
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return true; // GIF
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46) return true; // RIFF/WebP
  if (at(0) === 0x42 && at(1) === 0x4d) return true; // BMP
  return false;
};

// One line the first time a frame arrives that we cannot decode. The bug this
// guards against was silent for six days precisely because an unparseable
// frame degraded into a mislabeled Blob and a broken <img> instead of an
// error, so the interesting event is "it happened at all", not the count.
let warnedUnparseablePreview = false;
const warnUnparseablePreview = (data: ArrayBuffer) => {
  if (warnedUnparseablePreview) return;
  warnedUnparseablePreview = true;
  const head = Array.from(new Uint8Array(data.slice(0, 20)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  console.warn(
    `[preview] dropped an undecodable binary preview frame (${data.byteLength} bytes): ${head}`,
  );
};

/** Decode stock Comfy preview envelopes and VHS's extended animated-latent
 * envelope without ever feeding protocol bytes into an image Blob. Returns
 * null rather than guessing: a frame we cannot place is a protocol mismatch to
 * be fixed, and passing it through as an image only hides that. */
export function parseBinaryPreviewMessage(data: ArrayBuffer): ParsedBinaryPreview {
  if (data.byteLength < 8) return null;
  const view = new DataView(data);
  const type = view.getUint32(0, false);
  if (type === 1) {
    const imageType = view.getUint32(4, false);
    const bytes = new Uint8Array(data);
    // Prefer an ordinary Comfy preview when its payload begins with real image
    // magic. This prevents random JPEG bytes at offset 32 from looking like a
    // plausible VHS header.
    const stockJpeg = bytes[8] === 0xff && bytes[9] === 0xd8;
    const stockPng = bytes[8] === 0x89 && bytes[9] === 0x50;
    if (stockJpeg || stockPng) {
      return {
        kind: 'image',
        blob: new Blob([data.slice(8)], { type: stockPng ? 'image/png' : 'image/jpeg' }),
      };
    }
    // VHS: [type][imageType][pad][index][16-byte Pascal node id][JPEG].
    // VHS writes TWO leading uint32s of its own into the payload, and
    // PromptServer.encode_bytes prepends the event type on top — three in all,
    // so the frame index starts at 32 bytes in, not 28. (Desktop reads the same
    // fields 8 bytes into the Blob Comfy's api.js hands it; that Blob is this
    // buffer from offset 8, which is where the extra word goes.)
    if (data.byteLength > 34 && imageType === 1) {
      const idLength = view.getUint8(16);
      const jpegOffset = 32;
      const jpegHeader = bytes[jpegOffset] === 0xff && bytes[jpegOffset + 1] === 0xd8;
      if (idLength > 0 && idLength <= 15 && jpegHeader) {
        const nodeId = new TextDecoder().decode(data.slice(17, 17 + idLength));
        return {
          kind: 'vhs',
          nodeId,
          index: view.getUint32(12, false),
          blob: new Blob([data.slice(jpegOffset)], { type: 'image/jpeg' }),
        };
      }
    }
    // Neither envelope matched. If the payload is still recognisably an image
    // (an exotic container from a custom node) pass it through; otherwise it is
    // protocol we don't speak, and handing it to an <img> just paints nothing.
    if (!looksLikeImage(bytes, 8)) {
      warnUnparseablePreview(data);
      return null;
    }
    const mime = imageType === 2 ? 'image/png' : 'image/jpeg';
    return { kind: 'image', blob: new Blob([data.slice(8)], { type: mime }) };
  }
  if (type === 4) {
    try {
      const jsonLen = view.getUint32(4, false);
      const offset = 8 + jsonLen;
      // Require at least the sniffed header: no real image is under 4 bytes,
      // and a truncated payload must not become a mislabeled Blob.
      if (offset + 4 > data.byteLength) return null;
      const bytes = new Uint8Array(data);
      if (!looksLikeImage(bytes, offset)) {
        warnUnparseablePreview(data);
        return null;
      }
      const mime = bytes[offset] === 0x89 && bytes[offset + 1] === 0x50
        ? 'image/png'
        : 'image/jpeg';
      return { kind: 'image', blob: new Blob([data.slice(offset)], { type: mime }) };
    } catch {
      return null;
    }
  }
  return null;
}

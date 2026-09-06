/**
 * The clipspace contract: how a mask-edited image is named, stored and
 * referenced so ComfyUI (and the desktop frontend) can read it back.
 *
 * ComfyUI carries a mask as the *alpha channel of a PNG in `input/clipspace`* —
 * there is no separate mask file. `LoadImage` reads that alpha out as its MASK
 * output, inverted: alpha 0 means masked. `/upload/mask` is what performs the
 * merge server-side, copying the uploaded file's alpha onto the original image
 * (and preserving the original's PNG text chunks, so an embedded workflow
 * survives being masked).
 *
 * Every name and shape here is load-bearing for round-tripping with the desktop
 * editor: it recovers the other three layers of a previous edit by pattern
 * matching on `clipspace-painted-masked-<timestamp>.png`, so if we name our
 * files anything else, re-opening our mask on a desktop silently loses the
 * paint layer.
 */

export interface ImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

/** Where every layer of an edit is written. */
export const CLIPSPACE_SUBFOLDER = 'clipspace';

/**
 * The filename prefix the desktop loader keys off to recognise one of its own
 * saves and recover the sibling layers.
 */
export const PAINTED_MASKED_PREFIX = 'clipspace-painted-masked-';

export interface LayerFilenames {
  /** Original image with the mask applied as alpha. */
  maskedImage: string;
  /** The RGB paint strokes alone, on transparent. */
  paint: string;
  /** Original image with paint composited in, no mask. */
  paintedImage: string;
  /** Paint composited in AND the mask applied as alpha. This is the one the node points at. */
  paintedMaskedImage: string;
}

export function layerFilenames(timestamp: number): LayerFilenames {
  return {
    maskedImage: `clipspace-mask-${timestamp}.png`,
    paint: `clipspace-paint-${timestamp}.png`,
    paintedImage: `clipspace-painted-${timestamp}.png`,
    paintedMaskedImage: `${PAINTED_MASKED_PREFIX}${timestamp}.png`,
  };
}

/**
 * Recover the sibling layer filenames for an image that is itself the product
 * of a previous mask edit. Returns null for anything else, which is how a
 * first-time edit of an ordinary image is distinguished from re-opening one.
 */
export function layerFilenamesForImage(filename: string): LayerFilenames | null {
  if (!filename.startsWith(PAINTED_MASKED_PREFIX)) return null;
  const suffix = filename.slice(PAINTED_MASKED_PREFIX.length);
  const timestamp = Number.parseInt(suffix.split('.')[0], 10);
  if (!Number.isFinite(timestamp)) return null;
  return layerFilenames(timestamp);
}

export function clipspaceRef(filename: string): ImageRef {
  return { filename, subfolder: CLIPSPACE_SUBFOLDER, type: 'input' };
}

/**
 * Parse an image widget's value into a ref.
 *
 * Widget values look like `sub/folder/name.png [input]`; the type suffix is
 * optional and defaults to `input`, because that is the only folder LoadImage
 * reads from.
 */
export function parseImageWidgetValue(value: string): ImageRef {
  let filename = value.trim();
  let type = 'input';

  const typeMatch = filename.match(/\s\[([^\]]+)\]$/);
  if (typeMatch) {
    type = typeMatch[1];
    filename = filename.slice(0, filename.length - typeMatch[0].length);
  }

  filename = filename.replace(/^\/+/, '');
  const lastSlash = filename.lastIndexOf('/');
  const subfolder = lastSlash === -1 ? '' : filename.slice(0, lastSlash);
  return { filename: lastSlash === -1 ? filename : filename.slice(lastSlash + 1), subfolder, type };
}

/**
 * Render a ref back into an image widget value.
 *
 * The `[input]` suffix is emitted for every type: it is what
 * `folder_paths.annotated_filepath` reads to decide which directory to look in,
 * and omitting it makes a clipspace file resolve against the wrong root.
 */
export function formatImageWidgetValue(ref: ImageRef): string {
  const path = ref.subfolder ? `${ref.subfolder}/${ref.filename}` : ref.filename;
  return ref.type ? `${path} [${ref.type}]` : path;
}

/**
 * Build a `/view` URL for a ref.
 *
 * `channel` is ComfyUI's server-side channel extractor: `rgb` drops the alpha
 * (giving the flattened base image) and `a` returns the alpha as greyscale.
 * That pair is how an existing mask is recovered when re-opening an edit —
 * there is no other way to read the two apart from one PNG.
 */
export function viewUrl(
  ref: ImageRef,
  options?: { channel?: 'rgb' | 'a'; cacheBust?: string | number },
): string {
  const params = new URLSearchParams();
  params.set('filename', ref.filename);
  params.set('subfolder', ref.subfolder ?? '');
  params.set('type', ref.type || 'input');
  if (options?.channel) params.set('channel', options.channel);
  if (options?.cacheBust !== undefined) params.set('rand', String(options.cacheBust));
  return `/view?${params.toString()}`;
}

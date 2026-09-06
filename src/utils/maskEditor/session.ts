import { uploadClipspaceImage, uploadMaskFile } from '@/api/client';
import { canvasToPngBlob, type ComposedLayers } from './compose';
import {
  clipspaceRef,
  layerFilenames,
  layerFilenamesForImage,
  viewUrl,
  type ImageRef,
} from './clipspace';

/**
 * Loading an image into the editor, and writing an edit back out.
 *
 * Both halves are the mobile port of ComfyUI's `useMaskEditorLoader` /
 * `useMaskEditorSaver`, minus the desktop-only Cloud branches (the
 * `/files/mask-layers` lookup and the filename-without-subfolder widget format,
 * neither of which exists on a self-hosted install).
 */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image: ${url}`));
    image.src = url;
  });
}

/** Tolerates a missing sibling layer — an edit saved before paint layers existed has none. */
async function loadOptionalImage(url: string): Promise<HTMLImageElement | null> {
  try {
    return await loadImage(url);
  } catch {
    return null;
  }
}

export interface LoadedMaskSource {
  base: HTMLImageElement;
  /** Greyscale render of the source's alpha channel, or null if it has none to speak of. */
  alpha: HTMLImageElement | null;
  /** RGB paint strokes recovered from a previous edit. */
  paint: HTMLImageElement | null;
  /**
   * The image the mask is drawn *over*, which is what `/upload/mask` merges
   * into. For a re-edit this is the earlier `clipspace-mask-*` file, not the
   * file the node points at.
   */
  sourceRef: ImageRef;
}

/**
 * Fetch everything the editor needs for one image.
 *
 * ComfyUI stores a mask as a PNG's alpha channel, so the base pixels and the
 * mask come from the *same file*, pulled apart by `/view?channel=`. When the
 * image is itself the output of a previous edit, its sibling layers are
 * recovered by filename so the paint strokes come back editable rather than
 * baked into the picture.
 */
export async function loadMaskEditorSource(ref: ImageRef): Promise<LoadedMaskSource> {
  const siblings = layerFilenamesForImage(ref.filename);

  // Re-editing: the `clipspace-mask-*` sibling is the original image carrying
  // only the mask, so it restores both the clean base and the previous mask.
  // Its paint lives separately and is composited back on its own layer.
  const sourceRef = siblings ? clipspaceRef(siblings.maskedImage) : ref;

  // Cache-bust: clipspace filenames are reused across saves within the same
  // millisecond-stamped name only rarely, but `/view` responses are cacheable
  // and a stale hit would silently load the previous edit.
  const cacheBust = `${sourceRef.filename}-${sourceRef.subfolder}`;

  const [base, alpha, paint] = await Promise.all([
    loadImage(viewUrl(sourceRef, { channel: 'rgb', cacheBust })),
    loadOptionalImage(viewUrl(sourceRef, { channel: 'a', cacheBust })),
    siblings
      ? loadOptionalImage(viewUrl(clipspaceRef(siblings.paint), { cacheBust }))
      : Promise.resolve(null),
  ]);

  return { base, alpha, paint, sourceRef };
}

export interface SavedMaskEdit {
  /** The layer a node should point at: base + paint, with the mask as alpha. */
  paintedMasked: ImageRef;
  maskedImage: ImageRef;
  paint: ImageRef;
  paintedImage: ImageRef;
}

/**
 * Upload the four layers of an edit.
 *
 * Order matters, and matches upstream. The mask layers go through
 * `/upload/mask`, which merges the uploaded alpha onto the file named by
 * `original_ref` server-side — so the final `paintedMasked` upload references
 * the *painted* file that was just written, not the original. Uploading it
 * against the original would drop the paint strokes from the executed image.
 *
 * `timestamp` is passed in rather than read from the clock here so the caller
 * controls it (and tests can pin it).
 */
export async function saveMaskEdit(
  layers: ComposedLayers,
  sourceRef: ImageRef,
  timestamp: number,
): Promise<SavedMaskEdit> {
  const names = layerFilenames(timestamp);

  const [maskedBlob, paintBlob, paintedBlob, paintedMaskedBlob] = await Promise.all([
    canvasToPngBlob(layers.maskedImage),
    canvasToPngBlob(layers.paint),
    canvasToPngBlob(layers.paintedImage),
    canvasToPngBlob(layers.paintedMaskedImage),
  ]);

  const toRef = (result: { name: string; subfolder: string; type: string }): ImageRef => ({
    filename: result.name,
    subfolder: result.subfolder,
    type: result.type,
  });

  const maskedImage = toRef(await uploadMaskFile(maskedBlob, names.maskedImage, sourceRef));
  const paint = toRef(await uploadClipspaceImage(paintBlob, names.paint, sourceRef));
  const paintedImage = toRef(await uploadClipspaceImage(paintedBlob, names.paintedImage, sourceRef));

  // The server renames on collision, so the merge target has to be the ref the
  // painted upload actually landed at.
  const paintedMasked = toRef(
    await uploadMaskFile(paintedMaskedBlob, names.paintedMaskedImage, paintedImage),
  );

  return { paintedMasked, maskedImage, paint, paintedImage };
}

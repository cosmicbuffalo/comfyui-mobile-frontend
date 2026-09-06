/**
 * ComfyUI's "annotated filepath" convention.
 *
 * An image-style input value can name its own base directory with a trailing
 * annotation: `sub/folder/pic.png [input]`. `folder_paths.annotated_filepath`
 * strips that suffix to choose between the input, output and temp directories,
 * so the bracketed part is NOT part of the filename on disk.
 *
 * Two things in this app have to understand it:
 *
 *  - The input-alias layer, which would otherwise ask the server for a file
 *    whose name literally ends in " [input]".
 *  - The combo control, which flags a value that is not one of the node's
 *    declared options. An annotated path is resolved by PATH rather than by
 *    list membership -- LoadImage's own `VALIDATE_INPUTS` bypasses the combo
 *    check for exactly this reason -- and `object_info` only ever enumerates
 *    top-level input files anyway (`os.listdir(input_dir)`), so anything in a
 *    subfolder could never appear in the list.
 *
 * The mask editor produces exactly this shape:
 * `clipspace/clipspace-painted-masked-<ts>.png [input]`.
 */

const PATH_ANNOTATION = /\s\[(input|output|temp)\]$/;

export type AnnotatedPathType = 'input' | 'output' | 'temp';

export interface AnnotatedPath {
  /** The path as it exists on disk, annotation removed. */
  path: string;
  /** The trailing annotation including its leading space, or "" when absent. */
  suffix: string;
  /** Which directory the annotation names, or null when unannotated. */
  type: AnnotatedPathType | null;
}

export function splitPathAnnotation(value: string): AnnotatedPath {
  const match = value.match(PATH_ANNOTATION);
  if (!match) return { path: value, suffix: '', type: null };
  return {
    path: value.slice(0, value.length - match[0].length),
    suffix: match[0],
    type: match[1] as AnnotatedPathType,
  };
}

/**
 * True when a value carries an explicit directory annotation, and is therefore
 * resolved by path on the server rather than by combo membership.
 */
export function isAnnotatedPath(value: string): boolean {
  return PATH_ANNOTATION.test(value);
}

/**
 * Name the input directory explicitly on a path that `object_info` could never
 * offer as a combo choice.
 *
 * `LoadImage.INPUT_TYPES` builds its option list with `os.listdir(input_dir)`
 * filtered by `os.path.isfile` — top level only, no recursion. So a file the
 * user picked out of an input SUBFOLDER ("fixture-subfolder/photo.jpeg")
 * is never in the list, and writing it bare left the widget holding a value the
 * option list cannot account for: the card read it as "Missing on ComfyUI
 * server" and the picker had nothing to show, even though the file was sitting
 * right there and the run worked. `addInputComboOption` papered over it by
 * splicing the path into the in-memory option lists, but that is not persisted
 * and not known to the server, so it survived only until the next `object_info`
 * refetch or reload — after which the image appeared to have vanished.
 *
 * Annotating states the directory outright, which is how ComfyUI itself
 * addresses such a file: `folder_paths.get_annotated_filepath` resolves it, and
 * `LoadImage.VALIDATE_INPUTS` checks `exists_annotated_filepath` rather than
 * combo membership. It is the shape the mask editor already writes.
 *
 * Top-level files are left bare — they ARE in the option list, and bare is what
 * desktop ComfyUI writes for them.
 */
export function annotateInputPath(path: string): string {
  if (!path || isAnnotatedPath(path)) return path;
  const hasSubfolder = path.replace(/\\/g, '/').includes('/');
  return hasSubfolder ? `${path} [input]` : path;
}

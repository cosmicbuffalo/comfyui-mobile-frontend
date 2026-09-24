import { create } from 'zustand';

/**
 * A counter per input file, bumped whenever this session writes that file.
 *
 * A LoadImage preview is addressed by the file's name alone, so uploading a
 * file under the name the node already holds leaves its preview URL unchanged.
 * That is the normal way to fill in a template: it names its example images,
 * and the user uploads the downloaded assets under the same names. The browser
 * then keeps whatever it last got for that URL -- usually the error from
 * before the file existed -- and the preview stays broken until a reload. The
 * revision goes into the preview URL as its cache token, so a write always
 * produces a URL the browser has not seen.
 *
 * In memory only: a reload builds fresh URLs anyway.
 */
interface InputFileRevisionsState {
  revisions: Record<string, number>;
  bumpInputFileRevision: (type: string, path: string) => void;
}

export function inputFileRevisionKey(type: string, path: string): string {
  return `${type}/${path.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

export const useInputFileRevisions = create<InputFileRevisionsState>()((set) => ({
  revisions: {},
  bumpInputFileRevision: (type, path) => set((state) => {
    const key = inputFileRevisionKey(type, path);
    return { revisions: { ...state.revisions, [key]: (state.revisions[key] ?? 0) + 1 } };
  }),
}));

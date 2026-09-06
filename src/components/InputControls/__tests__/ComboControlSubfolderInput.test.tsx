import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComboControl } from '../ComboControl';

// ComfyUI builds LoadImage's option list from os.listdir(input_dir) filtered by
// isfile — top level only. A file the user picks out of an input SUBFOLDER can
// therefore NEVER be one of these options, so this is the real shape of the
// list after any object_info refetch.
const TOP_LEVEL_ONLY = {
  options: ['leather_sofa.png', 'texture_fur.png'],
  image_upload: true,
};

const SUBFOLDER_FILE = 'fixture-subfolder/reference-image.jpeg';

describe('ComboControl with an input file from a subfolder', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(pointer: coarse)',
      addEventListener: () => {},
      removeEventListener: () => {},
    })));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = async (value: string) => {
    await act(async () => {
      root.render(
        <ComboControl
          containerClass=""
          name="image"
          value={value}
          options={TOP_LEVEL_ONLY}
          onChange={() => {}}
          hasPin={false}
        />,
      );
    });
  };

  it('does not report an annotated subfolder file as missing', async () => {
    // The annotation says "resolve me by path", which is what the server does
    // (LoadImage.VALIDATE_INPUTS checks exists_annotated_filepath, not combo
    // membership). Flagging it was reporting a file that is right there.
    await render(`${SUBFOLDER_FILE} [input]`);

    expect(container.textContent).not.toContain('Missing on ComfyUI server');
  });

  it('shows the file under its own name, without the annotation', async () => {
    await render(`${SUBFOLDER_FILE} [input]`);

    expect(container.textContent).toContain(SUBFOLDER_FILE);
    expect(container.textContent).not.toContain('[input]');
  });

  it('offers it in the picker as the current selection', async () => {
    await render(`${SUBFOLDER_FILE} [input]`);

    await act(async () => {
      container.querySelector<HTMLElement>('.combo-control-trigger')?.click();
    });

    // Before the fix the picker listed only the two top-level files, so the
    // image the user had just chosen was nowhere in it.
    expect(document.body.textContent).toContain(SUBFOLDER_FILE);
  });

  it('still reports a genuinely absent file as missing', async () => {
    await render('deleted-by-someone.png');

    expect(container.textContent).toContain('Missing on ComfyUI server');
  });

  // KNOWN LIMITATION, asserted so it is a decision rather than a surprise.
  //
  // "Missing" here means "not one of the node's options", which is the only
  // thing this control can know without asking the server. An annotated value
  // is deliberately exempt, because the option list can never contain it — so
  // once a value names its own directory, a file that later disappears stops
  // being reported and the card stays confident until ComfyUI rejects the run.
  //
  // The exemption predates this (the mask editor's clipspace values have always
  // taken it); annotating subfolder picks widens it from clipspace to every
  // subfolder pick. It is still the better trade: leaving the path bare made
  // the app cry missing over a file that was sitting right there, which is what
  // sent a user hunting for lost images. Closing it properly needs an existence
  // check against the server, not a change to this predicate.
  it('cannot tell that an annotated file has since been deleted', async () => {
    await render('deleted/gone-forever.png [input]');

    expect(container.textContent).not.toContain('Missing on ComfyUI server');
  });
});

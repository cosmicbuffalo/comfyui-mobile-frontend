import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComboControl } from '../ComboControl';

describe('ComboControl video upload detection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      media: '(pointer: coarse)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = (name: string, choices: string[], value: string) => {
    act(() => root.render(
      <ComboControl
        containerClass=""
        name={name}
        value={value}
        options={{ options: choices }}
        onChange={() => {}}
        hasPin={false}
      />
    ));
  };

  const uploadButton = () => Array.from(container.querySelectorAll('button'))
    .find((button) => button.textContent?.includes('Upload video from device'));

  it('does not treat a bare container-format choice as a video file picker', () => {
    // SaveVideo's format combo offers ["auto", "mp4"]; "mp4" is a container
    // name, not a filename, and must not sprout upload/browse controls.
    render('format', ['auto', 'mp4'], 'auto');
    expect(uploadButton()).toBeUndefined();
    expect(container.textContent).not.toContain('Browse files');
  });

  it('still offers uploads for combos listing real video filenames', () => {
    render('file', ['clip.mp4', 'other.webm'], 'clip.mp4');
    expect(uploadButton()).toBeDefined();
  });

  it('still offers uploads for VHS-convention widgets named video', () => {
    render('video', ['none'], 'none');
    expect(uploadButton()).toBeDefined();
  });
});

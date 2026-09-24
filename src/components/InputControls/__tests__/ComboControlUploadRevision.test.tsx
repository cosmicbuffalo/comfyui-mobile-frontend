import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    uploadImageFile: vi.fn(async (file: File) => ({ name: file.name, subfolder: '', type: 'input' })),
  };
});

import { ComboControl } from '../ComboControl';
import { inputFileRevisionKey, useInputFileRevisions } from '@/hooks/useInputFileRevisions';

/**
 * A template names its example images, and filling it in means uploading the
 * downloaded assets under those same names -- so the node's value, and with it
 * the preview URL, does not change. The upload has to record that the file
 * changed, or the preview keeps the error it got before the file existed.
 */
describe('uploading over the value an image combo already holds', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      media: '(pointer: coarse)',
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    useInputFileRevisions.setState({ revisions: {} });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('bumps the file\'s revision even though the value stays the same', async () => {
    const onChange = vi.fn();
    act(() => root.render(
      <ComboControl
        containerClass=""
        name="image"
        value="example.png"
        options={{ options: ['other.png'], image_upload: true }}
        onChange={onChange}
        hasPin={false}
      />
    ));
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept="image/*"]')!;
    const file = new File(['png'], 'example.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith('example.png');
    expect(useInputFileRevisions.getState().revisions[inputFileRevisionKey('input', 'example.png')]).toBe(1);
  });
});

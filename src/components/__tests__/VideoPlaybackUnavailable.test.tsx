import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VideoPlaybackUnavailable } from '../VideoPlaybackUnavailable';

const FORMAT_HINT =
  "Your browser can't play this video format. Save videos as H.264 MP4 to play them here.";
const MISSING_HINT = 'It may have been moved, renamed, or deleted.';

describe('VideoPlaybackUnavailable', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  const render = async (errorCode: number | null, missing?: boolean) => {
    await act(async () => {
      root.render(<VideoPlaybackUnavailable errorCode={errorCode} missing={missing} />);
    });
    return container.textContent ?? '';
  };

  it('gives format advice for decode and unsupported-source errors', async () => {
    expect(await render(3)).toContain(FORMAT_HINT);
    expect(await render(4)).toContain(FORMAT_HINT);
  });

  it('stays generic when the error says nothing about the format', async () => {
    for (const code of [1, 2, null]) {
      const text = await render(code);
      expect(text).toContain('Unable to play this video.');
      expect(text).not.toContain(FORMAT_HINT);
    }
  });

  it('says the file is gone instead of blaming its format', async () => {
    const text = await render(4, true);
    expect(text).toContain(MISSING_HINT);
    expect(text).not.toContain(FORMAT_HINT);
  });
});

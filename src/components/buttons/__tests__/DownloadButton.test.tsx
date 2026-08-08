import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadButton } from '../DownloadButton';

describe('DownloadButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const clickTwiceInOneTick = async () => {
    const button = container.querySelector('button');
    await act(async () => {
      button!.click();
      button!.click();
    });
  };

  it('saves once when two clicks land before a re-render', async () => {
    // A state flag can't guard this: `loading` is still false for the second
    // click, so the file would be saved twice from one double-tap.
    const onClick = vi.fn();
    await act(async () => {
      root.render(<DownloadButton onClick={onClick} />);
    });

    await clickTwiceInOneTick();

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('accepts a new download once the previous one settles', async () => {
    let resolve: () => void = () => {};
    const onClick = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    await act(async () => {
      root.render(<DownloadButton onClick={onClick} />);
    });

    const button = container.querySelector('button');
    await act(async () => { button!.click(); });
    await act(async () => { resolve(); await Promise.resolve(); });
    await act(async () => { button!.click(); });

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('recovers when the click handler throws', async () => {
    const onClick = vi.fn(() => { throw new Error('save failed'); });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      root.render(<DownloadButton onClick={onClick} />);
    });

    const button = container.querySelector('button');
    await act(async () => { button!.click(); });
    await act(async () => { button!.click(); });

    expect(onClick).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isMediaMissing,
  probeMissingMedia,
  resetMissingMediaProbes,
  useMissingMediaStore,
} from '@/hooks/useMissingMedia';

const image = { filename: 'a.png', subfolder: '', type: 'output' };
const FILE_ID = 'output/a.png';

beforeEach(() => {
  useMissingMediaStore.setState({ missingKeys: [] });
  resetMissingMediaProbes();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('marks are scoped to the run that wrote the file', () => {
  it('hides the file for its own run only', () => {
    useMissingMediaStore.getState().markMediaMissing([{ promptId: 'p1', fileId: FILE_ID }]);
    expect(isMediaMissing('p1', FILE_ID)).toBe(true);
    // A later run reusing the filename is a different file.
    expect(isMediaMissing('p2', FILE_ID)).toBe(false);
  });

  it('ignores refs with no run or no file', () => {
    useMissingMediaStore.getState().markMediaMissing([
      { promptId: '', fileId: FILE_ID },
      { promptId: 'p1', fileId: '' },
    ]);
    expect(useMissingMediaStore.getState().missingKeys).toEqual([]);
  });
});

describe('probing a failed thumbnail', () => {
  it.each([404, 410])('marks the run\'s file missing on %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status })));
    probeMissingMedia(image, 'p1');
    await settle();
    expect(isMediaMissing('p1', FILE_ID)).toBe(true);
    expect(isMediaMissing('p2', FILE_ID)).toBe(false);
  });

  it.each([200, 500, 503])('leaves the output alone on %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status })));
    probeMissingMedia(image, 'p1');
    await settle();
    expect(isMediaMissing('p1', FILE_ID)).toBe(false);
  });

  it('leaves the output alone when the request fails outright', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    probeMissingMedia(image, 'p1');
    await settle();
    expect(isMediaMissing('p1', FILE_ID)).toBe(false);
  });

  it('asks the canonical /view URL with HEAD', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    probeMissingMedia(image, 'p1');
    await settle();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/view?filename=a.png'),
      expect.objectContaining({ method: 'HEAD' }),
    );
  });
});

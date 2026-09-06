import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getVideoDurations = vi.fn();
vi.mock('@/api/client', () => ({
  getVideoDurations: (...args: unknown[]) => getVideoDurations(...args),
}));

import { useVideoDurations, type VideoDurationRequest } from '@/hooks/useVideoDurations';

describe('useVideoDurations', () => {
  let container: HTMLDivElement;
  let root: Root;
  // Rendered rather than captured in a variable: the hook's output has to
  // survive a render pass to be worth anything.
  function Probe({ requests }: { requests: VideoDurationRequest[] }) {
    const durations = useVideoDurations(requests);
    return <span data-durations={JSON.stringify(durations)} />;
  }

  const rendered = (): Record<string, number> =>
    JSON.parse(container.querySelector('span')?.getAttribute('data-durations') ?? '{}');

  const render = async (requests: VideoDurationRequest[]) => {
    await act(async () => {
      root.render(<Probe requests={requests} />);
    });
  };

  beforeEach(() => {
    getVideoDurations.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('batches one request per source and keys results by request key', async () => {
    getVideoDurations.mockImplementation(async (source: string) => (
      source === 'output' ? { 'clips/a.mp4': 3.25 } : { 'b.webm': 1 }
    ));

    await render([
      { source: 'output', path: 'clips/a.mp4', key: 'key-a' },
      { source: 'temp', path: 'b.webm', key: 'key-b' },
    ]);

    expect(getVideoDurations).toHaveBeenCalledTimes(2);
    expect(getVideoDurations).toHaveBeenCalledWith('output', ['clips/a.mp4']);
    expect(getVideoDurations).toHaveBeenCalledWith('temp', ['b.webm']);
    expect(rendered()).toEqual({ 'key-a': 3.25, 'key-b': 1 });
  });

  it('leaves a key absent when the probe returns nothing for it', async () => {
    getVideoDurations.mockResolvedValue({});
    await render([{ source: 'output', path: 'a.mp4', key: 'key-a' }]);
    expect(rendered()).toEqual({});
  });

  it('does not call the endpoint with an empty request list', async () => {
    await render([]);
    expect(getVideoDurations).not.toHaveBeenCalled();
  });

  it('refetches only when the requested videos change', async () => {
    getVideoDurations.mockResolvedValue({ 'a.mp4': 2 });
    const requests: VideoDurationRequest[] = [{ source: 'output', path: 'a.mp4', key: 'key-a' }];
    await render(requests);
    // Same videos, freshly built array (as a re-render produces).
    await render([{ source: 'output', path: 'a.mp4', key: 'key-a' }]);
    expect(getVideoDurations).toHaveBeenCalledTimes(1);

    // A re-rendered file under the same name carries a new key, so it probes again.
    await render([{ source: 'output', path: 'a.mp4', key: 'key-a-v2' }]);
    expect(getVideoDurations).toHaveBeenCalledTimes(2);
  });
});

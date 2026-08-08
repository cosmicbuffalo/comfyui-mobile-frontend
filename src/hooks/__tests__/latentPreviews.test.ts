import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkflowStore } from '../useWorkflow';

// Mock URL.revokeObjectURL since jsdom doesn't support blob URLs
const revokeObjectURL = vi.fn();
vi.stubGlobal('URL', { ...globalThis.URL, revokeObjectURL });

beforeEach(() => {
  revokeObjectURL.mockClear();
  useWorkflowStore.setState({ latentPreviews: {}, latentPreviewByPrompt: {} });
});

describe('setLatentPreview', () => {
  it('stores a preview under the given itemKey', () => {
    useWorkflowStore.getState().setLatentPreview('blob:url-1', 'root/node:5');
    expect(useWorkflowStore.getState().latentPreviews).toEqual({
      'root/node:5': 'blob:url-1',
    });
  });

  it('revokes the previous URL when replacing a preview for the same key', () => {
    useWorkflowStore.getState().setLatentPreview('blob:url-1', 'root/node:5');
    useWorkflowStore.getState().setLatentPreview('blob:url-2', 'root/node:5');

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:url-1');
    expect(useWorkflowStore.getState().latentPreviews['root/node:5']).toBe('blob:url-2');
  });

  it('revokes the URL and does not store when itemKey is null', () => {
    useWorkflowStore.getState().setLatentPreview('blob:url-orphan', null);

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:url-orphan');
    expect(Object.keys(useWorkflowStore.getState().latentPreviews)).toHaveLength(0);
  });

  it('stores multiple previews for different keys', () => {
    useWorkflowStore.getState().setLatentPreview('blob:a', 'root/node:1');
    useWorkflowStore.getState().setLatentPreview('blob:b', 'root/subgraph:sg1/node:10');

    const previews = useWorkflowStore.getState().latentPreviews;
    expect(previews['root/node:1']).toBe('blob:a');
    expect(previews['root/subgraph:sg1/node:10']).toBe('blob:b');
  });
});

describe('clearAllLatentPreviews', () => {
  it('revokes all URLs and empties the map', () => {
    useWorkflowStore.setState({
      latentPreviews: {
        'root/node:1': 'blob:url-1',
        'root/node:2': 'blob:url-2',
        'root/node:3': 'blob:url-3',
      },
    });

    useWorkflowStore.getState().clearAllLatentPreviews();

    expect(revokeObjectURL).toHaveBeenCalledTimes(3);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:url-1');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:url-2');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:url-3');
    expect(useWorkflowStore.getState().latentPreviews).toEqual({});
  });

  it('does nothing when there are no previews', () => {
    useWorkflowStore.getState().clearAllLatentPreviews();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().latentPreviews).toEqual({});
  });
});

describe('setQueueLatentPreview', () => {
  it('stores a preview under the prompt id with a monotonic seq', () => {
    useWorkflowStore.getState().setQueueLatentPreview('prompt-a', 'blob:a1');
    useWorkflowStore.getState().setQueueLatentPreview('prompt-b', 'blob:b1');
    const map = useWorkflowStore.getState().latentPreviewByPrompt;
    expect(map['prompt-a'].url).toBe('blob:a1');
    expect(map['prompt-b'].url).toBe('blob:b1');
    // Later writes get a strictly higher recency stamp.
    expect(map['prompt-b'].seq).toBeGreaterThan(map['prompt-a'].seq);
  });

  it('buffers one frame: revokes two generations back, keeps the displayed frame alive', () => {
    useWorkflowStore.getState().setQueueLatentPreview('prompt-a', 'blob:frame-1');
    useWorkflowStore.getState().setQueueLatentPreview('prompt-a', 'blob:frame-2');
    // frame-1 is still the immediately-previous frame, so it must NOT be revoked
    // yet (the card may still be painting it).
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:frame-1');
    expect(useWorkflowStore.getState().latentPreviewByPrompt['prompt-a'].url).toBe('blob:frame-2');

    // A third frame frees frame-1 (now two generations back) but keeps frame-2.
    useWorkflowStore.getState().setQueueLatentPreview('prompt-a', 'blob:frame-3');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:frame-1');
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:frame-2');
    expect(useWorkflowStore.getState().latentPreviewByPrompt['prompt-a'].url).toBe('blob:frame-3');
  });

  it('revokes and does not store when prompt id is null', () => {
    useWorkflowStore.getState().setQueueLatentPreview(null, 'blob:orphan');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:orphan');
    expect(useWorkflowStore.getState().latentPreviewByPrompt).toEqual({});
  });
});

describe('clearQueueLatentPreviews', () => {
  it('revokes every prompt URL and empties the map', () => {
    useWorkflowStore.getState().setQueueLatentPreview('prompt-a', 'blob:a');
    useWorkflowStore.getState().setQueueLatentPreview('prompt-b', 'blob:b');
    revokeObjectURL.mockClear();

    useWorkflowStore.getState().clearQueueLatentPreviews();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:a');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:b');
    expect(useWorkflowStore.getState().latentPreviewByPrompt).toEqual({});
  });

  it('does nothing when there are no queue previews', () => {
    useWorkflowStore.getState().clearQueueLatentPreviews();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkflowStore } from '../useWorkflow';

// Mock URL.revokeObjectURL since jsdom doesn't support blob URLs
const revokeObjectURL = vi.fn();
vi.stubGlobal('URL', { ...globalThis.URL, revokeObjectURL });

beforeEach(() => {
  revokeObjectURL.mockClear();
  useWorkflowStore.setState({ latentPreviews: {} });
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

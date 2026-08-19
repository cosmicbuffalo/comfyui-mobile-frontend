import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { ShareHandoffController } from '@/components/ShareHandoffController';
import { NATIVE_APP_UA_MARKER } from '@/utils/nativeApp';

const WEB_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1.15';
const APP_UA = `${WEB_UA} ${NATIVE_APP_UA_MARKER}/1.0`;

function setUserAgent(value: string) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value });
}

function installQueueBridge() {
  const postMessage = vi.fn();
  Object.defineProperty(window, 'webkit', {
    configurable: true,
    value: { messageHandlers: { cueForgeShareQueue: { postMessage } } },
  });
  return postMessage;
}

function removeQueueBridge() {
  Object.defineProperty(window, 'webkit', { configurable: true, value: undefined });
}

// The share-to-app hand-off: CueForge uploads a shared image into ComfyUI's
// input dir, then navigates the WebView to
//   /mobile/?loadWorkflow=<path>&useImage=<filename>
// The controller has to load that workflow, stage the image into a LoadImage
// node, and queue exactly once only when the native app explicitly requests it.
// The hidden enqueue-only route proves it is native through a WK message bridge;
// URL parameters alone never authorize a render.

const loadUserWorkflow = vi.fn();
vi.mock('@/api/client', () => ({
  loadUserWorkflow: (path: string) => loadUserWorkflow(path),
}));

const nodeTypes: NodeTypes = {
  LoadImage: {
    input: { required: { image: [['a.png', 'b.png'], {}] } },
    output: ['IMAGE', 'MASK'],
    output_name: ['IMAGE', 'MASK'],
    name: 'LoadImage',
    display_name: 'Load Image',
    description: '',
    python_module: 'nodes',
    category: 'image',
  },
  CLIPTextEncode: {
    input: { required: { text: ['STRING', { multiline: true }] } },
    output: ['CONDITIONING'],
    output_name: ['CONDITIONING'],
    name: 'CLIPTextEncode',
    display_name: 'CLIP Text Encode',
    description: '',
    python_module: 'nodes',
    category: 'conditioning',
  },
};

function makeNode(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: makeLocationPointer({ type: 'node', nodeId: id, subgraphId: null }),
    type,
    pos: [0, id * 100],
    size: [200, 100],
    flags: {},
    order: id,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: type === 'LoadImage' ? ['old.png'] : [''],
    ...overrides,
  };
}

function makeWorkflow(nodes: WorkflowNode[]): Workflow {
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: 0,
    nodes,
    links: [],
    groups: [],
    config: {},
    extra: {},
    version: 0.4,
  } as Workflow;
}

/** Put the hand-off params on the URL the way the native app navigates. */
function setHandoffParams(params: string) {
  window.history.replaceState({}, '', `/mobile/${params}`);
}

function loadImageValue(nodeId: number): unknown {
  const node = useWorkflowStore.getState().workflow?.nodes.find((n) => n.id === nodeId);
  const values = node?.widgets_values;
  return Array.isArray(values) ? values[0] : undefined;
}

describe('ShareHandoffController', () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalQueueWorkflow = useWorkflowStore.getState().queueWorkflow;

  beforeEach(() => {
    loadUserWorkflow.mockReset();
    removeQueueBridge();
    // The controller only reads the hand-off params inside the native app —
    // see the note above `readOnce` in ShareHandoffController.tsx.
    setUserAgent(APP_UA);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useWorkflowStore.getState().unloadWorkflow();
    useWorkflowErrorsStore.getState().setError(null);
    act(() => {
      useWorkflowStore.setState({ queueWorkflow: originalQueueWorkflow });
      useWorkflowStore.getState().setNodeTypes(nodeTypes);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setHandoffParams('');
    setUserAgent(WEB_UA);
    removeQueueBridge();
    useWorkflowStore.setState({ queueWorkflow: originalQueueWorkflow });
  });

  async function mountAndSettle() {
    await act(async () => {
      root.render(<ShareHandoffController />);
    });
    // One more turn for the load promise and the staging effect it triggers.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('renders nothing and loads nothing without hand-off params', async () => {
    setHandoffParams('');
    await mountAndSettle();
    expect(loadUserWorkflow).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });

  it('loadWorkflow alone is a plain open — load, strip, no chrome', async () => {
    // A bare link to a saved workflow: no staged image means no share-handoff
    // banner, just the workflow loaded into the panel.
    loadUserWorkflow.mockResolvedValue(makeWorkflow([makeNode(1, 'LoadImage')]));
    setHandoffParams('?loadWorkflow=shared.json');
    await mountAndSettle();
    expect(loadUserWorkflow).toHaveBeenCalledWith('shared.json');
    expect(useWorkflowStore.getState().workflow).not.toBeNull();
    expect(container.textContent).toBe('');
    expect(window.location.search).toBe('');
  });

  it('surfaces a failed plain open instead of doing nothing', async () => {
    // There is no hand-off banner on this path, so a stale link would otherwise
    // be indistinguishable from a link that did nothing.
    loadUserWorkflow.mockRejectedValue(new Error('Failed to load workflow'));
    setHandoffParams('?loadWorkflow=deleted.json');
    await mountAndSettle();
    expect(useWorkflowErrorsStore.getState().error).toBeTruthy();
    expect(window.location.search).toBe('');
  });

  it('useImage alone is still ignored', async () => {
    setHandoffParams('?useImage=orphan.png');
    await mountAndSettle();
    expect(loadUserWorkflow).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
  });

  it('stages the shared image into the only LoadImage node', async () => {
    loadUserWorkflow.mockResolvedValue(
      makeWorkflow([makeNode(1, 'LoadImage'), makeNode(2, 'CLIPTextEncode')]),
    );
    setHandoffParams('?loadWorkflow=shared.json&useImage=shared-123.png');
    await mountAndSettle();

    expect(loadUserWorkflow).toHaveBeenCalledWith('shared.json');
    expect(loadImageValue(1)).toBe('shared-123.png');
    expect(container.textContent).toContain('Image staged from share');
  });

  it('does not queue a visible stage-only hand-off on its own', async () => {
    const queueWorkflow = vi.fn(async () => true);
    useWorkflowStore.setState({ queueWorkflow });
    loadUserWorkflow.mockResolvedValue(makeWorkflow([makeNode(1, 'LoadImage')]));
    setHandoffParams('?loadWorkflow=shared.json&useImage=shared-123.png');
    await mountAndSettle();
    expect(queueWorkflow).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Queue');
  });

  it('queues exactly once and reports success for a trusted enqueue-only hand-off', async () => {
    const postMessage = installQueueBridge();
    const queueWorkflow = vi.fn(async () => true);
    useWorkflowStore.setState({ queueWorkflow });
    // The Share Extension's isolated WebView does not need to rely on a UA
    // marker: the installed native message handler is the stronger capability.
    setUserAgent(WEB_UA);
    loadUserWorkflow.mockResolvedValue(makeWorkflow([makeNode(1, 'LoadImage')]));
    setHandoffParams(
      '?loadWorkflow=shared.json&useImage=shared-123.png&autoQueue=1&enqueueOnly=1',
    );

    await mountAndSettle();

    expect(loadImageValue(1)).toBe('shared-123.png');
    expect(queueWorkflow).toHaveBeenCalledTimes(1);
    expect(queueWorkflow).toHaveBeenCalledWith(1);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ status: 'success' });
    expect(window.location.search).toBe('');
    expect(container.textContent).toBe('');
  });

  it('uses the first compatible LoadImage node for a headless bulk enqueue', async () => {
    const postMessage = installQueueBridge();
    const queueWorkflow = vi.fn(async () => true);
    useWorkflowStore.setState({ queueWorkflow });
    setUserAgent(WEB_UA);
    loadUserWorkflow.mockResolvedValue(
      makeWorkflow([
        makeNode(1, 'LoadImage', { title: 'Primary image' }),
        makeNode(2, 'LoadImage', { title: 'Style reference' }),
      ]),
    );
    setHandoffParams(
      '?loadWorkflow=shared.json&useImage=bulk-1.png&autoQueue=1&enqueueOnly=1',
    );

    await mountAndSettle();

    expect(loadImageValue(1)).toBe('bulk-1.png');
    expect(loadImageValue(2)).toBe('old.png');
    expect(queueWorkflow).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ status: 'success' });
  });

  it('skips disabled LoadImage nodes when picking the headless bulk target', async () => {
    const postMessage = installQueueBridge();
    const queueWorkflow = vi.fn(async () => true);
    useWorkflowStore.setState({ queueWorkflow });
    setUserAgent(WEB_UA);
    loadUserWorkflow.mockResolvedValue(
      makeWorkflow([
        makeNode(1, 'LoadImage', { title: 'Bypassed leftover', mode: 4 }),
        makeNode(2, 'LoadImage', { title: 'Active image' }),
      ]),
    );
    setHandoffParams(
      '?loadWorkflow=shared.json&useImage=bulk-2.png&autoQueue=1&enqueueOnly=1',
    );

    await mountAndSettle();

    expect(loadImageValue(1)).toBe('old.png');
    expect(loadImageValue(2)).toBe('bulk-2.png');
    expect(queueWorkflow).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ status: 'success' });
  });

  it('stages into a LoadImage node that lives inside a subgraph', async () => {
    const postMessage = installQueueBridge();
    const queueWorkflow = vi.fn(async () => true);
    useWorkflowStore.setState({ queueWorkflow });
    setUserAgent(WEB_UA);
    const inner = makeNode(7, 'LoadImage', { title: 'Inner image', itemKey: undefined });
    const workflow = makeWorkflow([makeNode(1, 'CLIPTextEncode')]);
    workflow.definitions = {
      subgraphs: [
        {
          id: 'sg-1',
          name: 'Loader',
          nodes: [inner],
          links: [],
          groups: [],
          inputs: [],
          outputs: [],
        },
      ],
    } as unknown as Workflow['definitions'];
    loadUserWorkflow.mockResolvedValue(workflow);
    setHandoffParams(
      '?loadWorkflow=shared.json&useImage=bulk-3.png&autoQueue=1&enqueueOnly=1',
    );

    await mountAndSettle();

    const staged = useWorkflowStore
      .getState()
      .workflow?.definitions?.subgraphs?.[0]?.nodes.find((n) => n.id === 7);
    expect(Array.isArray(staged?.widgets_values) ? staged?.widgets_values[0] : undefined).toBe(
      'bulk-3.png',
    );
    expect(queueWorkflow).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ status: 'success' });
  });

  it('reports a structured error when the native queue submission fails', async () => {
    const postMessage = installQueueBridge();
    const queueWorkflow = vi.fn(async () => false);
    useWorkflowStore.setState({ queueWorkflow });
    setUserAgent(WEB_UA);
    loadUserWorkflow.mockResolvedValue(makeWorkflow([makeNode(1, 'LoadImage')]));
    setHandoffParams(
      '?loadWorkflow=shared.json&useImage=shared-123.png&autoQueue=1&enqueueOnly=1',
    );

    await mountAndSettle();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      status: 'error',
      code: 'queue_failed',
      message: 'Failed to queue workflow',
    });
  });

  it('does not duplicate a generation the Share Extension already queued', async () => {
    const queueWorkflow = vi.fn(async () => true);
    useWorkflowStore.setState({ queueWorkflow });
    loadUserWorkflow.mockResolvedValue(makeWorkflow([makeNode(1, 'LoadImage')]));
    setHandoffParams(
      '?loadWorkflow=shared.json&useImage=shared-123.png&shareAlreadyQueued=1&autoQueue=1',
    );

    await mountAndSettle();

    expect(loadImageValue(1)).toBe('shared-123.png');
    expect(queueWorkflow).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Generation queued from share');
  });

  it('does not let URL parameters alone authorize auto-queueing on the web', async () => {
    const queueWorkflow = vi.fn(async () => true);
    useWorkflowStore.setState({ queueWorkflow });
    setUserAgent(WEB_UA);
    loadUserWorkflow.mockResolvedValue(makeWorkflow([makeNode(1, 'LoadImage')]));
    setHandoffParams(
      '?loadWorkflow=shared.json&useImage=shared-123.png&autoQueue=1&enqueueOnly=1',
    );

    await mountAndSettle();

    expect(loadUserWorkflow).not.toHaveBeenCalled();
    expect(queueWorkflow).not.toHaveBeenCalled();
  });

  it('offers a picker when the workflow has several LoadImage nodes', async () => {
    loadUserWorkflow.mockResolvedValue(
      makeWorkflow([
        makeNode(1, 'LoadImage', { title: 'Subject' }),
        makeNode(2, 'LoadImage', { title: 'Style reference' }),
      ]),
    );
    setHandoffParams('?loadWorkflow=shared.json&useImage=shared-123.png');
    await mountAndSettle();

    expect(container.textContent).toContain('Stage shared image into…');
    expect(container.textContent).toContain('Style reference');
    // Nothing staged until the user picks.
    expect(loadImageValue(1)).toBe('old.png');
    expect(loadImageValue(2)).toBe('old.png');

    const rows = [...container.querySelectorAll('button')].filter((b) =>
      b.textContent?.includes('Style reference'),
    );
    expect(rows).toHaveLength(1);
    await act(async () => {
      rows[0].click();
    });

    expect(loadImageValue(2)).toBe('shared-123.png');
    expect(loadImageValue(1)).toBe('old.png');
    expect(container.textContent).toContain('Image staged from share');
  });

  it('explains itself instead of staging when there is no LoadImage node', async () => {
    loadUserWorkflow.mockResolvedValue(makeWorkflow([makeNode(1, 'CLIPTextEncode')]));
    setHandoffParams('?loadWorkflow=shared.json&useImage=shared-123.png');
    await mountAndSettle();
    expect(container.textContent).toContain("doesn't have a Load Image node");
  });

  it('surfaces a failed workflow load rather than silently doing nothing', async () => {
    loadUserWorkflow.mockRejectedValue(new Error('workflow not found'));
    setHandoffParams('?loadWorkflow=missing.json&useImage=shared-123.png');
    await mountAndSettle();
    expect(container.textContent).toContain('Failed to load workflow');
  });

  it('strips the hand-off params once the banner is dismissed', async () => {
    loadUserWorkflow.mockResolvedValue(makeWorkflow([makeNode(1, 'LoadImage')]));
    setHandoffParams('?loadWorkflow=shared.json&useImage=shared-123.png');
    await mountAndSettle();

    const dismiss = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Dismiss',
    );
    expect(dismiss).toBeDefined();
    await act(async () => {
      dismiss!.click();
    });

    // A later manual reload must not re-run the hand-off against a workflow the
    // user has since edited.
    expect(window.location.search).toBe('');
    expect(container.textContent).toBe('');
  });

  it('ignores hand-off params on the open web', async () => {
    // This component was designed as the native app's share hand-off — a
    // link with these params reaching a plain web visitor must not silently
    // replace their open workflow. See the note above `readOnce`.
    setUserAgent(WEB_UA);
    loadUserWorkflow.mockResolvedValue(makeWorkflow([makeNode(1, 'LoadImage')]));
    setHandoffParams('?loadWorkflow=shared.json&useImage=shared-123.png');
    await mountAndSettle();
    expect(loadUserWorkflow).not.toHaveBeenCalled();
    expect(container.textContent).toBe('');
    // The params are left in place (nothing to clear — the hand-off never armed).
    expect(window.location.search).toBe('?loadWorkflow=shared.json&useImage=shared-123.png');
  });
});

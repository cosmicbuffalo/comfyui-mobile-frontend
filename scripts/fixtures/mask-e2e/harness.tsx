/**
 * Mounts the real MaskEditorModal against the fake ComfyUI in `fakeComfy.ts`,
 * over a real workflow store holding one LoadImage node.
 *
 * Using the genuine store matters: saving from a node target writes back
 * through `updateNodeWidget`, and the value it writes is what the next opening
 * parses. That loop is where cross-session undo broke, so the test drives it
 * rather than simulating it.
 */
import { createRoot } from 'react-dom/client';
import { MaskEditorModal } from '@/components/MaskEditor/MaskEditorModal';
import { useMaskEditorStore } from '@/hooks/useMaskEditor';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { resolveLoadImagePreview } from '@/utils/loadImagePreview';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { installFakeComfy, restoreFiles, seedFile, storedFilenames } from './fakeComfy';
import '@/index.css';

const WIDTH = 200;
const HEIGHT = 150;
const ORIGINAL = 'photo.png';
const POINTER = makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null });

function makeOriginal(): ImageData {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    // A flat, unambiguous colour so any edit is obvious in a pixel read.
    data[i * 4] = 220; data[i * 4 + 1] = 80; data[i * 4 + 2] = 60; data[i * 4 + 3] = 255;
  }
  return new ImageData(data, WIDTH, HEIGHT);
}

installFakeComfy();

const nodeTypes = {
  LoadImage: {
    input: { required: { image: [[ORIGINAL]] } },
    input_order: { required: ['image'] },
    output: ['IMAGE', 'MASK'],
    output_name: ['IMAGE', 'MASK'],
    name: 'LoadImage', display_name: 'Load Image',
    description: '', python_module: 'nodes', category: 'image',
  },
} as unknown as NodeTypes;

const loadImageNode = {
  id: 1, itemKey: POINTER, type: 'LoadImage',
  pos: [0, 0], size: [200, 200], flags: {}, order: 0, mode: 0,
  inputs: [], outputs: [], properties: {},
  widgets_values: [ORIGINAL, 'image'],
} as unknown as WorkflowNode;

useWorkflowStore.setState({
  workflow: {
    last_node_id: 1, last_link_id: 0, nodes: [loadImageNode],
    links: [], groups: [], config: {}, version: 1,
  } as unknown as Workflow,
  nodeTypes,
  mobileLayout: createEmptyMobileLayout(),
  itemKeyByPointer: { [POINTER]: POINTER },
  pointerByHierarchicalKey: { [POINTER]: POINTER },
  scopeStack: [{ type: 'root' }],
});

function currentNode(): WorkflowNode {
  return useWorkflowStore.getState().workflow!.nodes.find((n) => n.id === 1)!;
}

declare global {
  interface Window {
    maskE2E: {
      open: () => void;
      widgetValue: () => string;
      storedFiles: () => string[];
    };
  }
}

window.maskE2E = {
  open: () => {
    const node = currentNode();
    const workflow = useWorkflowStore.getState().workflow!;
    const preview = resolveLoadImagePreview(workflow, nodeTypes, node)!;
    useMaskEditorStore.getState().open({
      kind: 'node', itemKey: POINTER, nodeId: 1, nodeTitle: 'Load Image',
      ref: { filename: preview.filename, subfolder: preview.subfolder, type: preview.type },
    });
  },
  widgetValue: () => String((currentNode().widgets_values as unknown[])[0]),
  storedFiles: () => storedFilenames(),
};

/**
 * The node's widget value has to survive a reload too, or the refresh test
 * would reopen the original image instead of the saved one.
 */
const WIDGET_KEY = 'mask-e2e-widget';
const persistedWidget = sessionStorage.getItem(WIDGET_KEY);
if (persistedWidget) {
  useWorkflowStore.getState().updateNodeWidget(POINTER, 0, persistedWidget, 'image');
}
useWorkflowStore.subscribe((state) => {
  const node = state.workflow?.nodes.find((n) => n.id === 1);
  const value = node && (node.widgets_values as unknown[])[0];
  if (typeof value === 'string') sessionStorage.setItem(WIDGET_KEY, value);
});

// Restore before mounting: the modal loads its image as soon as a target is
// opened, and a half-restored store would 404.
restoreFiles();
seedFile(ORIGINAL, '', makeOriginal());
(window as unknown as { maskE2EReady: boolean }).maskE2EReady = true;
createRoot(document.getElementById('root')!).render(<MaskEditorModal />);

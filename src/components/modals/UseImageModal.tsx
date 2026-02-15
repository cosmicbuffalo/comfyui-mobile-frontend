import { useEffect, useMemo, useState } from 'react';
import type { FileItem, AssetSource } from '@/api/client';
import { getNodeTypes } from '@/api/client';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { useNavigationStore } from '@/hooks/useNavigation';
import { getNodeLabel, resolveInputWidget } from '@/utils/workflowOperations';
import { resolveInputPathForFile } from '@/utils/filesystem';

interface UseImageModalProps {
  open: boolean;
  file: FileItem | null;
  source: AssetSource;
  onClose: () => void;
  onLoaded?: () => void;
}

export function UseImageModal({
  open,
  file,
  source,
  onClose,
  onLoaded
}: UseImageModalProps) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const setNodeTypes = useWorkflowStore((s) => s.setNodeTypes);
  const updateNodeWidget = useWorkflowStore((s) => s.updateNodeWidget);
  const clearNodeError = useWorkflowErrorsStore((s) => s.clearNodeError);
  const scrollToNode = useWorkflowStore((s) => s.scrollToNode);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const [loadNodeError, setLoadNodeError] = useState<string | null>(null);
  const [loadingNodeStableKey, setLoadingNodeStableKey] = useState<string | null>(null);

  const loadableNodes = useMemo(() => {
    if (!workflow) return [];
    return workflow.nodes
      .filter((node) => /loadimage/i.test(node.type))
      .map((node) => ({ node, stableKey: node.stableKey ?? null }))
      .filter((entry): entry is { node: typeof workflow.nodes[number]; stableKey: string } => entry.stableKey !== null);
  }, [workflow]);

  useEffect(() => {
    if (!open) {
      setLoadNodeError(null);
      setLoadingNodeStableKey(null);
    }
  }, [open]);

  const handleLoadIntoNode = async (nodeStableKey: string) => {
    if (!file || !workflow) return;
    setLoadingNodeStableKey(nodeStableKey);
    setLoadNodeError(null);
    try {
      const targetNode = workflow.nodes.find((node) => node.stableKey === nodeStableKey);
      if (!targetNode) throw new Error('Could not resolve selected node.');

      const widget = resolveInputWidget({ workflow, nodeTypes, nodeId: targetNode.id });
      if (!widget) {
        throw new Error('Selected node does not accept image inputs.');
      }
      const inputPath = await resolveInputPathForFile(file, source);
      if (source !== 'input') {
        try {
          const freshTypes = await getNodeTypes();
          setNodeTypes(freshTypes);
        } catch (refreshError) {
          console.warn('Failed to refresh node types after upload:', refreshError);
        }
      }
      updateNodeWidget(nodeStableKey, widget.index, inputPath, widget.name);
      clearNodeError(widget.node.id);
      setCurrentPanel('workflow');
      onLoaded?.();
      setTimeout(() => {
        scrollToNode(nodeStableKey, getNodeLabel(widget.node, nodeTypes));
      }, 150);
    } catch (err) {
      console.error('Failed to load image into node:', err);
      setLoadNodeError(err instanceof Error ? err.message : 'Failed to load image.');
    } finally {
      setLoadingNodeStableKey(null);
    }
  };

  if (!open || !file) return null;

  return (
    <div
      id="outputs-load-node-overlay"
      className="fixed inset-0 z-[2150] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        id="outputs-load-node-modal"
        className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-4 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">
          Load image into node
        </div>
        <div className="px-4 pt-3 text-xs text-gray-500">
          {file.name}
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {loadableNodes.length === 0 && (
            <div className="px-4 py-3 text-sm text-gray-400">
              No Load Image nodes found in the current workflow.
            </div>
          )}
          {loadableNodes.map(({ node, stableKey }) => {
            const label = getNodeLabel(node, nodeTypes);
            const isBusy = loadingNodeStableKey === stableKey;
            return (
              <button
                key={`load-node-${stableKey}`}
                className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={() => handleLoadIntoNode(stableKey)}
                disabled={loadingNodeStableKey !== null}
              >
                <span className="text-gray-500 dark:text-gray-300">#{node.id}</span>
                <span className="flex-1 text-gray-900 dark:text-gray-100 truncate">{label}</span>
                {isBusy && <span className="text-xs text-gray-400">Loading…</span>}
              </button>
            );
          })}
        </div>
        {loadNodeError && (
          <div className="px-4 py-2 text-xs text-red-600 border-t border-gray-100">
            {loadNodeError}
          </div>
        )}
        <div className="px-4 py-3 border-t border-gray-100 flex justify-end">
          <button
            className="px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-60"
            onClick={onClose}
            disabled={loadingNodeStableKey !== null}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

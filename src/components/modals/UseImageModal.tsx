import { useEffect, useMemo, useState } from 'react';
import type { FileItem, AssetSource } from '@/api/client';
import { setFileHidden } from '@/api/client';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { useNavigationStore } from '@/hooks/useNavigation';
import { getNodeLabel, resolveInputWidget } from '@/utils/workflowOperations';
import { resolveInputPathForFile } from '@/utils/filesystem';
import { getDisplayName } from '@/components/AppMenu/userWorkflowHelpers';
import { useWorkflowHiddenStore } from '@/hooks/useWorkflowHidden';
import { isWorkflowHidden } from '@/utils/workflowHidden';

interface UseImageModalProps {
  open: boolean;
  file: FileItem | null;
  source: AssetSource;
  onClose: () => void;
  onLoaded?: () => void;
  background?: 'opaque' | 'translucent';
}

export function UseImageModal({
  open,
  file,
  source,
  onClose,
  onLoaded,
  background = 'opaque'
}: UseImageModalProps) {
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const addInputComboOption = useWorkflowStore((s) => s.addInputComboOption);
  const updateNodeWidget = useWorkflowStore((s) => s.updateNodeWidget);
  const clearNodeError = useWorkflowErrorsStore((s) => s.clearNodeError);
  const scrollToNode = useWorkflowStore((s) => s.scrollToNode);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const sessions = useWorkflowStore((s) => s.sessions);
  const activeSessionId = useWorkflowStore((s) => s.activeSessionId) ?? null;
  const parkedSessions = useWorkflowStore((s) => s.parkedSessions);
  const currentFilename = useWorkflowStore((s) => s.currentFilename);
  const workflowSource = useWorkflowStore((s) => s.workflowSource);
  const hiddenWorkflowPaths = useWorkflowHiddenStore((s) => s.hidden);
  const switchToSession = useWorkflowStore((s) => s.switchToSession);
  const [loadNodeError, setLoadNodeError] = useState<string | null>(null);
  const [loadingNodeHierarchicalKey, setLoadingNodeHierarchicalKey] = useState<string | null>(null);
  // When multiple workflows are open, pick the target workflow before the node.
  const [step, setStep] = useState<'workflow' | 'node'>('node');

  const workflowOptions = useMemo(
    () =>
      sessions.map((meta) => {
        const filename =
          meta.id === activeSessionId
            ? currentFilename
            : parkedSessions[meta.id]?.currentFilename ?? null;
        return {
          id: meta.id,
          label: filename ? getDisplayName(filename) : 'Untitled',
        };
      }),
    [sessions, activeSessionId, parkedSessions, currentFilename],
  );

  const loadableNodes = useMemo(() => {
    if (!workflow) return [];
    return workflow.nodes
      .filter((node) => /loadimage/i.test(node.type))
      .map((node) => ({ node, itemKey: node.itemKey ?? null }))
      .filter((entry): entry is { node: typeof workflow.nodes[number]; itemKey: string } => entry.itemKey !== null);
  }, [workflow]);

  useEffect(() => {
    if (!open) {
      setLoadNodeError(null);
      setLoadingNodeHierarchicalKey(null);
      return;
    }
    // On open, choose the target workflow first if more than one is loaded.
    setStep(sessions.length > 1 ? 'workflow' : 'node');
  }, [open, sessions.length]);

  const handleSelectWorkflow = (sessionId: string) => {
    if (sessionId !== activeSessionId) switchToSession(sessionId);
    setStep('node');
  };

  const handleLoadIntoNode = async (nodeHierarchicalKey: string) => {
    if (!file || !workflow) return;
    setLoadingNodeHierarchicalKey(nodeHierarchicalKey);
    setLoadNodeError(null);
    try {
      const targetNode = workflow.nodes.find((node) => node.itemKey === nodeHierarchicalKey);
      if (!targetNode) throw new Error('Could not resolve selected node.');

      const widget = resolveInputWidget({ workflow, nodeTypes, nodeId: targetNode.id });
      if (!widget) {
        throw new Error('Selected node does not accept image inputs.');
      }
      const inputPath = await resolveInputPathForFile(file, source);
      // Set the widget value and surface the result immediately. The server
      // re-scans the input dir on queue, so we don't need fresh node types
      // before the value takes effect — making it a canonical combo choice is
      // an in-memory option splice (addInputComboOption below), not a fetch.
      updateNodeWidget(nodeHierarchicalKey, widget.index, inputPath, widget.name);
      clearNodeError(widget.node.id);
      // Auto-hiding the input for a hidden workflow is best-effort declutter and
      // must not abort the assignment above, so fire-and-forget after it commits.
      if (isWorkflowHidden(workflowSource, currentFilename, hiddenWorkflowPaths)) {
        void setFileHidden(inputPath, true, 'input').catch((err) => {
          console.warn('Failed to hide input from hidden workflow:', err);
        });
      }
      setCurrentPanel('workflow');
      onLoaded?.();
      setTimeout(() => {
        scrollToNode(nodeHierarchicalKey, getNodeLabel(widget.node, nodeTypes, workflow));
      }, 150);
      if (source !== 'input') {
        // The copied-in file is now a valid input choice; splice it into the
        // image-upload combos in-memory instead of refetching object_info.
        addInputComboOption(inputPath);
      }
    } catch (err) {
      console.error('Failed to load image into node:', err);
      setLoadNodeError(err instanceof Error ? err.message : 'Failed to load image.');
    } finally {
      setLoadingNodeHierarchicalKey(null);
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
        className={`w-full max-w-sm ${background === 'opaque' ? 'bg-slate-900' : 'bg-slate-900/95'} border border-white/10 text-slate-100 rounded-xl shadow-lg overflow-hidden`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-4 py-3 text-sm font-semibold text-slate-100 border-b border-white/10 flex items-center gap-2">
          {step === 'node' && sessions.length > 1 && (
            <button
              type="button"
              className="text-cyan-300 hover:text-cyan-200 text-xs"
              onClick={() => setStep('workflow')}
              disabled={loadingNodeHierarchicalKey !== null}
            >
              ‹ Back
            </button>
          )}
          <span>
            {step === 'workflow'
              ? 'Load image into which workflow?'
              : 'Load image into node'}
          </span>
        </div>
        <div className="px-4 pt-3 text-xs text-slate-400">
          {file.name}
        </div>
        {step === 'workflow' ? (
          <div className="max-h-[50vh] overflow-y-auto">
            {workflowOptions.map((option) => (
              <button
                key={`load-workflow-${option.id}`}
                className="w-full text-left px-4 py-3 text-sm hover:bg-white/10 flex items-center gap-2"
                onClick={() => handleSelectWorkflow(option.id)}
              >
                <span className="flex-1 text-slate-100 truncate">{option.label}</span>
                {option.id === activeSessionId && (
                  <span className="text-xs text-slate-500">current</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto">
            {loadableNodes.length === 0 && (
              <div className="px-4 py-3 text-sm text-slate-400">
                No Load Image nodes found in the current workflow.
              </div>
            )}
            {loadableNodes.map(({ node, itemKey }) => {
              const label = getNodeLabel(node, nodeTypes, workflow);
              const isBusy = loadingNodeHierarchicalKey === itemKey;
              return (
                <button
                  key={`load-node-${itemKey}`}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-white/10 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  onClick={() => handleLoadIntoNode(itemKey)}
                  disabled={loadingNodeHierarchicalKey !== null}
                >
                  <span className="text-slate-400">#{node.id}</span>
                  <span className="flex-1 text-slate-100 truncate">{label}</span>
                  {isBusy && <span className="text-xs text-slate-400">Loading…</span>}
                </button>
              );
            })}
          </div>
        )}
        {loadNodeError && (
          <div className="px-4 py-2 text-xs text-red-400 border-t border-white/10">
            {loadNodeError}
          </div>
        )}
        <div className="px-4 py-3 border-t border-white/10 flex justify-end">
          <button
            className="px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/10 rounded-lg disabled:opacity-60"
            onClick={onClose}
            disabled={loadingNodeHierarchicalKey !== null}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { saveUserWorkflow, loadTemplateWorkflow, loadUserWorkflow } from '@/api/client';
import { stripWorkflowClientMetadata, useWorkflowStore } from '@/hooks/useWorkflow';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { useHistoryStore } from '@/hooks/useHistory';
import { Dialog } from '@/components/modals/Dialog';
import { WorkflowTopBarMenu } from './WorkflowTopBarControls/WorkflowTopBarMenu';
import { SaveAsIcon, SaveDiskIcon, TrashIcon, LogoutIcon, ReloadIcon, XMarkIcon } from '@/components/icons';

type DirtyAction = 'unload' | 'clearWorkflowCache' | 'clearAllCache' | 'discardChanges';

interface WorkflowActionButtonProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  description?: string;
  tone?: 'default' | 'danger';
}

function WorkflowActionButton({
  icon,
  label,
  onClick,
  disabled,
  description,
  tone = 'default'
}: WorkflowActionButtonProps) {
  const isDanger = tone === 'danger';
  return (
    <button
      className={`w-full flex items-start gap-3 text-left px-4 py-3 disabled:opacity-50 ${
        isDanger ? 'text-red-600 hover:bg-red-50' : 'hover:bg-gray-50'
      }`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="shrink-0 self-start mt-[3px]">{icon}</span>
      <span className="flex flex-col min-w-0">
        <span className={`text-sm ${isDanger ? 'text-red-600' : 'text-gray-900'}`}>{label}</span>
        {description ? <span className="text-xs text-gray-500">{description}</span> : null}
      </span>
    </button>
  );
}

export function WorkflowTopBarControls() {
  const [menuOpenAt, setMenuOpenAt] = useState<number | null>(null);
  const [dirtyConfirmAction, setDirtyConfirmAction] = useState<DirtyAction | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsFilename, setSaveAsFilename] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const workflow = useWorkflowStore((s) => s.workflow);
  const originalWorkflow = useWorkflowStore((s) => s.originalWorkflow);
  const currentFilename = useWorkflowStore((s) => s.currentFilename);
  const workflowSource = useWorkflowStore((s) => s.workflowSource);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const setSavedWorkflow = useWorkflowStore((s) => s.setSavedWorkflow);
  const clearWorkflowCache = useWorkflowStore((s) => s.clearWorkflowCache);
  const unloadWorkflow = useWorkflowStore((s) => s.unloadWorkflow);
  const requestAddNodeModal = useWorkflowStore((s) => s.requestAddNodeModal);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const workflowLoadedAt = useWorkflowStore((s) => s.workflowLoadedAt);
  const history = useHistoryStore((s) => s.history);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpen = menuOpenAt !== null && menuOpenAt === workflowLoadedAt;

  const isDirty = useMemo(
    () => Boolean(workflow && originalWorkflow && JSON.stringify(workflow) !== JSON.stringify(originalWorkflow)),
    [workflow, originalWorkflow]
  );

  useDismissOnOutsideClick({
    open: menuOpen,
    onDismiss: () => setMenuOpenAt(null),
    triggerRef: buttonRef,
    contentRef: menuRef,
  });

  const clearAllCache = async () => {
    localStorage.clear();
    sessionStorage.clear();
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
    }
    document.cookie.split(';').forEach((cookie) => {
      const [name] = cookie.split('=');
      document.cookie = `${name.trim()}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    });
    window.location.reload();
  };

  const performSave = async (filename: string) => {
    if (!workflow) return;
    const finalFilename = filename.endsWith('.json') ? filename : `${filename}.json`;
    try {
      setLoading(true);
      await saveUserWorkflow(finalFilename, stripWorkflowClientMetadata(workflow));
      setSavedWorkflow(workflow, finalFilename);
      setError(null);
      setSaveAsOpen(false);
      setActionsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow');
    } finally {
      setLoading(false);
    }
  };

  const reloadFromSource = async () => {
    if (!workflowSource) {
      if (originalWorkflow) {
        loadWorkflow(originalWorkflow, currentFilename ?? undefined, {
          fresh: true,
          source: { type: 'other' }
        });
      }
      return;
    }

    if (workflowSource.type === 'user') {
      const data = await loadUserWorkflow(workflowSource.filename);
      loadWorkflow(data, workflowSource.filename, { fresh: true, source: workflowSource });
      return;
    }

    if (workflowSource.type === 'template') {
      const data = await loadTemplateWorkflow(workflowSource.moduleName, workflowSource.templateName);
      loadWorkflow(data, `${workflowSource.moduleName}/${workflowSource.templateName}`, {
        fresh: true,
        source: workflowSource
      });
      return;
    }

    if (workflowSource.type === 'history') {
      const historyItem = history.find((h) => h.prompt_id === workflowSource.promptId);
      if (historyItem?.workflow) {
        loadWorkflow(historyItem.workflow, `history-${workflowSource.promptId}.json`, {
          fresh: true,
          source: workflowSource
        });
      }
      return;
    }

    if (originalWorkflow) {
      loadWorkflow(originalWorkflow, currentFilename ?? undefined, {
        fresh: true,
        source: workflowSource
      });
    }
  };

  const handleDirtyAction = (action: DirtyAction) => {
    if (isDirty) {
      setDirtyConfirmAction(action);
      return;
    }
    if (action === 'unload') {
      unloadWorkflow();
    } else if (action === 'clearWorkflowCache') {
      clearWorkflowCache();
    } else if (action === 'clearAllCache') {
      void clearAllCache();
    } else {
      void reloadFromSource();
    }
    setActionsOpen(false);
  };

  const handleDirtyConfirmContinue = async (action: DirtyAction) => {
    setDirtyConfirmAction(null);
    try {
      setLoading(true);
      if (action === 'unload') {
        unloadWorkflow();
      } else if (action === 'clearWorkflowCache') {
        clearWorkflowCache();
      } else if (action === 'clearAllCache') {
        await clearAllCache();
      } else {
        await reloadFromSource();
      }
      setActionsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete action');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenWorkflowActions = () => {
    setMenuOpenAt(null);
    setError(null);
    setActionsOpen(true);
  };

  const handleAddNode = () => {
    requestAddNodeModal({ groupId: null, subgraphId: null });
  };

  return (
    <>
      <WorkflowTopBarMenu
        open={menuOpen}
        buttonRef={buttonRef}
        menuRef={menuRef}
        onToggle={() => setMenuOpenAt(menuOpen ? null : workflowLoadedAt)}
        onClose={() => setMenuOpenAt(null)}
        onGoToQueue={() => setCurrentPanel('queue')}
        onGoToOutputs={() => setCurrentPanel('outputs')}
        onAddNode={handleAddNode}
        onOpenWorkflowActions={handleOpenWorkflowActions}
      />

      {actionsOpen && (
        <div
          className="fixed inset-0 z-[1450] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setActionsOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-4 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">
              Workflow actions
            </div>
            {error && (
              <div className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100">
                {error}
              </div>
            )}
            <div className="max-h-[60vh] overflow-y-auto">
              <WorkflowActionButton
                icon={<SaveDiskIcon className="w-4 h-4 text-gray-500" />}
                label="Save"
                onClick={() => {
                  if (!workflow) return;
                  if (!currentFilename) {
                    setSaveAsFilename(currentFilename ?? '');
                    setSaveAsOpen(true);
                    return;
                  }
                  void performSave(currentFilename);
                }}
                disabled={!workflow || !isDirty || loading}
              />
              <WorkflowActionButton
                icon={<SaveAsIcon className="w-4 h-4 text-gray-500" />}
                label="Save as"
                onClick={() => {
                  setSaveAsFilename(currentFilename ?? '');
                  setSaveAsOpen(true);
                }}
                disabled={!workflow || loading}
              />
              {isDirty && (
                <WorkflowActionButton
                  icon={<ReloadIcon className="w-4 h-4 text-red-500" />}
                  label="Discard changes"
                  tone="danger"
                  onClick={() => handleDirtyAction('discardChanges')}
                  disabled={loading}
                />
              )}
              <div className="border-t border-gray-200" />
              <WorkflowActionButton
                icon={<TrashIcon className="w-5 h-5 text-gray-500" />}
                label="Clear workflow cache"
                description="(hidden nodes, folds, etc.)"
                onClick={() => handleDirtyAction('clearWorkflowCache')}
                disabled={!workflow || loading}
              />
              <WorkflowActionButton
                icon={<LogoutIcon className="w-5 h-5 text-red-500" />}
                label="Unload workflow"
                description="Close the current workflow panel state"
                tone="danger"
                onClick={() => handleDirtyAction('unload')}
                disabled={!workflow || loading}
              />
              <WorkflowActionButton
                icon={<TrashIcon className="w-5 h-5 text-red-500" />}
                label="Clear device cache"
                description="Reset local storage and reload app"
                tone="danger"
                onClick={() => handleDirtyAction('clearAllCache')}
                disabled={loading}
              />
            </div>
            <div className="border-t border-gray-100 p-3">
              <button
                className="w-full px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                onClick={() => setActionsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {saveAsOpen && (
        <div
          className="fixed inset-0 z-[1460] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setSaveAsOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-base font-semibold text-gray-900 mb-3">Save as</div>
            <div className="relative">
              <input
                type="text"
                value={saveAsFilename}
                onChange={(event) => setSaveAsFilename(event.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 pr-9 py-2 text-sm text-gray-900 focus:outline-none focus:border-2 focus:border-blue-500"
                placeholder="workflow.json"
                autoFocus
              />
              {saveAsFilename.length > 0 && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  onClick={() => setSaveAsFilename('')}
                  aria-label="Clear filename"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
                onClick={() => setSaveAsOpen(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                onClick={() => {
                  const next = saveAsFilename.trim();
                  if (!next) {
                    setError('Please enter a filename.');
                    return;
                  }
                  void performSave(next);
                }}
                disabled={!workflow || loading}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {dirtyConfirmAction && createPortal(
        <Dialog
          onClose={() => setDirtyConfirmAction(null)}
          title="Unsaved changes"
          description="You have unsaved changes in the current workflow. Continue without saving?"
          actions={[
            {
              label: 'Cancel',
              onClick: () => setDirtyConfirmAction(null),
              className: 'px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100'
            },
            {
              label: dirtyConfirmAction === 'discardChanges' ? 'Discard changes' : 'Continue',
              onClick: () => { void handleDirtyConfirmContinue(dirtyConfirmAction); },
              className: 'px-3 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700'
            }
          ]}
        />,
        document.body
      )}
    </>
  );
}

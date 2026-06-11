import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { saveUserWorkflow, loadTemplateWorkflow, loadUserWorkflow, getFileWorkflow } from '@/api/client';
import { isWorkflowModified, useWorkflowStore } from '@/hooks/useWorkflow';
import { getWorkflowForPersistence } from '@/utils/workflowPersistence';
import { useGenerationSettingsStore } from '@/hooks/useGenerationSettings';
import { obfuscateWorkflowInputPaths } from '@/utils/inputPathAliases';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { useHistoryStore } from '@/hooks/useHistory';
import { Dialog } from '@/components/modals/Dialog';
import { WorkflowTopBarMenu } from './WorkflowTopBarControls/WorkflowTopBarMenu';
import { SaveAsIcon, SaveDiskIcon, TrashIcon, LogoutIcon, ReloadIcon, XMarkIcon } from '@/components/icons';

type DirtyAction = 'unload' | 'clearWorkflowCache' | 'clearAllCache' | 'discardChanges' | 'reload';

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
        isDanger ? 'text-red-400 hover:bg-red-500/10' : 'text-slate-200 hover:bg-white/10'
      }`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="shrink-0 self-start mt-[3px]">{icon}</span>
      <span className="flex flex-col min-w-0">
        <span className={`text-sm ${isDanger ? 'text-red-400' : 'text-slate-100'}`}>{label}</span>
        {description ? <span className="text-xs text-slate-400">{description}</span> : null}
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
  const addGroupNearNode = useWorkflowStore((s) => s.addGroupNearNode);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const workflowLoadedAt = useWorkflowStore((s) => s.workflowLoadedAt);
  const history = useHistoryStore((s) => s.history);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpen = menuOpenAt !== null && menuOpenAt === workflowLoadedAt;

  const isDirty = useMemo(
    () => isWorkflowModified(workflow, originalWorkflow),
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
    const store = useWorkflowStore.getState();
    const savingId = store.activeSessionId;
    try {
      setLoading(true);
      store.setSavingSessionId(savingId);
      let workflowForPersistence = getWorkflowForPersistence(workflow);
      if (!workflowForPersistence) {
        throw new Error('Unable to save: embedded workflow is unavailable.');
      }
      if (useGenerationSettingsStore.getState().obfuscateSharedInputPaths) {
        const nodeTypes = useWorkflowStore.getState().nodeTypes;
        if (!nodeTypes) throw new Error('Unable to hide input paths: node definitions are unavailable.');
        workflowForPersistence = await obfuscateWorkflowInputPaths(workflowForPersistence, nodeTypes);
      }
      await saveUserWorkflow(finalFilename, workflowForPersistence);
      setSavedWorkflow(workflow, finalFilename);
      setError(null);
      setSaveAsOpen(false);
      setActionsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow');
    } finally {
      setLoading(false);
      // Only clear if this save still owns the spinner — a newer save started
      // while this one was in flight must keep showing its own.
      if (useWorkflowStore.getState().savingSessionId === savingId) {
        useWorkflowStore.getState().setSavingSessionId(null);
      }
    }
  };

  const reloadFromSource = async () => {
    // Reload must replace the CURRENT tab's workflow, not open a new tab —
    // loadWorkflow opens a new tab by default.
    if (!workflowSource) {
      if (originalWorkflow) {
        loadWorkflow(originalWorkflow, currentFilename ?? undefined, {
          fresh: true,
          replaceActive: true,
          source: { type: 'other' }
        });
      }
      return;
    }

    if (workflowSource.type === 'user') {
      const data = await loadUserWorkflow(workflowSource.filename);
      loadWorkflow(data, workflowSource.filename, { fresh: true, replaceActive: true, source: workflowSource });
      return;
    }

    if (workflowSource.type === 'template') {
      const data = await loadTemplateWorkflow(workflowSource.moduleName, workflowSource.templateName);
      loadWorkflow(data, `${workflowSource.moduleName}/${workflowSource.templateName}`, {
        fresh: true,
        replaceActive: true,
        source: workflowSource
      });
      return;
    }

    if (workflowSource.type === 'history') {
      const historyItem = history.find((h) => h.prompt_id === workflowSource.promptId);
      if (historyItem?.workflow) {
        loadWorkflow(historyItem.workflow, `history-${workflowSource.promptId}.json`, {
          fresh: true,
          replaceActive: true,
          source: workflowSource
        });
      }
      return;
    }

    if (workflowSource.type === 'file') {
      const data = await getFileWorkflow(workflowSource.filePath, workflowSource.assetSource);
      loadWorkflow(data, workflowSource.filePath, { fresh: true, replaceActive: true, source: workflowSource });
      return;
    }

    if (originalWorkflow) {
      loadWorkflow(originalWorkflow, currentFilename ?? undefined, {
        fresh: true,
        replaceActive: true,
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

  const handleAddGroup = () => {
    const container = document.querySelector<HTMLElement>("#node-list-container");
    const nodeElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        '#node-list-container [data-reposition-item^="node-"][data-item-key]'
      )
    );
    let nearHierarchicalKey: string | null = null;
    if (container && nodeElements.length > 0) {
      const containerRect = container.getBoundingClientRect();
      const centerY = containerRect.top + containerRect.height / 2;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const element of nodeElements) {
        const itemKey = element.dataset.itemKey;
        if (!itemKey) continue;
        const rect = element.getBoundingClientRect();
        const visibleTop = Math.max(rect.top, containerRect.top);
        const visibleBottom = Math.min(rect.bottom, containerRect.bottom);
        if (visibleBottom <= visibleTop) continue;
        const elementCenterY = (visibleTop + visibleBottom) / 2;
        const distance = Math.abs(elementCenterY - centerY);
        if (distance < bestDistance) {
          bestDistance = distance;
          nearHierarchicalKey = itemKey;
        }
      }
    }
    addGroupNearNode(nearHierarchicalKey);
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
        onAddGroup={handleAddGroup}
        onOpenWorkflowActions={handleOpenWorkflowActions}
        onReloadWorkflow={() => {
          setMenuOpenAt(null);
          handleDirtyAction('reload');
        }}
      />

      {actionsOpen && (
        <div
          className="fixed inset-0 z-[1450] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setActionsOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm bg-slate-900 border border-white/10 text-slate-100 rounded-xl shadow-lg overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-4 py-3 text-sm font-semibold text-slate-100 border-b border-white/10">
              Workflow actions
            </div>
            {error && (
              <div className="px-4 py-2 text-sm text-red-300 bg-red-500/10 border-b border-red-500/20">
                {error}
              </div>
            )}
            <div className="max-h-[60vh] overflow-y-auto">
              <WorkflowActionButton
                icon={<SaveDiskIcon className="w-4 h-4 text-slate-400" />}
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
                icon={<SaveAsIcon className="w-4 h-4 text-slate-400" />}
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
              <div className="border-t border-white/10" />
              <WorkflowActionButton
                icon={<TrashIcon className="w-5 h-5 text-slate-400" />}
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
            <div className="border-t border-white/10 p-3">
              <button
                className="w-full px-4 py-2.5 text-sm font-medium text-slate-300 bg-slate-950/80 rounded-lg hover:bg-white/10"
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
            className="w-full max-w-sm bg-slate-900 border border-white/10 text-slate-100 rounded-xl shadow-lg p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-base font-semibold text-slate-100 mb-3">Save as</div>
            <div className="relative">
              <input
                type="text"
                value={saveAsFilename}
                onChange={(event) => setSaveAsFilename(event.target.value)}
                data-swipe-nav-ignore="true"
                className="w-full border border-white/10 bg-slate-950/80 rounded-lg px-3 pr-9 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                placeholder="workflow.json"
                autoFocus
              />
              {saveAsFilename.length > 0 && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100"
                  onClick={() => setSaveAsFilename('')}
                  aria-label="Clear filename"
                >
                  <XMarkIcon className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-white/10"
                onClick={() => setSaveAsOpen(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-950 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50"
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
              variant: 'secondary'
            },
            {
              label: dirtyConfirmAction === 'discardChanges'
                ? 'Discard changes'
                : dirtyConfirmAction === 'reload'
                  ? 'Reload anyway'
                  : 'Continue',
              onClick: () => { void handleDirtyConfirmContinue(dirtyConfirmAction); },
              variant: 'danger'
            }
          ]}
        />,
        document.body
      )}
    </>
  );
}

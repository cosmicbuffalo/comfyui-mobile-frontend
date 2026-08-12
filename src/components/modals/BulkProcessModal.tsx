import { useEffect, useMemo, useState } from 'react';
import type { FileItem, UserDataFile } from '@/api/client';
import {
  clientId,
  listUserWorkflows,
  loadUserWorkflow,
  queuePrompt,
} from '@/api/client';
import type { Workflow } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useQueueStore } from '@/hooks/useQueue';
import { useWorkflowHiddenStore } from '@/hooks/useWorkflowHidden';
import { resolveInputPathForFile } from '@/utils/filesystem';
import { buildPromptFromWorkflow } from '@/utils/buildPromptFromWorkflow';
import { collectScopedWorkflowNodes } from '@/utils/workflowNodes';
import {
  cloneWithImage,
  isLoadImageType,
  sourceFromId,
  targetKey,
  type LoadImageTarget,
} from '@/utils/bulkProcess';
import { getNodeLabel } from '@/utils/workflowOperations';
import {
  getDisplayName,
  getRelativePath,
  isHiddenWorkflowPath,
  isManuallyHiddenWorkflowPath,
} from '@/components/AppMenu/userWorkflowHelpers';

interface BulkProcessModalProps {
  open: boolean;
  items: FileItem[];
  onClose: () => void;
  onComplete?: () => void;
}

type Step = 'workflow' | 'node' | 'confirm';

export function BulkProcessModal({ open, items, onClose, onComplete }: BulkProcessModalProps) {
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const registerLocalPrompt = useQueueStore((s) => s.registerLocalPrompt);
  const hiddenWorkflowPaths = useWorkflowHiddenStore((s) => s.hidden);

  const [step, setStep] = useState<Step>('workflow');
  const [workflowFiles, setWorkflowFiles] = useState<UserDataFile[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);
  const [selectedWorkflowPath, setSelectedWorkflowPath] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [loadImageTargets, setLoadImageTargets] = useState<LoadImageTarget[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<LoadImageTarget | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowWarning, setWorkflowWarning] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<{ queued: number; failed: number; error?: string } | null>(
    null,
  );

  // Reset everything whenever the modal is (re)opened.
  useEffect(() => {
    if (!open) return;
    setStep('workflow');
    setSelectedFilename(null);
    setSelectedWorkflowPath(null);
    setSelectedWorkflow(null);
    setLoadImageTargets([]);
    setSelectedTarget(null);
    setWorkflowWarning(null);
    setRunning(false);
    setProgress(0);
    setSummary(null);

    setListLoading(true);
    setListError(null);
    listUserWorkflows()
      .then((files) => setWorkflowFiles(files.filter((f) => f.type === 'file')))
      .catch((err) => setListError(err instanceof Error ? err.message : 'Failed to list workflows'))
      .finally(() => setListLoading(false));
  }, [open]);

  const handleSelectWorkflow = async (file: UserDataFile) => {
    if (!nodeTypes) {
      setWorkflowWarning('Node definitions are still loading — try again in a moment.');
      return;
    }
    setWorkflowBusy(true);
    setWorkflowWarning(null);
    setSelectedFilename(file.name); // drives the per-row "Loading…" indicator
    try {
      // file.path carries a "workflows/" prefix; loadUserWorkflow re-adds it, so
      // pass the prefix-stripped relative path (same as the workflows panel).
      const relativePath = getRelativePath(file);
      const workflow = await loadUserWorkflow(relativePath);
      const targets = collectScopedWorkflowNodes(workflow)
        .filter(({ node }) => isLoadImageType(node.type) && node.mode !== 4)
        .map(({ node, subgraphId }) => ({ node, subgraphId }));
      if (targets.length === 0) {
        setWorkflowWarning(`"${getDisplayName(file.name)}" has no Load Image node.`);
        return;
      }
      setSelectedWorkflowPath(relativePath);
      setSelectedWorkflow(workflow);
      setLoadImageTargets(targets);
      if (targets.length === 1) {
        setSelectedTarget(targets[0]);
        setStep('confirm');
      } else {
        setSelectedTarget(null);
        setStep('node');
      }
    } catch (err) {
      setWorkflowWarning(err instanceof Error ? err.message : 'Failed to load workflow.');
    } finally {
      setWorkflowBusy(false);
    }
  };

  const handleSelectNode = (target: LoadImageTarget) => {
    setSelectedTarget(target);
    setStep('confirm');
  };

  const handleRun = async () => {
    if (!selectedWorkflow || !selectedTarget || !nodeTypes) return;
    setRunning(true);
    setProgress(0);
    let queued = 0;
    let failed = 0;
    let firstError: string | undefined;
    const selectedWorkflowHidden = selectedWorkflowPath
      ? isHiddenWorkflowPath(selectedWorkflowPath)
        || isManuallyHiddenWorkflowPath(selectedWorkflowPath, hiddenWorkflowPaths)
      : false;

    for (const item of items) {
      try {
        const source = sourceFromId(item.id);
        const hideCopiedInput = Boolean(item.hidden || selectedWorkflowHidden);
        const imageValue = await resolveInputPathForFile(item, source, { hideCopiedInput });
        const clone = cloneWithImage(selectedWorkflow, nodeTypes, selectedTarget, imageValue);
        if (!clone) throw new Error('Could not set the image on the chosen node.');
        const prompt = buildPromptFromWorkflow(clone, nodeTypes);
        const response = await queuePrompt({
          prompt,
          client_id: clientId,
          extra_data: { extra_pnginfo: { workflow: clone } },
        });
        if (response.prompt_id) registerLocalPrompt(response.prompt_id);
        queued += 1;
      } catch (err) {
        failed += 1;
        if (!firstError) firstError = err instanceof Error ? err.message : String(err);
        console.error('Bulk process: failed to queue an image', item.id, err);
      } finally {
        setProgress((p) => p + 1);
      }
    }

    setRunning(false);
    setSummary({ queued, failed, error: failed > 0 ? firstError : undefined });
    onComplete?.();
  };

  const selectedLabel = useMemo(() => {
    if (!selectedTarget || !selectedWorkflow || !nodeTypes) return '';
    return getNodeLabel(selectedTarget.node, nodeTypes, selectedWorkflow);
  }, [selectedTarget, selectedWorkflow, nodeTypes]);

  if (!open) return null;

  return (
    <div
      id="bulk-process-overlay"
      className="fixed inset-0 z-[2150] bg-black/50 flex items-center justify-center p-4"
      onClick={running ? undefined : onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        id="bulk-process-modal"
        className="w-full max-w-sm bg-slate-900 border border-white/10 text-slate-100 rounded-xl shadow-lg overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-4 py-3 text-sm font-semibold text-slate-100 border-b border-white/10 flex items-center gap-2">
          {step === 'node' && (
            <button
              type="button"
              className="text-cyan-300 hover:text-cyan-200 text-xs"
              onClick={() => setStep('workflow')}
            >
              ‹ Back
            </button>
          )}
          {step === 'confirm' && !running && !summary && (
            <button
              type="button"
              className="text-cyan-300 hover:text-cyan-200 text-xs"
              onClick={() => setStep(loadImageTargets.length > 1 ? 'node' : 'workflow')}
            >
              ‹ Back
            </button>
          )}
          <span>
            {step === 'workflow' && 'Bulk process — pick a workflow'}
            {step === 'node' && 'Pick a Load Image node'}
            {step === 'confirm' && 'Confirm bulk process'}
          </span>
        </div>

        <div className="px-4 pt-3 text-xs text-slate-400">
          {items.length} image{items.length === 1 ? '' : 's'} selected
        </div>

        {/* Step: workflow picker */}
        {step === 'workflow' && (
          <div className="max-h-[50vh] overflow-y-auto">
            {listLoading && (
              <div className="px-4 py-3 text-sm text-slate-400">Loading workflows…</div>
            )}
            {listError && (
              <div className="px-4 py-3 text-sm text-red-400">{listError}</div>
            )}
            {!listLoading && !listError && workflowFiles.length === 0 && (
              <div className="px-4 py-3 text-sm text-slate-400">No saved workflows found.</div>
            )}
            {workflowFiles.map((file) => (
              <button
                key={file.path}
                className="w-full text-left px-4 py-3 text-sm hover:bg-white/10 flex items-center gap-2 disabled:opacity-60"
                onClick={() => handleSelectWorkflow(file)}
                disabled={workflowBusy}
              >
                <span className="flex-1 text-slate-100 truncate">{getDisplayName(file.name)}</span>
                {workflowBusy && selectedFilename === file.name && (
                  <span className="text-xs text-slate-400">Loading…</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Step: node picker */}
        {step === 'node' && (
          <div className="max-h-[50vh] overflow-y-auto">
            {loadImageTargets.map((target) => {
              const label = nodeTypes
                ? getNodeLabel(target.node, nodeTypes, selectedWorkflow as Workflow)
                : target.node.type;
              return (
                <button
                  key={targetKey(target)}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-white/10 flex items-center gap-2"
                  onClick={() => handleSelectNode(target)}
                >
                  <span className="text-slate-400">#{target.node.id}</span>
                  <span className="flex-1 text-slate-100 truncate">{label}</span>
                  {target.subgraphId && (
                    <span className="text-xs text-slate-500">subgraph</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Step: confirm / run */}
        {step === 'confirm' && (
          <div className="px-4 py-3 text-sm text-slate-200">
            {!summary ? (
              <>
                <p>
                  Queue <span className="font-semibold">{items.length}</span> run
                  {items.length === 1 ? '' : 's'} of{' '}
                  <span className="font-semibold">
                    {selectedFilename ? getDisplayName(selectedFilename) : 'workflow'}
                  </span>
                  , one per selected image, into{' '}
                  <span className="font-semibold">{selectedLabel || 'the Load Image node'}</span>.
                </p>
                {running && (
                  <p className="mt-3 text-xs text-slate-400">
                    Queued {progress} / {items.length}…
                  </p>
                )}
              </>
            ) : (
              <p>
                Queued <span className="font-semibold">{summary.queued}</span> of {items.length}
                {summary.failed > 0 && (
                  <>
                    {' '}
                    — <span className="text-red-400">{summary.failed} failed</span>
                    {summary.error ? ` (${summary.error})` : ''}
                  </>
                )}
                .
              </p>
            )}
          </div>
        )}

        {workflowWarning && (
          <div className="px-4 py-2 text-xs text-amber-400 border-t border-white/10">
            {workflowWarning}
          </div>
        )}

        <div className="px-4 py-3 border-t border-white/10 flex justify-end gap-2">
          {step === 'confirm' && !summary ? (
            <>
              <button
                className="px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/10 rounded-lg disabled:opacity-60"
                onClick={onClose}
                disabled={running}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 text-sm font-medium text-slate-900 bg-cyan-300 hover:bg-cyan-200 rounded-lg disabled:opacity-60"
                onClick={handleRun}
                disabled={running}
              >
                {running ? 'Queuing…' : 'Run'}
              </button>
            </>
          ) : (
            <button
              className="px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/10 rounded-lg disabled:opacity-60"
              onClick={onClose}
              disabled={running}
            >
              {summary ? 'Done' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

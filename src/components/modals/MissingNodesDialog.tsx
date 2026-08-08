import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@/components/modals/Dialog';
import { WarningTriangleIcon } from '@/components/icons';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useCustomNodesManager } from '@/hooks/useCustomNodesManager';
import { collectMissingNodeTypes } from '@/utils/missingNodes';
import { prefetchCustomNodesData } from '@/utils/customNodesManagerCache';

/**
 * On loading a workflow that uses custom nodes which aren't installed, surface a
 * dialog listing them (mirroring desktop ComfyUI) with a shortcut into the
 * Custom Nodes Manager pre-filtered to the missing packages. Mounted once at the
 * app root. The missing nodes themselves are outlined in red on the canvas
 * (NodeCard). Re-shown on each fresh load via the workflowLoadedAt token.
 */
export function MissingNodesDialog() {
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const workflowLoadedAt = useWorkflowStore((s) => s.workflowLoadedAt);
  const openManager = useCustomNodesManager((s) => s.open);
  // Dismissals are per workflow load, but `workflowLoadedAt` is session state:
  // it is parked and restored on every workflow-tab switch, so a single token
  // cannot represent two tabs. Keyed by token instead, or dismissing in tab 1
  // and returning to it re-opens this blocking modal every single time.
  const [dismissedTokens, setDismissedTokens] = useState<number[]>([]);

  const missingTypes = useMemo(
    () => collectMissingNodeTypes(workflow, nodeTypes),
    [workflow, nodeTypes],
  );

  // Warm the (multi-MB) Custom Nodes Manager data in the background the moment we
  // know the workflow has missing nodes, so the manager opens fast when the user
  // taps "Install" — by which point the data is usually already loaded.
  useEffect(() => {
    if (missingTypes.length > 0) prefetchCustomNodesData();
  }, [missingTypes.length]);

  const dismissed = workflowLoadedAt != null && dismissedTokens.includes(workflowLoadedAt);
  if (missingTypes.length === 0 || dismissed) return null;

  const dismiss = () => {
    if (workflowLoadedAt == null) return;
    setDismissedTokens((tokens) =>
      tokens.includes(workflowLoadedAt) ? tokens : [...tokens, workflowLoadedAt],
    );
  };

  return (
    <Dialog
      onClose={dismiss}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <WarningTriangleIcon className="w-5 h-5 shrink-0 text-red-500" />
          This workflow has missing nodes
        </span>
      }
      description={
        <div className="space-y-3">
          <p>This workflow uses custom nodes you haven&apos;t installed yet.</p>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2">
            {missingTypes.map((type) => (
              <li
                key={type}
                className="missing-node-type rounded px-2 py-1 font-mono text-xs text-red-200 [overflow-wrap:anywhere]"
              >
                {type}
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-400">
            Install these nodes to run this workflow, or replace them with installed
            alternatives. Missing nodes are highlighted in red.
          </p>
        </div>
      }
      actionsLayout="stack"
      actions={[
        {
          label: 'Install missing nodes',
          variant: 'primary',
          autoFocus: true,
          onClick: () => {
            openManager('Missing');
            dismiss();
          },
        },
        { label: 'Dismiss', variant: 'secondary', onClick: dismiss },
      ]}
    />
  );
}

import { useMemo, useState } from 'react';
import { ArrowRightIcon, CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, NoEntryIcon, PlusIcon, TrashIcon, WorkflowIcon } from '@/components/icons';
import { MoveIntoSubgraphModal } from '@/components/modals/MoveIntoSubgraphModal';
import { RemoveHarvestedNodesDialog } from '@/components/modals/RemoveHarvestedNodesDialog';
import { Dialog } from '@/components/modals/Dialog';
import { ModalFrame } from '@/components/modals/ModalFrame';
import { useWorkflowSelectionStore } from '@/hooks/useWorkflowSelection';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { appChromeIconButtonClassName, chromeBarButtonClassName } from '@/components/chromeStyles';
import { collectMoveIntoSubgraphTargets } from '@/utils/moveIntoSubgraphTargets';
import { useI18n } from '@/i18n';

/**
 * Bottom-bar control shown in place of the queue button while workflow select
 * mode is active. Mirrors the outputs panel's SelectionActionButton: an empty
 * ring when nothing is selected (tap to leave select mode), a filled cyan disc
 * with the selected count once items are chosen (tap to open the bulk-ops menu).
 */
export function WorkflowSelectionButton() {
  const { t } = useI18n();
  const selectedKeys = useWorkflowSelectionStore((s) => s.selectedKeys);
  const actionMenuOpen = useWorkflowSelectionStore((s) => s.actionMenuOpen);
  const setActionMenuOpen = useWorkflowSelectionStore((s) => s.setActionMenuOpen);
  const exitSelectionMode = useWorkflowSelectionStore((s) => s.exitSelectionMode);

  const copySelectedItems = useWorkflowStore((s) => s.copySelectedItems);
  const createGroupFromItems = useWorkflowStore((s) => s.createGroupFromItems);
  const createSubgraphFromItems = useWorkflowStore((s) => s.createSubgraphFromItems);
  const deleteSelectedItems = useWorkflowStore((s) => s.deleteSelectedItems);
  const moveItemsIntoSubgraph = useWorkflowStore((s) => s.moveItemsIntoSubgraph);
  const jumpToWorkflowItem = useWorkflowStore((s) => s.jumpToWorkflowItem);
  const setItemHidden = useWorkflowStore((s) => s.setItemHidden);
  const hiddenItems = useWorkflowStore((s) => s.hiddenItems);
  const itemKeyByPointer = useWorkflowStore((s) => s.itemKeyByPointer);
  const workflow = useWorkflowStore((s) => s.workflow);
  const scopeStack = useWorkflowStore((s) => s.scopeStack);

  const [namingSubgraph, setNamingSubgraph] = useState(false);
  const [movingIntoSubgraph, setMovingIntoSubgraph] = useState(false);
  const [subgraphName, setSubgraphName] = useState('');
  // Nodes a move left feeding nothing; non-empty opens the removal offer.
  const [harvestedNodeIds, setHarvestedNodeIds] = useState<number[]>([]);

  const count = selectedKeys.length;
  const hasSelection = count > 0;
  // Offered only when this scope holds a subgraph the selection could go into —
  // one that isn't itself part of the selection.
  const canMoveIntoSubgraph = useMemo(
    () => collectMoveIntoSubgraphTargets(workflow, scopeStack, selectedKeys).length > 0,
    [workflow, scopeStack, selectedKeys],
  );
  // Drives one menu entry rather than separate Hide and Unhide ones: it reads
  // Unhide only when every selected item is already hidden — reachable because
  // select mode can pick hidden items — and Hide otherwise, so a mixed
  // selection hides and ends up agreeing.
  const allSelectedHidden = useMemo(
    () => selectedKeys.length > 0
      && selectedKeys.every((key) => Boolean(hiddenItems[itemKeyByPointer[key] ?? key])),
    [hiddenItems, itemKeyByPointer, selectedKeys],
  );

  const handleCreateSubgraph = () => {
    const created = createSubgraphFromItems(selectedKeys, subgraphName);
    setNamingSubgraph(false);
    setSubgraphName('');
    exitSelectionMode();
    // Go to what was just made: the selection has vanished from the list and
    // been replaced by one card, and being shown which is the difference
    // between a helpful operation and a startling one. It lands below the top
    // third rather than flush with the top edge, so what the new card sits
    // under is still on screen — arriving with nothing recognisable above it
    // reads as the list having jumped somewhere arbitrary.
    if (created?.placeholderItemKey) {
      jumpToWorkflowItem(
        { kind: 'subgraph', itemKey: created.placeholderItemKey },
        { align: 'belowTopThird' },
      );
    }
  };

  const handleButtonClick = () => {
    if (!hasSelection) {
      exitSelectionMode();
      return;
    }
    setActionMenuOpen(true);
  };

  const runAndExit = (op: (keys: string[]) => void) => {
    op(selectedKeys);
    exitSelectionMode();
  };

  const setSelectionHidden = (keys: string[], hidden: boolean) => {
    for (const key of keys) setItemHidden(key, hidden);
  };

  return (
    <>
      <button
        onClick={handleButtonClick}
        className={`${chromeBarButtonClassName} ${appChromeIconButtonClassName}`}
        aria-label={hasSelection ? t('Selection actions') : t('Exit select mode')}
      >
        <div
          className={`flex h-6 min-w-6 items-center justify-center rounded-full border-2 px-1 shadow-sm ${
            hasSelection
              ? 'bg-cyan-500 border-cyan-500 text-slate-950'
              : 'border-slate-500 bg-transparent text-slate-400'
          }`}
        >
          {hasSelection ? (
            <span className="text-xs font-bold tabular-nums">{count}</span>
          ) : (
            <CheckIcon className="h-4 w-4 opacity-0" />
          )}
        </div>
      </button>

      {movingIntoSubgraph && (
        <MoveIntoSubgraphModal
          itemKeys={selectedKeys}
          onClose={() => setMovingIntoSubgraph(false)}
          onConfirm={(placeholderItemKey) => {
            const moved = moveItemsIntoSubgraph(selectedKeys, placeholderItemKey);
            setMovingIntoSubgraph(false);
            exitSelectionMode();
            // The move may have stranded sibling instances' feeder nodes after
            // carrying their values inside; offer to clean those up.
            if (moved && moved.harvestedFrom.length > 0) {
              setHarvestedNodeIds(moved.harvestedFrom);
            }
            // The moved nodes have left the list; show where they went. Landed
            // the same way as a newly created subgraph — below the top third,
            // so what it sits under is still visible — and the alignment pass
            // corrects itself once the list has finished closing the gap the
            // moved nodes left, which a plain scroll does not.
            jumpToWorkflowItem(
              { kind: 'subgraph', itemKey: placeholderItemKey },
              { align: 'belowTopThird' },
            );
          }}
        />
      )}

      {harvestedNodeIds.length > 0 && (
        <RemoveHarvestedNodesDialog
          nodeIds={harvestedNodeIds}
          onClose={() => setHarvestedNodeIds([])}
        />
      )}

      {namingSubgraph && (
        <Dialog
          onClose={() => setNamingSubgraph(false)}
          title={t('Create subgraph')}
          description={
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-xs text-slate-400">
                {t(
                  'The {count} selected items move into a new subgraph. Whatever they are connected to becomes its inputs and outputs.',
                  { count },
                )}
              </p>
              <p className="text-xs text-slate-500">
                {t(
                  'Put {token} in the name to number its copies — "Layer {token}" reads as "Layer 1", "Layer 2" on each one.',
                  { token: '{n}' },
                )}
              </p>
              <input
                type="text"
                autoFocus
                aria-label={t('Subgraph name')}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                placeholder={t('Subgraph')}
                value={subgraphName}
                data-swipe-nav-ignore
                onChange={(event) => setSubgraphName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleCreateSubgraph();
                }}
              />
            </div>
          }
          actions={[
            { label: t('Cancel'), onClick: () => setNamingSubgraph(false), variant: 'secondary' },
            { label: t('Create subgraph'), onClick: handleCreateSubgraph, variant: 'primary' },
          ]}
        />
      )}

      {actionMenuOpen && (
        <ModalFrame onClose={() => setActionMenuOpen(false)} zIndex={1800}>
          <div className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-slate-100">
            {t('{count} selected', { count })}
          </div>
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-200 hover:bg-white/10"
            onClick={() => runAndExit(copySelectedItems)}
          >
            <CopyIcon className="h-4 w-4 text-slate-400" />
            {t('Copy')}
          </button>
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-200 hover:bg-white/10"
            onClick={() => runAndExit(createGroupFromItems)}
          >
            <PlusIcon className="h-4 w-4 text-cyan-300" />
            {t('Create group')}
          </button>
          <button
            className="create-subgraph-action flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-200 hover:bg-white/10"
            onClick={() => {
              setActionMenuOpen(false);
              setNamingSubgraph(true);
            }}
          >
            <WorkflowIcon className="h-4 w-4 -scale-x-100 text-cyan-300" />
            {t('Create subgraph')}
          </button>
          {canMoveIntoSubgraph && (
            <button
              className="move-into-subgraph-action flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-200 hover:bg-white/10"
              onClick={() => {
                setActionMenuOpen(false);
                setMovingIntoSubgraph(true);
              }}
            >
              <ArrowRightIcon className="h-4 w-4 text-cyan-300" />
              {t('Move into subgraph')}
            </button>
          )}
          <button
            className="hide-selection-action flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-200 hover:bg-white/10"
            onClick={() => runAndExit((keys) => setSelectionHidden(keys, !allSelectedHidden))}
          >
            {allSelectedHidden ? (
              <EyeIcon className="h-4 w-4 text-slate-400" />
            ) : (
              <EyeOffIcon className="h-4 w-4 text-slate-400" />
            )}
            {allSelectedHidden ? t('Unhide') : t('Hide')}
          </button>
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-red-400 hover:bg-red-500/10"
            onClick={() => runAndExit(deleteSelectedItems)}
          >
            <TrashIcon className="h-4 w-4" />
            {t('Delete')}
          </button>
          <button
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-slate-400 hover:bg-white/10"
            onClick={exitSelectionMode}
          >
            <NoEntryIcon className="h-4 w-4 text-slate-400" />
            {t('Cancel selection')}
          </button>
        </ModalFrame>
      )}
    </>
  );
}

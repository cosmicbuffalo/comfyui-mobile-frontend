import { useMemo, useState } from 'react';
import type { WorkflowSubgraphDefinition } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { getInstanceNumber } from '@/utils/canonicalWorkflowOps';
import { interpolateInstanceLabel } from '@/utils/subgraphInstanceLabels';
import { resolveItemReferenceAppearance, type ParentChip } from '@/utils/itemParentage';
import { findScopeTrailForPlaceholder } from '@/utils/subgraphInstanceNavigation';
import type { ScopeFrame } from '@/hooks/useWorkflow';
import { SubgraphInstanceEntry } from '@/components/SubgraphInstanceEntry';
import { collectSubgraphInstances } from '@/utils/boundarySlotLabels';
import { CaretDownIcon, CaretRightIcon, EditIcon, TrashIcon } from '@/components/icons';
import { SearchActionModal } from './SearchActionModal';
import { Dialog } from './Dialog';
import { useI18n } from '@/i18n';

interface SubgraphTypesModalProps {
  onClose: () => void;
}

interface TypeInstance {
  nodeId: number;
  itemKey: string | null;
  label: string;
  parents: ParentChip[];
  surfaceColor: string;
  borderColor: string;
  /** The scope this instance lives in, which may not be the one on screen. */
  trail: ScopeFrame[] | null;
}

interface TypeRow {
  def: WorkflowSubgraphDefinition;
  instances: TypeInstance[];
  innerNodeCount: number;
  inputCount: number;
  outputCount: number;
}

/**
 * Inventory of the subgraph types defined in this workflow. Every definition
 * is a type — a one-off is just a type with a single instance — so this is one
 * list, not two. Each row expands to show where the type is used, and carries
 * the rename / delete actions that have no other home.
 */
export function SubgraphTypesModal({ onClose }: SubgraphTypesModalProps) {
  const { t } = useI18n();
  const workflow = useWorkflowStore((s) => s.workflow);
  const mobileLayout = useWorkflowStore((s) => s.mobileLayout);
  const setScopeTrail = useWorkflowStore((s) => s.setScopeTrail);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const renameSubgraphType = useWorkflowStore((s) => s.renameSubgraphType);
  const deleteSubgraphType = useWorkflowStore((s) => s.deleteSubgraphType);
  const jumpToWorkflowItem = useWorkflowStore((s) => s.jumpToWorkflowItem);

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TypeRow | null>(null);

  const rows = useMemo<TypeRow[]>(() => {
    if (!workflow) return [];
    const defs = workflow.definitions?.subgraphs ?? [];
    return defs.map((def) => {
      // Placeholders live at root and, for nested subgraphs, inside other
      // definitions — one walker for every surface that needs them.
      const instances: TypeInstance[] = collectSubgraphInstances(workflow, def.id).map(
        ({ node }) => {
          const n = getInstanceNumber(node);
          const ownTitle = node.title?.trim();
          const base = ownTitle
            || interpolateInstanceLabel(def.name ?? '', n)
            || def.name
            || def.id.slice(0, 8);
          const trail = findScopeTrailForPlaceholder(workflow, node.id, { expectedType: node.type });
          const top = trail?.[trail.length - 1];
          const appearance = resolveItemReferenceAppearance(workflow, mobileLayout, nodeTypes, {
            nodeId: node.id,
            subgraphId: top && top.type === 'subgraph' ? top.id : null,
          });
          return {
            nodeId: node.id,
            itemKey: node.itemKey ?? null,
            trail,
            // Where it sits, which is the only thing telling two instances of
            // one type apart — the same treatment the bookmark bar uses.
            ...appearance,
            // The number only where it says something the name does not. An
            // instance with no name of its own already renders the type's
            // template for its own number, so "Layer 2 · #2" says it twice.
            label: ownTitle && n != null ? `${base} · #${n}` : base,
          };
        },
      );
      return {
        def,
        instances,
        innerNodeCount: (def.nodes ?? []).length,
        inputCount: (def.inputs ?? []).length,
        outputCount: (def.outputs ?? []).length,
      };
    });
  }, [workflow, mobileLayout, nodeTypes]);

  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.def.name ?? '').toLowerCase().includes(q));
  }, [rows, searchQuery]);


  const jumpTo = (instance: TypeInstance) => {
    if (!instance.itemKey) return;
    const itemKey = instance.itemKey;
    // The trail is passed rather than left to be derived: with a shared type,
    // deriving it would pick some instance of the definition, and the point of
    // this list is that the user chose which one.
    if (instance.trail) setScopeTrail(instance.trail);
    onClose();
    jumpToWorkflowItem({ kind: 'subgraph', itemKey });
  };

  const commitRename = (row: TypeRow) => {
    const value = renameValue.trim();
    if (value && value !== row.def.name) renameSubgraphType(row.def.id, value);
    setRenamingId(null);
  };

  const renderRow = (row: TypeRow) => {
    const isExpanded = expandedId === row.def.id;
    const isRenaming = renamingId === row.def.id;
    const count = row.instances.length;
    return (
      <div
        key={row.def.id}
        className="subgraph-type-row rounded-lg border border-white/10 bg-slate-900/95 overflow-hidden"
        data-subgraph-type={row.def.id}
      >
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5"
          onClick={() => setExpandedId(isExpanded ? null : row.def.id)}
        >
          {isExpanded
            ? <CaretDownIcon className="w-4 h-4 text-slate-400 shrink-0" />
            : <CaretRightIcon className="w-4 h-4 text-slate-400 shrink-0" />}
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-slate-100 truncate">
              {row.def.name || row.def.id.slice(0, 8)}
            </span>
            <span className="block text-xs text-slate-400 truncate">
              {count === 1
                ? t('{count} instance', { count })
                : t('{count} instances', { count })}
              {' · '}
              {t('{nodes} nodes · {in} in · {out} out', {
                nodes: row.innerNodeCount, in: row.inputCount, out: row.outputCount,
              })}
            </span>
          </span>
        </button>

        {isExpanded && (
          <div className="px-3 pb-3 flex flex-col gap-2 border-t border-white/5 pt-2">
            {isRenaming ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  type="text"
                  className="flex-1 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  value={renameValue}
                  placeholder={t('Type name (use {token} for the instance number)', { token: '{n}' })}
                  data-swipe-nav-ignore
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(row);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                />
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold text-slate-950 bg-cyan-500"
                  onClick={() => commitRename(row)}
                >
                  {t('Save')}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="subgraph-type-action flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 hover:bg-white/10"
                  onClick={() => { setRenamingId(row.def.id); setRenameValue(row.def.name ?? ''); }}
                >
                  <EditIcon className="w-3.5 h-3.5" />{t('Rename')}
                </button>
                <button
                  type="button"
                  className="subgraph-type-action flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/25 text-xs text-red-300 hover:bg-red-500/20"
                  onClick={() => setDeleteTarget(row)}
                >
                  <TrashIcon className="w-3.5 h-3.5" />{t('Delete')}
                </button>
              </div>
            )}

            {count > 0 && (
              <div className="flex flex-col gap-1">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">
                  {t('Used by')}
                </div>
                {row.instances.map((inst) => (
                  <SubgraphInstanceEntry
                    key={inst.nodeId}
                    label={inst.label}
                    parents={inst.parents}
                    surfaceColor={inst.surfaceColor}
                    borderColor={inst.borderColor}
                    disabled={!inst.itemKey}
                    className="subgraph-type-instance"
                    onClick={() => jumpTo(inst)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const deleteCount = deleteTarget?.instances.length ?? 0;

  return (
    <>
      <SearchActionModal
        isOpen
        onClose={onClose}
        title={t('Subgraph types')}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchPlaceholder={t('Search subgraphs...')}
      >
        <div className="subgraph-types-list flex-1 overflow-y-auto px-4 py-3">
          <div className="mx-auto w-full max-w-3xl flex flex-col gap-4">
            {rows.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-slate-400">
                {t('This workflow has no subgraphs yet.')}
              </div>
            )}
            {visible.map(renderRow)}
          </div>
        </div>
      </SearchActionModal>

      {deleteTarget && (
        <Dialog
          onClose={() => setDeleteTarget(null)}
          zIndex={2300}
          title={t('Delete type')}
          description={
            deleteCount === 0
              ? t('"{name}" is not used by anything. Deleting removes the definition.', {
                  name: deleteTarget.def.name || deleteTarget.def.id.slice(0, 8),
                })
              : t('"{name}" is used by {count} instances. Choose what happens to them.', {
                  name: deleteTarget.def.name || deleteTarget.def.id.slice(0, 8),
                  count: deleteCount,
                })
          }
          actionsLayout={deleteCount === 0 ? 'inline' : 'stack'}
          actions={
            deleteCount === 0
              ? [
                  { label: t('Cancel'), onClick: () => setDeleteTarget(null), variant: 'secondary' },
                  {
                    label: t('Delete type'),
                    variant: 'danger',
                    autoFocus: true,
                    onClick: () => { deleteSubgraphType(deleteTarget.def.id, 'delete'); setDeleteTarget(null); },
                  },
                ]
              : [
                  {
                    label: t('Unpack instances into the graph'),
                    variant: 'danger',
                    className: 'w-full bg-red-500/15 text-red-300 hover:bg-red-500/20',
                    onClick: () => { deleteSubgraphType(deleteTarget.def.id, 'dissolve'); setDeleteTarget(null); },
                  },
                  {
                    label: t('Delete instances and their nodes'),
                    variant: 'danger',
                    className: 'w-full',
                    onClick: () => { deleteSubgraphType(deleteTarget.def.id, 'delete'); setDeleteTarget(null); },
                  },
                  { label: t('Cancel'), onClick: () => setDeleteTarget(null), variant: 'secondary', className: 'w-full' },
                ]
          }
        />
      )}
    </>
  );
}

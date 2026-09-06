import { useMemo, useState } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { collectSubgraphInstances } from '@/utils/boundarySlotLabels';
import { getInstanceNumber } from '@/utils/canonicalWorkflowOps';
import { resolveItemReferenceAppearance } from '@/utils/itemParentage';
import { findScopeTrailForPlaceholder } from '@/utils/subgraphInstanceNavigation';
import { SubgraphInstanceEntry } from '@/components/SubgraphInstanceEntry';
import { ForkIcon, WorkflowIcon } from '@/components/icons';
import { Dialog } from './Dialog';
import { useI18n } from '@/i18n';

interface SubgraphTypeInfoModalProps {
  subgraphId: string;
  onClose: () => void;
}

/**
 * What a shared subgraph type is, and the way out of it.
 *
 * The banner this opens from says edits reach every instance, which is the
 * thing users want to escape when they only meant to change one. Forking is
 * that escape, so it lives here rather than in a menu somewhere else: the
 * explanation and the remedy arrive together.
 */
export function SubgraphTypeInfoModal({ subgraphId, onClose }: SubgraphTypeInfoModalProps) {
  const { t } = useI18n();
  const workflow = useWorkflowStore((s) => s.workflow);
  const mobileLayout = useWorkflowStore((s) => s.mobileLayout);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const scopeStack = useWorkflowStore((s) => s.scopeStack);
  const forkSubgraphType = useWorkflowStore((s) => s.forkSubgraphType);

  const def = useMemo(
    () => workflow?.definitions?.subgraphs?.find((sg) => sg.id === subgraphId) ?? null,
    [workflow, subgraphId],
  );
  const typeName = def?.name ?? subgraphId.slice(0, 8);

  const currentInstanceId = useMemo(() => {
    const top = scopeStack[scopeStack.length - 1];
    return top?.type === 'subgraph' ? top.placeholderNodeId : null;
  }, [scopeStack]);

  const instances = useMemo(
    () =>
      collectSubgraphInstances(workflow, subgraphId).map(({ node }) => {
        const number = getInstanceNumber(node);
        const title = typeof node.title === 'string' ? node.title.trim() : '';
        const trail = findScopeTrailForPlaceholder(workflow, node.id, { expectedType: node.type });
        const top = trail?.[trail.length - 1];
        const appearance = resolveItemReferenceAppearance(workflow, mobileLayout, nodeTypes, {
          nodeId: node.id,
          subgraphId: top && top.type === 'subgraph' ? top.id : null,
        });
        return {
          nodeId: node.id,
          label: [
            number != null
              ? t('Instance #{number}', { number })
              : t('Instance #{id}', { id: node.id }),
            title,
          ]
            .filter(Boolean)
            .join(' · '),
          ...appearance,
        };
      }),
    [workflow, subgraphId, mobileLayout, nodeTypes, t],
  );

  const [forking, setForking] = useState(false);
  // The instance the user is standing in is the one they came here to peel off,
  // so it starts chosen; the rest is a deliberate act.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(currentInstanceId != null ? [currentInstanceId] : []),
  );
  const [forkName, setForkName] = useState(() => t('{name} fork', { name: typeName }));

  const toggle = (nodeId: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });

  const handleFork = () => {
    forkSubgraphType(subgraphId, [...selected], forkName);
    onClose();
  };

  if (!def) return null;

  return (
    <Dialog
      onClose={onClose}
      title={
        forking ? (
          t('Fork this subgraph')
        ) : (
          <span className="flex items-center gap-2">
            <WorkflowIcon className="h-5 w-5 -scale-x-100 text-yellow-400" />
            {t('Shared Subgraph Types')}
          </span>
        )
      }
      size="md"
      description={
        forking ? (
          <div className="subgraph-fork mt-2 flex flex-col gap-3">
            <p className="text-xs text-slate-400">
              {t(
                'The instances you choose move to a new type, and stop following "{name}". The ones you leave keep it.',
                { name: typeName },
              )}
            </p>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">{t('Name for the new type')}</span>
              <input
                type="text"
                autoFocus
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                value={forkName}
                data-swipe-nav-ignore
                onChange={(event) => setForkName(event.target.value)}
              />
            </label>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-400">
                {t('{count} of {total} instances selected', {
                  count: selected.size,
                  total: instances.length,
                })}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className="subgraph-fork-select-all rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
                  onClick={() => setSelected(new Set(instances.map((entry) => entry.nodeId)))}
                >
                  {t('Select all')}
                </button>
                <button
                  type="button"
                  className="subgraph-fork-clear rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
                  onClick={() => setSelected(new Set())}
                >
                  {t('Clear selection')}
                </button>
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              {instances.map((entry) => (
                <SubgraphInstanceEntry
                  key={entry.nodeId}
                  label={entry.label}
                  parents={entry.parents}
                  surfaceColor={entry.surfaceColor}
                  borderColor={entry.borderColor}
                  selected={selected.has(entry.nodeId)}
                  className="subgraph-fork-instance"
                  onClick={() => toggle(entry.nodeId)}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="subgraph-type-info mt-2 flex flex-col gap-2 text-sm text-slate-300">
            <p>
              <strong><em>{typeName}</em></strong>
              {t(' is a shared subgraph type. Its ')}
              <strong>{t('{count} instances', { count: instances.length })}</strong>
              {t(
                ' are not copies — they are the same subgraph placed {count} times, so the nodes inside it are one set of nodes.',
                { count: instances.length },
              )}
            </p>
            <p>
              {t(
                'Editing anything in here — a node, a value, the boundary slots — changes it for every instance at once. What each instance keeps to itself is its own name, its position, whether it is bypassed, and the connections you make to its input/output slots.',
              )}
            </p>
            <p>
              {t(
                'To change one instance without affecting the others, fork it: the instances you pick move to a new type of their own, free to diverge from here on.',
              )}
            </p>
          </div>
        )
      }
      actions={
        forking
          ? [
              { label: t('Back'), onClick: () => setForking(false), variant: 'secondary' },
              {
                label: (
                  <span className="flex items-center gap-1.5">
                    <ForkIcon className="h-4 w-4" />
                    {t('Fork subgraph')}
                  </span>
                ),
                onClick: handleFork,
                variant: 'primary',
                disabled: selected.size === 0,
                className: 'bg-yellow-400 hover:bg-yellow-300 disabled:hover:bg-yellow-400',
              },
            ]
          : [
              { label: t('Cancel'), onClick: onClose, variant: 'secondary' },
              {
                label: (
                  <span className="flex items-center gap-1.5">
                    <ForkIcon className="h-4 w-4" />
                    {t('Fork subgraph')}
                  </span>
                ),
                onClick: () => setForking(true),
                variant: 'primary',
                className: 'bg-yellow-400 hover:bg-yellow-300 disabled:hover:bg-yellow-400',
              },
            ]
      }
    />
  );
}

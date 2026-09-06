import { useMemo, useRef, useState } from 'react';
import type { WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { collectSubgraphInstances } from '@/utils/boundarySlotLabels';
import { getInstanceNumber } from '@/utils/canonicalWorkflowOps';
import { interpolateInstanceLabel } from '@/utils/subgraphInstanceLabels';
import { findWorkflowNodeInScope } from '@/utils/subgraphPlaceholderLabels';
import { SubgraphInstancePicker } from './SubgraphInstancePicker';
import { SubgraphTypeInfoModal } from '@/components/modals/SubgraphTypeInfoModal';
import {
  ArrowRightIcon,
  ChevronDownIcon,
  EditIcon,
  ForkIcon,
  WarningTriangleIcon,
  WorkflowIcon,
} from '@/components/icons';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useI18n } from '@/i18n';

interface SubgraphScopeHeaderProps {
  subgraphId: string;
}

/**
 * Names the scope the user is standing in: which subgraph TYPE, and which of
 * its instances the boundary is being read through.
 *
 * The two are deliberately separate lines, because they are separate things to
 * edit — the type's name is shared by every instance, while the instance's name
 * belongs to one placeholder — and conflating them is the confusion this header
 * exists to prevent.
 */
export function SubgraphScopeHeader({ subgraphId }: SubgraphScopeHeaderProps) {
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
  const workflow = useWorkflowStore((s) => s.workflow);
  const scopeStack = useWorkflowStore((s) => s.scopeStack);
  const renameSubgraphType = useWorkflowStore((s) => s.renameSubgraphType);
  const updateNodeTitle = useWorkflowStore((s) => s.updateNodeTitle);
  const setScopeInstance = useWorkflowStore((s) => s.setScopeInstance);
  const exitSubgraph = useWorkflowStore((s) => s.exitSubgraph);

  const [editingType, setEditingType] = useState<string | null>(null);
  const [editingInstance, setEditingInstance] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  // The list hangs under the whole subtitle, not under the name that opens it.
  const subtitleRef = useRef<HTMLDivElement>(null);

  const def = useMemo(
    () => workflow?.definitions?.subgraphs?.find((sg) => sg.id === subgraphId) ?? null,
    [workflow, subgraphId],
  );

  const currentInstance = useMemo<WorkflowNode | null>(() => {
    const top = scopeStack[scopeStack.length - 1];
    if (top?.type !== 'subgraph') return null;
    const parentFrame = scopeStack[scopeStack.length - 2];
    const parentSubgraphId = parentFrame?.type === 'subgraph' ? parentFrame.id : null;
    return findWorkflowNodeInScope(workflow, top.placeholderNodeId, parentSubgraphId);
  }, [scopeStack, workflow]);

  const instances = useMemo(
    () => collectSubgraphInstances(workflow, subgraphId).map(({ node }) => node),
    [workflow, subgraphId],
  );

  if (!def) return null;

  // The type's name verbatim, `{n}` and all: this line names the template, and
  // hiding the token would hide the thing the edit button is about to edit.
  const typeName = def.name ?? subgraphId.slice(0, 8);
  const instanceNumber = currentInstance ? getInstanceNumber(currentInstance) : undefined;
  const instanceTitle =
    typeof currentInstance?.title === 'string' ? currentInstance.title.trim() : '';
  // What this instance is actually called: its own name if it has one, else the
  // type's name with `{n}` resolved for it. The title line shows the template
  // because that is what its pencil edits; this line shows the result, because
  // this is the instance.
  const instanceDisplayName =
    instanceTitle || interpolateInstanceLabel(typeName, instanceNumber) || typeName;

  const commitTypeName = (value: string) => {
    setEditingType(null);
    renameSubgraphType(subgraphId, value);
  };
  const commitInstanceName = (value: string) => {
    setEditingInstance(null);
    if (!currentInstance?.itemKey) return;
    // Blank clears the override, so the instance falls back to the type's name.
    updateNodeTitle(currentInstance.itemKey, value.trim() || null);
  };

  return (
    <div className="subgraph-scope-header relative mb-3 flex flex-col items-center gap-1 px-1">
      {/* Pinned to the row's left edge rather than sitting in the flow, so the
          title stays centred on the column instead of being pushed off it.
          Desktop has the gutter for this, where the button stays put as the
          list scrolls; here it would scroll away with the header. */}
      {!isDesktop && (
        <button
          type="button"
          className="subgraph-exit absolute left-1 top-0 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-slate-900 text-slate-300 shadow-sm hover:bg-white/5"
          aria-label={t('Exit subgraph')}
          onClick={() => exitSubgraph()}
        >
          {/* The entering arrow, reversed: the same journey the other way. */}
          <ArrowRightIcon
            className="w-4 h-4 rotate-180"
            style={{position: "relative", left: "3px"}}
          />
        </button>
      )}
      {/* One line where there is width for it, two where there is not: the
          subtitle qualifies the title, so keeping them together reads as one
          statement rather than two. */}
      <div
        // Padded both sides by the exit button's width, so centring the title
        // on the row centres it on the column too.
        className={`subgraph-scope-heading flex w-full min-w-0 items-center justify-center ${
          // Padded past the exit button only where the button is in this row.
          isDesktop ? 'flex-row gap-3' : 'flex-col gap-1 px-10'
        }`}
      >
      <div className="subgraph-scope-title flex min-w-0 items-center justify-center gap-1.5">
        {editingType !== null ? (
          <InlineNameInput
            value={editingType}
            onChange={setEditingType}
            onCommit={commitTypeName}
            onCancel={() => setEditingType(null)}
            ariaLabel={t('Subgraph name')}
          />
        ) : (
          <>
            <WorkflowIcon className="w-4 h-4 shrink-0 -scale-x-100 text-cyan-300" />
            <h2 className="min-w-0 break-words text-center text-sm font-semibold text-slate-100">
              {t('Subgraph {name}', { name: typeName })}
            </h2>
            <button
              type="button"
              className="subgraph-rename-type shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-200"
              aria-label={t('Rename subgraph type')}
              onClick={() => setEditingType(typeName)}
            >
              <EditIcon className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {currentInstance && (
        <div
          ref={subtitleRef}
          className="subgraph-scope-subtitle flex min-w-0 items-center justify-center gap-1.5 text-xs text-slate-400"
        >
          <span className="shrink-0">
            {instanceNumber != null
              ? t('Instance #{number}', { number: instanceNumber })
              : t('Instance #{id}', { id: currentInstance.id })}
          </span>
          {editingInstance !== null ? (
            <InlineNameInput
              value={editingInstance}
              onChange={setEditingInstance}
              onCommit={commitInstanceName}
              onCancel={() => setEditingInstance(null)}
              ariaLabel={t('Instance name')}
            />
          ) : (
            <>
              <SubgraphInstancePicker
                instances={instances}
                currentInstanceId={currentInstance.id}
                onSelect={setScopeInstance}
                anchorRef={subtitleRef}
                renderTrigger={({ ref, onClick, isOpen }) => (
                  <button
                    ref={ref}
                    type="button"
                    aria-label={t('Subgraph instance')}
                    aria-expanded={isOpen}
                    // The instance's name is itself the way to reach the others:
                    // the thing you want to change is the thing you press.
                    className="subgraph-instance-trigger flex min-w-0 items-center gap-1 rounded px-1 text-slate-200 hover:bg-white/10"
                    onClick={onClick}
                  >
                    <span className="truncate">{instanceDisplayName}</span>
                    <ChevronDownIcon className="w-3 h-3 shrink-0 text-slate-400" />
                  </button>
                )}
              />
              <button
                type="button"
                className="subgraph-rename-instance shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-200"
                aria-label={t('Rename this instance')}
                onClick={() => setEditingInstance(instanceTitle)}
              >
                <EditIcon className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      )}
      </div>

      {instances.length > 1 && (
        // Capped rather than full-bleed: on a desktop-width panel a banner
        // spanning the whole column reads as a page-level alert, when it is a
        // note about the thing directly beneath it.
        <div className="subgraph-shared-notice mt-0.5 flex w-full max-w-md items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
          <WarningTriangleIcon className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          <span className="min-w-0 flex-1">
            {t('Edits here affect all {count} instances', { count: instances.length })}
          </span>
          {/* Right-aligned, at the far edge: the banner states the problem and
              this is the way out of it, so it reads as the answer to the line
              it sits beside. */}
          <button
            type="button"
            className="subgraph-type-info ml-auto flex shrink-0 items-center gap-1 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-amber-100 hover:bg-amber-400/20"
            aria-label={t('About subgraph types and instances')}
            onClick={() => setInfoOpen(true)}
          >
            <ForkIcon className="w-3.5 h-3.5" />
            {t('Fork subgraph')}
          </button>
        </div>
      )}

      {infoOpen && (
        <SubgraphTypeInfoModal subgraphId={subgraphId} onClose={() => setInfoOpen(false)} />
      )}
    </div>
  );
}

/** Inline rename field, committing on Enter or blur and abandoning on Escape. */
function InlineNameInput({
  value,
  onChange,
  onCommit,
  onCancel,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="text"
      autoFocus
      aria-label={ariaLabel}
      className="min-w-0 flex-1 rounded border border-white/10 bg-slate-950/80 px-2 py-0.5 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
      value={value}
      data-swipe-nav-ignore
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => onCommit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

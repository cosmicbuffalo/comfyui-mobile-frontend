import { useEffect, useMemo, useState } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import {
  SUBGRAPH_INPUT_NODE_ID,
  SUBGRAPH_OUTPUT_NODE_ID,
} from '@/utils/canonicalWorkflowOps';
import { areTypesCompatible } from '@/utils/connectionUtils';
import { resolveWorkflowNodeDisplayName } from '@/utils/subgraphPlaceholderLabels';
import { CheckIcon } from '@/components/icons';
import { SearchActionModal } from './SearchActionModal';
import { FullscreenModalActions } from './FullscreenModalActions';
import { useI18n } from '@/i18n';

interface BoundaryConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 'input' = which inner inputs this subgraph input feeds (multi-select);
   *  'output' = which inner output feeds this subgraph output (single-select). */
  direction: 'input' | 'output';
  slotIndex: number;
  slotName: string;
  slotType: string;
}

interface BoundaryCandidate {
  nodeId: number;
  nodeKey: string;
  slot: number;
  selectionKey: string;
  displayName: string;
  slotLabel: string;
}

function candidateKey(nodeId: number, slot: number): string {
  return `${nodeId}:${slot}`;
}

/**
 * Picker for one subgraph boundary slot's connections, shown from the
 * Inputs/Outputs pseudo-cards inside a subgraph scope. Apply commits through
 * the boundary store actions, which keep the definition's linkIds caches
 * fresh. Only usable inside a subgraph scope.
 */
export function BoundaryConnectionModal({
  isOpen,
  onClose,
  direction,
  slotIndex,
  slotName,
  slotType,
}: BoundaryConnectionModalProps) {
  const { t } = useI18n();
  const workflow = useWorkflowStore((s) => s.workflow);
  const scopeStack = useWorkflowStore((s) => s.scopeStack);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const connectBoundaryInput = useWorkflowStore((s) => s.connectBoundaryInput);
  const connectBoundaryOutput = useWorkflowStore((s) => s.connectBoundaryOutput);
  const removeBoundarySlot = useWorkflowStore((s) => s.removeBoundarySlot);

  const topScopeFrame = scopeStack[scopeStack.length - 1];
  const currentSubgraphId = topScopeFrame?.type === 'subgraph' ? topScopeFrame.id : null;
  const def = useMemo(
    () =>
      workflow?.definitions?.subgraphs?.find((sg) => sg.id === currentSubgraphId) ?? null,
    [workflow, currentSubgraphId],
  );

  const [searchQuery, setSearchQuery] = useState('');

  // Current fan-out for this boundary slot, straight from the boundary links.
  const initialSelection = useMemo(() => {
    const selected = new Set<string>();
    for (const link of def?.links ?? []) {
      if (direction === 'input') {
        if (link.origin_id === SUBGRAPH_INPUT_NODE_ID && link.origin_slot === slotIndex) {
          selected.add(candidateKey(link.target_id, link.target_slot));
        }
      } else if (link.target_id === SUBGRAPH_OUTPUT_NODE_ID && link.target_slot === slotIndex) {
        selected.add(candidateKey(link.origin_id, link.origin_slot));
      }
    }
    return selected;
  }, [def, direction, slotIndex]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(initialSelection);

  const candidates = useMemo<BoundaryCandidate[]>(() => {
    if (!workflow || !def) return [];
    const results: BoundaryCandidate[] = [];
    for (const node of def.nodes ?? []) {
      if (node.mode === 4) continue; // bypassed
      if (!node.itemKey) continue;
      const displayName = resolveWorkflowNodeDisplayName(workflow, node, nodeTypes);
      const slots = direction === 'input' ? node.inputs ?? [] : node.outputs ?? [];
      slots.forEach((slot, index) => {
        if (!areTypesCompatible(slot.type, slotType)) return;
        results.push({
          nodeId: node.id,
          nodeKey: node.itemKey as string,
          slot: index,
          selectionKey: candidateKey(node.id, index),
          displayName,
          slotLabel: slot.label || slot.localized_name || slot.name || `#${index}`,
        });
      });
    }
    return results;
  }, [workflow, def, nodeTypes, direction, slotType]);

  const visibleCandidates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return candidates;
    return candidates.filter(
      (candidate) =>
        candidate.displayName.toLowerCase().includes(query) ||
        candidate.slotLabel.toLowerCase().includes(query),
    );
  }, [candidates, searchQuery]);

  const hasChanges = useMemo(() => {
    if (selectedKeys.size !== initialSelection.size) return true;
    for (const key of selectedKeys) {
      if (!initialSelection.has(key)) return true;
    }
    return false;
  }, [selectedKeys, initialSelection]);

  const toggleCandidate = (candidate: BoundaryCandidate) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(candidate.selectionKey)) {
        next.delete(candidate.selectionKey);
      } else {
        if (direction === 'output') next.clear(); // single feeder per output slot
        next.add(candidate.selectionKey);
      }
      return next;
    });
  };

  const handleApply = () => {
    const chosen = candidates.filter((candidate) => selectedKeys.has(candidate.selectionKey));
    if (direction === 'input') {
      connectBoundaryInput(
        slotIndex,
        chosen.map((candidate) => ({ nodeKey: candidate.nodeKey, inputSlot: candidate.slot })),
      );
    } else {
      const source = chosen[0] ?? null;
      connectBoundaryOutput(
        slotIndex,
        source ? { nodeKey: source.nodeKey, outputSlot: source.slot } : null,
      );
    }
    onClose();
  };

  // Escape closes the picker, matching the node card's connection menu. The key
  // is marked handled so the panel underneath doesn't also act on it — its
  // select-mode exit skips an already-handled Escape.
  useEffect(() => {
    if (!isOpen || currentSubgraphId == null) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, currentSubgraphId, onClose]);

  if (!isOpen || currentSubgraphId == null) return null;

  return (
    <SearchActionModal
      isOpen={isOpen}
      onClose={onClose}
      title={
        direction === 'input'
          ? t('Subgraph input: {name}', { name: slotName })
          : t('Subgraph output: {name}', { name: slotName })
      }
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchPlaceholder={t('Search nodes...')}
      footer={
        <FullscreenModalActions
          actions={[
            { key: 'cancel', label: t('Cancel'), onClick: onClose },
            {
              key: 'remove',
              // Demoting is the other thing you come to a boundary slot to do,
              // and there is nowhere else to reach it from.
              label: t('Remove slot'),
              onClick: () => {
                removeBoundarySlot(direction, slotIndex);
                onClose();
              },
              variant: 'danger',
            },
            {
              key: 'apply',
              label: t('Apply'),
              onClick: handleApply,
              variant: 'primary',
              disabled: !hasChanges,
            },
          ]}
        />
      }
    >
      <div className="boundary-connection-list flex-1 overflow-y-auto px-4 py-3 pb-24">
        <div className="mx-auto w-full max-w-3xl flex flex-col gap-2">
          <div className="text-xs text-slate-400">
            {direction === 'input'
              ? t('Choose which inputs this subgraph input feeds.')
              : t('Choose which output feeds this subgraph output.')}
          </div>
          {visibleCandidates.length === 0 && (
            <div className="boundary-empty-state px-4 py-8 text-center text-sm text-slate-400">
              {t('No compatible {type} slots found in this subgraph.', { type: slotType })}
            </div>
          )}
          {visibleCandidates.map((candidate) => {
            const selected = selectedKeys.has(candidate.selectionKey);
            return (
              <button
                key={candidate.selectionKey}
                type="button"
                className={`boundary-candidate-row w-full flex items-center justify-between text-left px-3 py-2 rounded-lg border ${
                  selected
                    ? 'bg-cyan-500/15 border-cyan-400/40'
                    : 'bg-slate-900/95 border-white/10 hover:bg-white/5'
                }`}
                onClick={() => toggleCandidate(candidate)}
              >
                <span className="min-w-0">
                  <span className="block text-sm text-slate-100 truncate">
                    {candidate.displayName}
                  </span>
                  <span className="block text-xs text-slate-400 truncate">
                    {candidate.slotLabel} · {slotType}
                  </span>
                </span>
                {selected && <CheckIcon className="w-4 h-4 text-cyan-300 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </SearchActionModal>
  );
}

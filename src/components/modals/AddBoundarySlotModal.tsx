import { useMemo, useState } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import {
  SUBGRAPH_INPUT_NODE_ID,
  SUBGRAPH_OUTPUT_NODE_ID,
} from '@/utils/canonicalWorkflowOps';
import { resolveWorkflowNodeDisplayName } from '@/utils/subgraphPlaceholderLabels';
import { SearchActionModal } from './SearchActionModal';
import { useI18n } from '@/i18n';

interface AddBoundarySlotModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Which side of the boundary the new slot is added to. */
  direction: 'input' | 'output';
  subgraphId: string;
}

interface SlotCandidate {
  nodeKey: string;
  nodeId: number;
  slotIndex: number;
  displayName: string;
  slotLabel: string;
  slotType: string;
  isWidget: boolean;
}

/**
 * Picker of inner slots that could become a new boundary slot — the promotable
 * ones only, so choosing from it is never destructive:
 *
 * - inputs: those not already promoted AND not fed from inside the subgraph.
 *   A boundary slot and a local link cannot both drive one input, so offering a
 *   wired input here would mean silently cutting its inner link.
 * - outputs: those not already promoted. An output may feed the boundary and
 *   inner consumers at once, so nothing is displaced either way.
 */
export function AddBoundarySlotModal({
  isOpen,
  onClose,
  direction,
  subgraphId,
}: AddBoundarySlotModalProps) {
  const { t } = useI18n();
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const addBoundaryInput = useWorkflowStore((s) => s.addBoundaryInput);
  const addBoundaryOutput = useWorkflowStore((s) => s.addBoundaryOutput);

  const [searchQuery, setSearchQuery] = useState('');

  const def = useMemo(
    () => workflow?.definitions?.subgraphs?.find((sg) => sg.id === subgraphId) ?? null,
    [workflow, subgraphId],
  );

  const candidates = useMemo<SlotCandidate[]>(() => {
    if (!workflow || !def) return [];
    const links = def.links ?? [];
    const promoted = new Set<string>();
    for (const link of links) {
      if (direction === 'input' && link.origin_id === SUBGRAPH_INPUT_NODE_ID) {
        promoted.add(`${link.target_id}:${link.target_slot}`);
      } else if (direction === 'output' && link.target_id === SUBGRAPH_OUTPUT_NODE_ID) {
        promoted.add(`${link.origin_id}:${link.origin_slot}`);
      }
    }

    const results: SlotCandidate[] = [];
    for (const node of def.nodes ?? []) {
      if (!node.itemKey) continue;
      const displayName = resolveWorkflowNodeDisplayName(workflow, node, nodeTypes);
      const slots = direction === 'input' ? node.inputs ?? [] : node.outputs ?? [];
      slots.forEach((slot, slotIndex) => {
        if (promoted.has(`${node.id}:${slotIndex}`)) return;
        // An input already fed from inside is not open to promotion.
        if (direction === 'input' && (slot as { link?: number | null }).link != null) return;
        results.push({
          nodeKey: node.itemKey as string,
          nodeId: node.id,
          slotIndex,
          displayName,
          slotLabel: slot.label || slot.localized_name || slot.name || `#${slotIndex}`,
          slotType: String(slot.type ?? '*'),
          isWidget: direction === 'input' && (slot as { widget?: unknown }).widget != null,
        });
      });
    }
    return results;
  }, [workflow, def, nodeTypes, direction]);

  const visibleCandidates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return candidates;
    return candidates.filter(
      (candidate) =>
        candidate.displayName.toLowerCase().includes(query) ||
        candidate.slotLabel.toLowerCase().includes(query) ||
        candidate.slotType.toLowerCase().includes(query),
    );
  }, [candidates, searchQuery]);

  const choose = (candidate: SlotCandidate) => {
    if (direction === 'input') {
      addBoundaryInput({ nodeKey: candidate.nodeKey, inputSlot: candidate.slotIndex });
    } else {
      addBoundaryOutput({ nodeKey: candidate.nodeKey, outputSlot: candidate.slotIndex });
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <SearchActionModal
      isOpen={isOpen}
      onClose={onClose}
      title={direction === 'input' ? t('Add subgraph input') : t('Add subgraph output')}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchPlaceholder={t('Search nodes...')}
    >
      <div className="add-boundary-slot-list flex-1 overflow-y-auto px-4 py-3 pb-24">
        <div className="mx-auto w-full max-w-3xl flex flex-col gap-2">
          <div className="text-xs text-slate-400">
            {direction === 'input'
              ? t('Choose an input to expose on this subgraph.')
              : t('Choose an output to expose on this subgraph.')}
          </div>
          {visibleCandidates.length === 0 && (
            <div className="add-boundary-empty-state px-4 py-8 text-center text-sm text-slate-400">
              {direction === 'input'
                ? t('Every open input in this subgraph is already exposed.')
                : t('Every output in this subgraph is already exposed.')}
            </div>
          )}
          {visibleCandidates.map((candidate) => (
            <button
              key={`${candidate.nodeId}:${candidate.slotIndex}`}
              type="button"
              className="add-boundary-candidate-row w-full flex items-center justify-between text-left px-3 py-2 rounded-lg border bg-slate-900/95 border-white/10 hover:bg-white/5"
              onClick={() => choose(candidate)}
            >
              <span className="min-w-0">
                <span className="block text-sm text-slate-100 truncate">
                  {candidate.displayName}
                </span>
                <span className="block text-xs text-slate-400 truncate">
                  {candidate.slotLabel} · {candidate.slotType}
                </span>
              </span>
              {candidate.isWidget && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-fuchsia-300">
                  {t('Widget')}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </SearchActionModal>
  );
}

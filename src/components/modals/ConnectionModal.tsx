import { useMemo, useState } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import {
  findCompatibleSourceNodes,
  findCompatibleNodeTypesForInput,
  findCompatibleTargetNodesForOutput
} from '@/utils/connectionUtils';
import { CheckIcon, PlusIcon } from '@/components/icons';
import {
  fuzzyMatch,
  getFieldScore,
  isSubsequence,
  normalizeSearchText,
  prettyPackName
} from '@/utils/search';
import { searchAndSortNodeTypes } from '@/utils/nodeTypeSearch';
import { ConnectionSearchResult } from './ConnectionModal/SearchResult';
import { SearchActionModal } from './SearchActionModal';
import { NodeTypeSearchResult } from './NodeTypeSearchResult';
import { SearchEmptyState } from './SearchEmptyState';
import { Dialog } from './Dialog';

interface ConnectionModalBaseProps {
  isOpen: boolean;
  onClose: () => void;
  nodeId: number;
}

interface InputConnectionModalProps extends ConnectionModalBaseProps {
  mode: 'input';
  inputIndex: number;
  inputType: string;
  inputName: string;
  currentlyConnectedNodeId: number | null;
}

interface OutputConnectionModalProps extends ConnectionModalBaseProps {
  mode: 'output';
  outputIndex: number;
  outputType: string;
  outputName: string;
}

type ConnectionModalProps = InputConnectionModalProps | OutputConnectionModalProps;

interface OutputCandidate {
  nodeId: number;
  inputIndex: number;
  displayName: string;
  pack: string;
  inputName: string;
  inputType: string;
  currentlyConnectedFromThisOutput: boolean;
  hasExistingLink: boolean;
  existingSourceLabel: string | null;
  score: number;
}

function makeOutputSelectionKey(nodeId: number, inputIndex: number): string {
  return `${nodeId}:${inputIndex}`;
}

function areKeySetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}

export function ConnectionModal(props: ConnectionModalProps) {
  const { isOpen, onClose, nodeId, mode } = props;
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const connectNodes = useWorkflowStore((s) => s.connectNodes);
  const disconnectInput = useWorkflowStore((s) => s.disconnectInput);
  const addNodeAndConnect = useWorkflowStore((s) => s.addNodeAndConnect);
  const scrollToNode = useWorkflowStore((s) => s.scrollToNode);

  const [searchQuery, setSearchQuery] = useState('');
  const [currentAction, setCurrentAction] = useState<'pick' | 'addNew'>('pick');
  const [selectedOutputTargetKeys, setSelectedOutputTargetKeys] = useState<Set<string>>(() => {
    if (mode !== 'output' || !workflow) return new Set<string>();
    const selected = new Set<string>();
    for (const link of workflow.links) {
      const [, srcNodeId, srcSlot, tgtNodeId, tgtSlot] = link;
      if (srcNodeId === nodeId && srcSlot === props.outputIndex) {
        selected.add(makeOutputSelectionKey(tgtNodeId, tgtSlot));
      }
    }
    return selected;
  });
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);

  const currentNodeStableKey = useMemo(() => {
    if (!workflow) return null;
    const node = workflow.nodes.find((entry) => entry.id === nodeId);
    return node?.stableKey ?? null;
  }, [nodeId, workflow]);

  const getStableKeyForNodeId = (targetNodeId: number): string | null => {
    if (!workflow) return null;
    const node = workflow.nodes.find((entry) => entry.id === targetNodeId);
    return node?.stableKey ?? null;
  };

  const compatibleNodes = useMemo(() => {
    if (mode !== 'input' || !workflow || !nodeTypes) return [];
    return findCompatibleSourceNodes(workflow, nodeTypes, nodeId, props.inputIndex);
  }, [mode, workflow, nodeTypes, nodeId, props]);

  const filteredNodes = useMemo(() => {
    if (mode !== 'input') return [];
    const query = searchQuery.trim();
    const scored = compatibleNodes
      .map((entry) => {
        const { node } = entry;
        const typeDef = nodeTypes?.[node.type];
        const title = (node as { title?: unknown }).title;
        const displayName = (typeof title === 'string' && title.trim())
          ? title.trim()
          : (typeDef?.display_name || node.type);
        const text = `${displayName} ${typeDef?.display_name ?? ''} ${node.type} ${String(node.id)}`;
        const matches = !query
          || fuzzyMatch(query, text)
          || isSubsequence(normalizeSearchText(query), normalizeSearchText(text));
        if (!matches) return null;
        const score =
          getFieldScore(query, displayName) * 4 +
          getFieldScore(query, typeDef?.display_name ?? '') * 3 +
          getFieldScore(query, node.type) * 2 +
          getFieldScore(query, String(node.id));
        return { ...entry, score };
      })
      .filter(Boolean) as Array<(typeof compatibleNodes)[number] & { score: number }>;
    scored.sort((a, b) => b.score - a.score || a.node.id - b.node.id);
    return scored;
  }, [mode, compatibleNodes, searchQuery, nodeTypes]);

  const compatibleTypes = useMemo(() => {
    if (mode !== 'input' || !nodeTypes) return [];
    return findCompatibleNodeTypesForInput(nodeTypes, props.inputType).map((item, index) => ({ ...item, index }));
  }, [mode, nodeTypes, props]);

  const filteredTypes = useMemo(() => {
    if (mode !== 'input') return [];
    return searchAndSortNodeTypes(
      compatibleTypes,
      searchQuery,
      (item) => {
        const displayName = String(item.def.display_name ?? item.def.name ?? item.typeName ?? '');
        const typeName = String(item.def.name ?? item.typeName ?? '');
        const pack = prettyPackName(item.def.python_module || (item.def.category?.split('/')[0] || 'Core'));
        return {
          displayName,
          typeName,
          category: String(item.def.category ?? ''),
          pack
        };
      },
      (item) => item.index
    );
  }, [mode, compatibleTypes, searchQuery]);

  const outputCandidates = useMemo<OutputCandidate[]>(() => {
    if (mode !== 'output' || !workflow || !nodeTypes) return [];
    const compatibleTargets = findCompatibleTargetNodesForOutput(workflow, nodeId, props.outputIndex);
    const connectedKeys = new Set<string>();
    for (const link of workflow.links) {
      const [, srcNodeId, srcSlot, tgtNodeId, tgtSlot] = link;
      if (srcNodeId === nodeId && srcSlot === props.outputIndex) {
        connectedKeys.add(makeOutputSelectionKey(tgtNodeId, tgtSlot));
      }
    }
    const query = searchQuery.trim();

    const candidates = compatibleTargets
      .map(({ node, inputIndex }) => {
        const typeDef = nodeTypes[node.type];
        const title = (node as { title?: unknown }).title;
        const displayName = (typeof title === 'string' && title.trim())
          ? title.trim()
          : (typeDef?.display_name || node.type);
        const pack = prettyPackName(String(typeDef?.python_module ?? typeDef?.category?.split('/')[0] ?? 'Core'));
        const inputSlot = node.inputs?.[inputIndex];
        if (!inputSlot) return null;
        const inputName = inputSlot.localized_name || inputSlot.name || `Input ${inputIndex + 1}`;
        const inputType = String(inputSlot.type);
        const selectionKey = makeOutputSelectionKey(node.id, inputIndex);
        const currentlyConnectedFromThisOutput = connectedKeys.has(selectionKey);
        let hasExistingLink = false;
        let existingSourceLabel: string | null = null;
        const existingLinkId = inputSlot.link;
        if (existingLinkId != null && !currentlyConnectedFromThisOutput) {
          const existingLink = workflow.links.find((link) => link[0] === existingLinkId);
          if (existingLink) {
            hasExistingLink = true;
            const [, existingSrcNodeId] = existingLink;
            const existingSrcNode = workflow.nodes.find((n) => n.id === existingSrcNodeId);
            if (existingSrcNode) {
              const existingTypeDef = nodeTypes[existingSrcNode.type];
              existingSourceLabel = `${existingTypeDef?.display_name || existingSrcNode.type} #${existingSrcNode.id}`;
            }
          }
        }
        const text = `${displayName} ${typeDef?.display_name ?? ''} ${node.type} ${String(node.id)} ${inputName}`;
        const matches = !query
          || fuzzyMatch(query, text)
          || isSubsequence(normalizeSearchText(query), normalizeSearchText(text));
        if (!matches) return null;
        const score =
          getFieldScore(query, displayName) * 4 +
          getFieldScore(query, inputName) * 3 +
          getFieldScore(query, typeDef?.display_name ?? '') * 2 +
          getFieldScore(query, node.type) * 2 +
          getFieldScore(query, String(node.id));

        return {
          nodeId: node.id,
          inputIndex,
          displayName,
          pack,
          inputName,
          inputType,
          currentlyConnectedFromThisOutput,
          hasExistingLink,
          existingSourceLabel,
          score
        };
      });
    const filtered = candidates.filter((candidate): candidate is OutputCandidate => candidate !== null);
    filtered.sort((a, b) => b.score - a.score || a.nodeId - b.nodeId);
    return filtered;
  }, [mode, workflow, nodeTypes, nodeId, props, searchQuery]);

  const initialOutputSelection = useMemo(() => {
    if (mode !== 'output') return new Set<string>();
    return new Set(
      outputCandidates
        .filter((candidate) => candidate.currentlyConnectedFromThisOutput)
        .map((candidate) => makeOutputSelectionKey(candidate.nodeId, candidate.inputIndex))
    );
  }, [mode, outputCandidates]);

  const outputCandidatesByKey = useMemo(() => {
    const map = new Map<string, OutputCandidate>();
    for (const candidate of outputCandidates) {
      map.set(makeOutputSelectionKey(candidate.nodeId, candidate.inputIndex), candidate);
    }
    return map;
  }, [outputCandidates]);

  const outputSelectionHasChanges = useMemo(() => {
    if (mode !== 'output') return false;
    return !areKeySetsEqual(selectedOutputTargetKeys, initialOutputSelection);
  }, [mode, selectedOutputTargetKeys, initialOutputSelection]);

  const outputOverwriteCandidates = useMemo(() => {
    if (mode !== 'output') return [];
    const candidates: OutputCandidate[] = [];
    for (const key of selectedOutputTargetKeys) {
      if (initialOutputSelection.has(key)) continue;
      const candidate = outputCandidatesByKey.get(key);
      if (candidate?.hasExistingLink) candidates.push(candidate);
    }
    return candidates;
  }, [mode, selectedOutputTargetKeys, initialOutputSelection, outputCandidatesByKey]);

  const handleSelectNode = (srcNodeId: number, srcOutputIndex: number) => {
    if (mode !== 'input') return;
    const srcStableKey = getStableKeyForNodeId(srcNodeId);
    if (!srcStableKey || !currentNodeStableKey) return;
    connectNodes(srcStableKey, srcOutputIndex, currentNodeStableKey, props.inputIndex, props.inputType);
    onClose();
    scrollToNode(srcStableKey);
  };

  const handleDisconnect = () => {
    if (mode !== 'input') return;
    if (!currentNodeStableKey) return;
    disconnectInput(currentNodeStableKey, props.inputIndex);
    onClose();
  };

  const handleAddNewNode = (typeName: string) => {
    if (mode !== 'input') return;
    if (!currentNodeStableKey) return;
    const newNodeId = addNodeAndConnect(typeName, currentNodeStableKey, props.inputIndex);
    onClose();
    if (newNodeId !== null) {
      const newStableKey = getStableKeyForNodeId(newNodeId);
      if (newStableKey) {
        scrollToNode(newStableKey);
      }
    }
  };

  const toggleOutputTargetSelection = (nodeIdToToggle: number, inputIndexToToggle: number) => {
    const key = makeOutputSelectionKey(nodeIdToToggle, inputIndexToToggle);
    setSelectedOutputTargetKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const applyOutputSelection = () => {
    if (mode !== 'output') return;
    for (const key of initialOutputSelection) {
      if (selectedOutputTargetKeys.has(key)) continue;
      const candidate = outputCandidatesByKey.get(key);
      if (!candidate) continue;
      const targetStableKey = getStableKeyForNodeId(candidate.nodeId);
      if (!targetStableKey) continue;
      disconnectInput(targetStableKey, candidate.inputIndex);
    }
    for (const key of selectedOutputTargetKeys) {
      if (initialOutputSelection.has(key)) continue;
      const candidate = outputCandidatesByKey.get(key);
      if (!candidate) continue;
      const targetStableKey = getStableKeyForNodeId(candidate.nodeId);
      if (!targetStableKey || !currentNodeStableKey) continue;
      connectNodes(currentNodeStableKey, props.outputIndex, targetStableKey, candidate.inputIndex, candidate.inputType);
    }
    onClose();
  };

  const handleSubmitOutput = () => {
    if (mode !== 'output') return;
    if (outputOverwriteCandidates.length > 0) {
      setShowOverwriteConfirm(true);
      return;
    }
    applyOutputSelection();
  };

  const modalTitle = mode === 'input'
    ? (currentAction === 'pick' ? `Connect ${props.inputName}` : 'Add new node')
    : `Connect ${props.outputName}`;
  const searchPlaceholder = mode === 'input'
    ? (currentAction === 'pick' ? 'Search existing nodes...' : 'Search node types...')
    : 'Search target nodes...';

  const renderInputPickContent = () => {
    if (mode !== 'input') return null;
    const inputProps = props;
    return (
      <div className="px-3 pt-3 pb-20 flex flex-col gap-2">
        {filteredNodes.map(({ node, outputIndex }) => {
          const typeDef = nodeTypes?.[node.type];
          const title = (node as { title?: unknown }).title;
          const displayName = (typeof title === 'string' && title.trim())
            ? title.trim()
            : (typeDef?.display_name || node.type);
          const pack = prettyPackName(String(typeDef?.python_module ?? typeDef?.category?.split('/')[0] ?? 'Core'));
          const outputSlot = node.outputs?.[outputIndex];
          const outputName = outputSlot?.localized_name || outputSlot?.name || `Output ${outputIndex + 1}`;
          const outputType = String(outputSlot?.type ?? inputProps.inputType);
          const isConnected = node.id === inputProps.currentlyConnectedNodeId;
          return (
            <ConnectionSearchResult
              key={node.id}
              nodeId={node.id}
              displayName={displayName}
              pack={pack}
              outputName={outputName}
              outputType={outputType}
              inputName={inputProps.inputName}
              isConnected={isConnected}
              onSelect={() => handleSelectNode(node.id, outputIndex)}
            />
          );
        })}

        {filteredNodes.length === 0 && (
          <SearchEmptyState query={searchQuery} message="No matching nodes found" />
        )}

        <button
          type="button"
          className="w-full text-left rounded-xl bg-blue-50 px-4 py-3 flex items-center gap-3 hover:bg-blue-100 active:scale-[0.998] transition"
          onClick={() => { setCurrentAction('addNew'); setSearchQuery(''); }}
        >
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <PlusIcon className="w-4 h-4 text-blue-600" />
          </div>
          <span className="text-sm font-semibold text-blue-700">Add new node...</span>
        </button>

        {inputProps.currentlyConnectedNodeId !== null && (
          <button
            type="button"
            className="w-full text-left rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-100 active:scale-[0.998] transition"
            onClick={handleDisconnect}
          >
            Disconnect
          </button>
        )}
      </div>
    );
  };

  const renderInputAddNewContent = () => {
    if (mode !== 'input') return null;
    const inputProps = props;
    return (
      <div className="px-3 pt-3 pb-20 flex flex-col gap-2">
        {filteredTypes.length === 0 && (
          <SearchEmptyState query={searchQuery} message="No matching node types found" />
        )}
        {filteredTypes.map(({ typeName, def, outputIndex }) => {
          const pack = prettyPackName(String(def.python_module ?? def.category?.split('/')[0] ?? 'Core'));
          const outputType = String(def.output?.[outputIndex] ?? inputProps.inputType);
          const outputName = def.output_name?.[outputIndex] ?? def.output?.[outputIndex] ?? 'Output';
          return (
            <NodeTypeSearchResult
              key={typeName}
              title={String(def.display_name)}
              subtitle={pack || 'Core'}
              outputType={outputType}
              outputName={String(outputName)}
              inputName={inputProps.inputName}
              titleClassName="text-sm font-medium text-gray-900 truncate"
              onSelect={() => handleAddNewNode(typeName)}
            />
          );
        })}
      </div>
    );
  };

  const renderOutputSelectionContent = () => {
    if (mode !== 'output') return null;
    const outputProps = props;
    return (
      <div className="px-3 pt-3 pb-20 flex flex-col gap-2">
        {outputCandidates.map((candidate) => {
          const key = makeOutputSelectionKey(candidate.nodeId, candidate.inputIndex);
          const isSelected = selectedOutputTargetKeys.has(key);
          return (
            <button
              key={key}
              type="button"
              className={`w-full text-left rounded-xl border px-4 py-3 shadow-sm transition ${
                isSelected
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300 active:scale-[0.998]'
              }`}
              onClick={() => toggleOutputTargetSelection(candidate.nodeId, candidate.inputIndex)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-gray-900 flex items-center gap-2 min-w-0">
                    <span className="truncate">
                      {candidate.displayName} <span className="text-gray-400">#{candidate.nodeId}</span>
                    </span>
                    {candidate.currentlyConnectedFromThisOutput && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-medium shrink-0">
                        <CheckIcon className="w-3 h-3" />
                        Connected
                      </span>
                    )}
                    {candidate.hasExistingLink && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium shrink-0">
                        Already linked
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 truncate mt-0.5">{candidate.pack || 'Core'}</div>
                  <div className="text-xs text-gray-700 mt-1 truncate">
                    {outputProps.outputName} {'->'} {candidate.inputName}
                  </div>
                  {candidate.hasExistingLink && candidate.existingSourceLabel && (
                    <div className="text-xs text-amber-700 mt-1 truncate">
                      Currently from {candidate.existingSourceLabel}
                    </div>
                  )}
                </div>
                <div className={`w-5 h-5 rounded border flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}`}>
                  {isSelected && <CheckIcon className="w-3 h-3 text-white" />}
                </div>
              </div>
            </button>
          );
        })}

        {outputCandidates.length === 0 && (
          <SearchEmptyState query={searchQuery} message="No matching target nodes found" />
        )}
      </div>
    );
  };

  return (
    <SearchActionModal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchPlaceholder={searchPlaceholder}
      onBack={mode === 'input' && currentAction === 'addNew' ? () => { setCurrentAction('pick'); setSearchQuery(''); } : undefined}
      footer={mode === 'output' ? (
        <div className="flex-shrink-0 h-12 bg-white border-t border-gray-200 flex items-center justify-end gap-2 px-3">
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg text-sm text-gray-700 border border-gray-300 hover:bg-gray-50"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSubmitOutput}
            disabled={!outputSelectionHasChanges}
          >
            Apply
          </button>
        </div>
      ) : undefined}
    >
      <div className="flex-1 overflow-auto bg-white">
        {mode === 'input' ? (
          currentAction === 'pick' ? (
            renderInputPickContent()
          ) : (
            renderInputAddNewContent()
          )
        ) : (
          renderOutputSelectionContent()
        )}
      </div>

      {mode === 'output' && showOverwriteConfirm && (
        <Dialog
          onClose={() => setShowOverwriteConfirm(false)}
          title="Overwrite existing connections?"
          description="Some selected inputs are already connected. Continuing will disconnect their current source and reconnect to this output."
          actions={[
            {
              label: 'Cancel',
              onClick: () => setShowOverwriteConfirm(false),
              className: 'px-3 py-1.5 rounded-lg text-sm text-gray-700 border border-gray-300 hover:bg-gray-50'
            },
            {
              label: 'Overwrite',
              onClick: () => {
                setShowOverwriteConfirm(false);
                applyOutputSelection();
              },
              className: 'px-3 py-1.5 rounded-lg text-sm text-white bg-red-600 hover:bg-red-700'
            }
          ]}
        />
      )}
    </SearchActionModal>
  );
}

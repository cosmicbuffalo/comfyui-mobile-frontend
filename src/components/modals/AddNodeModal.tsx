import { useMemo, useState } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useConnectionSectionFoldsStore } from '@/hooks/useConnectionSectionFolds';
import { prettyPackName } from '@/utils/search';
import { resolveNodeTypeDisplayName, searchAndSortNodeTypes } from '@/utils/nodeTypeSearch';
import { NodeTypeSearchResult } from './NodeTypeSearchResult';
import { SearchActionModal } from './SearchActionModal';
import { SearchEmptyState } from './SearchEmptyState';

interface AddNodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  addInGroupId?: number | null;
  addInSubgraphId?: string | null;
  onNodeAdded?: (nodeId: number) => void;
}

export function AddNodeModal({ isOpen, onClose, addInGroupId = null, addInSubgraphId = null, onNodeAdded }: AddNodeModalProps) {
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const addNode = useWorkflowStore((s) => s.addNode);
  const scrollToNode = useWorkflowStore((s) => s.scrollToNode);
  const expandConnectionsSection = useConnectionSectionFoldsStore((s) => s.expand);
  const [searchQuery, setSearchQuery] = useState('');

  const allTypes = useMemo(() => {
    if (!nodeTypes) return [];
    return Object.entries(nodeTypes).map(([name, def], index) => ({
      index,
      name,
      displayName: resolveNodeTypeDisplayName(def, name),
      pack: prettyPackName(String(def.python_module ?? def.category?.split('/')[0] ?? 'Core')),
      category: String(def.category ?? 'Other'),
      description: String(def.description ?? '')
    }));
  }, [nodeTypes]);

  const filteredTypes = useMemo(() => {
    return searchAndSortNodeTypes(
      allTypes,
      searchQuery,
      (item) => ({
        displayName: item.displayName,
        typeName: item.name,
        category: item.category,
        pack: item.pack
      }),
      (item) => item.index
    );
  }, [allTypes, searchQuery]);

  const handleSelectType = (typeName: string) => {
    const options =
      addInGroupId == null && addInSubgraphId == null
        ? undefined
        : { ...(addInGroupId == null ? {} : { inGroupId: addInGroupId }), ...(addInSubgraphId == null ? {} : { inSubgraphId: addInSubgraphId }) };
    const newId = addNode(typeName, options);
    onClose();
    // Clear the search so the menu opens fresh next time.
    setSearchQuery('');
    if (newId !== null) {
      onNodeAdded?.(newId);
      const itemKey =
        useWorkflowStore.getState().workflow?.nodes.find((node) => node.id === newId)
          ?.itemKey ?? null;
      if (itemKey) {
        // A freshly added node opens with its connections section expanded so the
        // user can wire it up immediately.
        expandConnectionsSection(itemKey);
        scrollToNode(itemKey);
      }
    }
  };

  return (
    <SearchActionModal
      isOpen={isOpen}
      onClose={onClose}
      title="Add node"
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      searchPlaceholder="Search node types..."
    >
      <div className="flex-1 overflow-auto bg-slate-950/88">
        {filteredTypes.length === 0 && (
          <SearchEmptyState query={searchQuery} message="No matching node types found" />
        )}
        <div className="px-3 pt-3 pb-20 flex flex-col gap-2">
          {filteredTypes.map((item) => (
            <NodeTypeSearchResult
              key={item.name}
              title={item.displayName}
              subtitle={item.pack || 'Core'}
              onSelect={() => handleSelectType(item.name)}
            />
          ))}
        </div>
      </div>
    </SearchActionModal>
  );
}

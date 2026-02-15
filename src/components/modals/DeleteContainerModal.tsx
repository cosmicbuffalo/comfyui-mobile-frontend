import { createPortal } from 'react-dom';
import { Dialog } from './Dialog';

interface DeleteContainerModalProps {
  containerTypeLabel: 'group' | 'subgraph';
  containerIdLabel: string;
  displayName: string;
  nodeCount: number;
  onCancel: () => void;
  onDeleteContainerOnly: () => void;
  onDeleteContainerAndNodes: () => void;
}

export function DeleteContainerModal({
  containerTypeLabel,
  containerIdLabel,
  displayName,
  nodeCount,
  onCancel,
  onDeleteContainerOnly,
  onDeleteContainerAndNodes
}: DeleteContainerModalProps) {
  const typeText = containerTypeLabel;
  return createPortal(
    <Dialog
      onClose={onCancel}
      title={`Delete ${typeText}`}
      description={
        <>
          <span className="font-medium text-gray-700">{displayName}</span> ({containerIdLabel}) has {nodeCount} node{nodeCount === 1 ? '' : 's'}.
        </>
      }
      actionsLayout="stack"
      actions={[
        {
          label: `Delete ${typeText} only`,
          onClick: onDeleteContainerOnly,
          className: 'w-full px-4 py-2.5 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 active:bg-red-200'
        },
        {
          label: `Delete ${typeText} and nodes`,
          onClick: onDeleteContainerAndNodes,
          className: 'w-full px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 active:bg-red-800'
        },
        {
          label: 'Cancel',
          onClick: onCancel,
          className: 'w-full px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 active:bg-gray-300'
        }
      ]}
    />,
    document.body
  );
}

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
          <span className="font-medium text-slate-100">{displayName}</span> ({containerIdLabel}) has {nodeCount} node{nodeCount === 1 ? '' : 's'}.
        </>
      }
      actionsLayout="stack"
      actions={[
        {
          label: `Delete ${typeText} only`,
          onClick: onDeleteContainerOnly,
          variant: 'danger',
          className: 'w-full bg-red-500/15 text-red-300 hover:bg-red-500/20'
        },
        {
          label: `Delete ${typeText} and nodes`,
          onClick: onDeleteContainerAndNodes,
          variant: 'danger',
          className: 'w-full'
        },
        {
          label: 'Cancel',
          onClick: onCancel,
          variant: 'secondary',
          className: 'w-full'
        }
      ]}
    />,
    document.body
  );
}

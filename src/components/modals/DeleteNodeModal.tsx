import { createPortal } from 'react-dom';
import { Dialog } from './Dialog';

interface DeleteNodeModalProps {
  nodeId: number;
  displayName: string;
  hasConnections: boolean;
  onCancel: () => void;
  onDelete: (reconnect: boolean) => void;
}

export function DeleteNodeModal({
  nodeId,
  displayName,
  hasConnections,
  onCancel,
  onDelete
}: DeleteNodeModalProps) {
  type ActionItem = {
    label: string;
    onClick: () => void;
    className?: string;
    variant?: 'secondary' | 'danger' | 'primary';
  };
  const actions: ActionItem[] = [];
  if (hasConnections) {
    actions.push({
      label: 'Delete & Reconnect',
      onClick: () => onDelete(true),
      variant: 'danger'
    });
  }
  actions.push(
    {
      label: hasConnections ? 'Delete & Disconnect' : 'Delete',
      onClick: () => onDelete(false),
      variant: 'danger',
      className: hasConnections ? 'bg-red-500/15 text-red-300 hover:bg-red-500/20' : undefined
    },
    {
      label: 'Cancel',
      onClick: onCancel,
      variant: 'secondary',
      className: 'w-full'
    }
  );

  return createPortal(
    <Dialog
      onClose={onCancel}
      title="Delete node"
      description={
        <>
          Delete <span className="font-medium text-slate-100">{displayName}</span> (#{nodeId})?
        </>
      }
      actionsLayout="stack"
      actions={actions}
    />,
    document.body
  );
}

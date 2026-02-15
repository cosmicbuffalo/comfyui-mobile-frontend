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
    className: string;
  };
  const actions = [
    hasConnections
      ? {
          label: 'Delete & Reconnect',
          onClick: () => onDelete(true),
          className: 'w-full px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 active:bg-red-800'
        }
      : null,
    {
      label: hasConnections ? 'Delete & Disconnect' : 'Delete',
      onClick: () => onDelete(false),
      className: hasConnections
        ? 'w-full px-4 py-2.5 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 active:bg-red-200'
        : 'w-full px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 active:bg-red-800'
    },
    {
      label: 'Cancel',
      onClick: onCancel,
      className: 'w-full px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 active:bg-gray-300'
    }
  ].filter((action): action is ActionItem => action !== null);

  return createPortal(
    <Dialog
      onClose={onCancel}
      title="Delete node"
      description={
        <>
          Delete <span className="font-medium text-gray-700">{displayName}</span> (#{nodeId})?
        </>
      }
      actionsLayout="stack"
      actions={actions}
    />,
    document.body
  );
}

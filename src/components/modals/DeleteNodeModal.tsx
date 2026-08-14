import { createPortal } from 'react-dom';
import { Dialog } from './Dialog';
import { useI18n } from '@/i18n';

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
  const { t } = useI18n();
  type ActionItem = {
    label: string;
    onClick: () => void;
    className?: string;
    variant?: 'secondary' | 'danger' | 'primary';
  };
  const actions: ActionItem[] = [];
  if (hasConnections) {
    actions.push({
      label: t('Delete & Reconnect'),
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
      label: t('Cancel'),
      onClick: onCancel,
      variant: 'secondary',
      className: 'w-full'
    }
  );

  return createPortal(
    <Dialog
      onClose={onCancel}
      title={t('Delete node')}
      description={
        <>
          {t('Delete {name} (#{id})?', { name: displayName, id: nodeId })}
        </>
      }
      actionsLayout="stack"
      actions={actions}
    />,
    document.body
  );
}

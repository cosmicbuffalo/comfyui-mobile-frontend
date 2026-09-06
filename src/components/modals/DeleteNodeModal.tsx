import { createPortal } from 'react-dom';
import { Dialog } from './Dialog';
import { useI18n } from '@/i18n';

interface DeleteNodeModalProps {
  nodeId: number;
  displayName: string;
  hasConnections: boolean;
  /**
   * Whether deleting with reconnect would bridge anything. When it wouldn't,
   * the two delete buttons would do exactly the same thing, so only one is
   * offered.
   */
  canReconnect: boolean;
  onCancel: () => void;
  onDelete: (reconnect: boolean) => void;
}

export function DeleteNodeModal({
  nodeId,
  displayName,
  hasConnections,
  canReconnect,
  onCancel,
  onDelete
}: DeleteNodeModalProps) {
  const { t } = useI18n();
  type ActionItem = {
    label: string;
    onClick: () => void;
    className?: string;
    variant?: 'secondary' | 'danger' | 'primary';
    autoFocus?: boolean;
  };
  const actions: ActionItem[] = [];
  if (canReconnect) {
    actions.push({
      label: t('Delete & Reconnect'),
      onClick: () => onDelete(true),
      variant: 'danger'
    });
  }
  actions.push(
    {
      // A node with nothing attached has no connection decision to make, so it
      // gets a plain Delete rather than a button naming an outcome that only
      // makes sense next to an alternative.
      label: hasConnections ? t('Delete & Disconnect') : t('Delete'),
      onClick: () => onDelete(false),
      variant: 'danger',
      className: canReconnect ? 'bg-red-500/15 text-red-300 hover:bg-red-500/20' : undefined
    },
    {
      label: t('Cancel'),
      onClick: onCancel,
      variant: 'secondary',
      className: 'w-full'
    }
  );
  // Open with the delete focused, so Enter confirms straight away and the ring
  // shows which button that is. With both delete options present the default is
  // the first one — the reconnecting delete, which is the one that leaves the
  // rest of the graph wired; Tab moves to the others.
  actions[0].autoFocus = true;

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

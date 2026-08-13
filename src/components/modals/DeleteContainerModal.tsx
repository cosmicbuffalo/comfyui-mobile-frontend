import { createPortal } from 'react-dom';
import { Dialog } from './Dialog';
import { useI18n } from '@/i18n';

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
  const { t } = useI18n();
  return createPortal(
    <Dialog
      onClose={onCancel}
      title={containerTypeLabel === 'group' ? t('Delete group') : t('Delete subgraph')}
      description={
        <>
          {nodeCount === 1
            ? t('{name} ({id}) has {count} node.', { name: displayName, id: containerIdLabel, count: nodeCount })
            : t('{name} ({id}) has {count} nodes.', { name: displayName, id: containerIdLabel, count: nodeCount })}
        </>
      }
      actionsLayout="stack"
      actions={[
        {
          label: containerTypeLabel === 'group' ? t('Delete group only') : t('Delete subgraph only'),
          onClick: onDeleteContainerOnly,
          variant: 'danger',
          className: 'w-full bg-red-500/15 text-red-300 hover:bg-red-500/20'
        },
        {
          label: containerTypeLabel === 'group' ? t('Delete group and nodes') : t('Delete subgraph and nodes'),
          onClick: onDeleteContainerAndNodes,
          variant: 'danger',
          className: 'w-full'
        },
        {
          label: t('Cancel'),
          onClick: onCancel,
          variant: 'secondary',
          className: 'w-full'
        }
      ]}
    />,
    document.body
  );
}

import { createPortal } from 'react-dom';
import { Dialog } from './Dialog';
import { useT } from '@/i18n';

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
  const t = useT();
  const typeText = containerTypeLabel === 'group' ? t('group') : t('subgraph');
  return createPortal(
    <Dialog
      onClose={onCancel}
      title={t('Delete {type}', { type: typeText })}
      description={
        <>
          <span className="font-medium text-slate-100">{displayName}</span> ({containerIdLabel}) {t('has')} {nodeCount} {t(nodeCount === 1 ? 'node' : 'nodes')}.
        </>
      }
      actionsLayout="stack"
      actions={[
        {
          label: t('Delete {type} only', { type: typeText }),
          onClick: onDeleteContainerOnly,
          variant: 'danger',
          className: 'w-full bg-red-500/15 text-red-300 hover:bg-red-500/20'
        },
        {
          label: t('Delete {type} and nodes', { type: typeText }),
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

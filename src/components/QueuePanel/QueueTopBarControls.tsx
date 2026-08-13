import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useHistoryStore } from '@/hooks/useHistory';
import { useQueueStore } from '@/hooks/useQueue';
import { useOutputsStore } from '@/hooks/useOutputs';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import {
  deleteRejectedOutputs,
  QUEUE_REJECT_SOURCES,
  rejectedIdsForSources,
} from '@/utils/deleteRejectedOutputs';
import { Dialog } from '@/components/modals/Dialog';
import { QueueTopBarMenu } from './QueueTopBarMenu';
import { useT } from '@/i18n';

export function QueueTopBarControls() {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false);
  const [cancelPendingConfirmOpen, setCancelPendingConfirmOpen] = useState(false);
  const [deleteRejectedConfirmOpen, setDeleteRejectedConfirmOpen] = useState(false);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const clearHistory = useHistoryStore((s) => s.clearHistory);
  const clearQueue = useQueueStore((s) => s.clearQueue);
  const rejectedCount = useOutputsStore(
    (s) => rejectedIdsForSources(s.rejected, QUEUE_REJECT_SOURCES).length,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useDismissOnOutsideClick({
    open: menuOpen,
    onDismiss: () => setMenuOpen(false),
    triggerRef: buttonRef,
    contentRef: menuRef,
  });

  return (
    <>
      <QueueTopBarMenu
        open={menuOpen}
        buttonRef={buttonRef}
        menuRef={menuRef}
        onToggle={() => setMenuOpen((prev) => !prev)}
        onClose={() => setMenuOpen(false)}
        onGoToWorkflow={() => setCurrentPanel('workflow')}
        onOpenClearHistoryConfirm={() => setClearHistoryConfirmOpen(true)}
        onOpenCancelPendingConfirm={() => setCancelPendingConfirmOpen(true)}
        onOpenDeleteRejectedConfirm={() => setDeleteRejectedConfirmOpen(true)}
      />
      {cancelPendingConfirmOpen && createPortal(
        <Dialog
          onClose={() => setCancelPendingConfirmOpen(false)}
          title={t('Cancel all pending?')}
          description={t("This removes every queued generation that hasn't started yet. The currently running generation keeps going.")}
          actions={[
            {
              label: t('Keep queue'),
              onClick: () => setCancelPendingConfirmOpen(false),
              variant: 'secondary'
            },
            {
              label: t('Cancel all pending'),
              onClick: () => {
                void (async () => {
                  await clearQueue();
                  setCancelPendingConfirmOpen(false);
                })();
              },
              variant: 'danger'
            }
          ]}
        />,
        document.body
      )}
      {deleteRejectedConfirmOpen && createPortal(
        <Dialog
          onClose={() => setDeleteRejectedConfirmOpen(false)}
          title={rejectedCount === 1
            ? t('Delete 1 rejected output?')
            : t('Delete {count} rejected outputs?', { count: rejectedCount })}
          description={t("This permanently deletes the files marked as rejected from your server's output folder and removes them from the queue. This can't be undone.")}
          actions={[
            {
              label: t('Cancel'),
              onClick: () => setDeleteRejectedConfirmOpen(false),
              variant: 'secondary'
            },
            {
              label: t('Delete rejected'),
              onClick: () => {
                void (async () => {
                  await deleteRejectedOutputs(QUEUE_REJECT_SOURCES);
                  setDeleteRejectedConfirmOpen(false);
                })();
              },
              variant: 'danger'
            }
          ]}
        />,
        document.body
      )}
      {clearHistoryConfirmOpen && createPortal(
        <Dialog
          onClose={() => setClearHistoryConfirmOpen(false)}
          title={t('Clear history?')}
          description={t("This will permanently remove all completed generations from history. Generated files will still be present in your server's output folder.")}
          actions={[
            {
              label: t('Cancel'),
              onClick: () => setClearHistoryConfirmOpen(false),
              variant: 'secondary'
            },
            {
              label: t('Clear history'),
              onClick: () => {
                void (async () => {
                  await clearHistory();
                  setClearHistoryConfirmOpen(false);
                })();
              },
              variant: 'danger'
            }
          ]}
        />,
        document.body
      )}
    </>
  );
}

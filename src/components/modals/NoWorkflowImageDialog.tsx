import { Dialog } from '@/components/modals/Dialog';
import { useNoWorkflowImageModal } from '@/hooks/useNoWorkflowImageModal';
import { useT } from '@/i18n';

/**
 * Shown when a picked or dropped image carries no embedded ComfyUI workflow.
 * Mounted once at the app root; driven by useNoWorkflowImageModal so both the
 * device picker and the workflow-panel drop target reuse it.
 */
export function NoWorkflowImageDialog() {
  const t = useT();
  const open = useNoWorkflowImageModal((s) => s.open);
  const filename = useNoWorkflowImageModal((s) => s.filename);
  const dismiss = useNoWorkflowImageModal((s) => s.dismiss);

  if (!open) return null;

  return (
    <Dialog
      onClose={dismiss}
      title={t('No workflow in this image')}
      description={
        filename
          ? t('“{name}” doesn’t contain an embedded workflow to load. It may have been stripped, or saved by a tool that doesn’t embed one.', { name: filename })
          : t('This image doesn’t contain an embedded workflow to load. It may have been stripped, or saved by a tool that doesn’t embed one.')
      }
      actions={[{ label: t('Dismiss'), onClick: dismiss, variant: 'primary', autoFocus: true }]}
    />
  );
}

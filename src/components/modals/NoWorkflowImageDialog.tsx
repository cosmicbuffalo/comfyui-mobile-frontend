import { Dialog } from '@/components/modals/Dialog';
import { useNoWorkflowImageModal } from '@/hooks/useNoWorkflowImageModal';

/**
 * Shown when a picked or dropped image carries no embedded ComfyUI workflow.
 * Mounted once at the app root; driven by useNoWorkflowImageModal so both the
 * device picker and the workflow-panel drop target reuse it.
 */
export function NoWorkflowImageDialog() {
  const open = useNoWorkflowImageModal((s) => s.open);
  const filename = useNoWorkflowImageModal((s) => s.filename);
  const dismiss = useNoWorkflowImageModal((s) => s.dismiss);

  if (!open) return null;

  return (
    <Dialog
      onClose={dismiss}
      title="No workflow in this image"
      description={
        filename
          ? `“${filename}” doesn’t contain an embedded workflow.`
          : "This image doesn’t contain an embedded workflow."
      }
      actions={[{ label: 'Dismiss', onClick: dismiss, variant: 'primary', autoFocus: true }]}
    />
  );
}

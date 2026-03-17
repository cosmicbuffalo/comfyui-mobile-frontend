import type { Workflow } from '@/api/types';
import { stripWorkflowClientMetadata } from '@/hooks/useWorkflow';
import { validateAndNormalizeWorkflow } from '@/utils/workflowValidator';

export function getWorkflowForPersistence(
  canonicalWorkflow: Workflow | null,
): Workflow | null {
  if (!canonicalWorkflow) {
    return null;
  }
  const stripped = stripWorkflowClientMetadata(canonicalWorkflow);
  return validateAndNormalizeWorkflow(stripped);
}

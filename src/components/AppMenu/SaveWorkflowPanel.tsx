import { DownloadDeviceIcon } from '@/components/icons';
import type { Workflow } from '@/api/types';
import { MenuSubPageHeader } from './MenuSubPageHeader';
import { MenuErrorNotice } from './MenuErrorNotice';
import {
  menuIconClassName,
  menuInputClassName,
  menuMutedTextClassName,
  menuPrimaryButtonClassName,
  menuSurfaceButtonDisabledClassName,
  menuSurfaceClassName,
  menuTextClassName,
} from './menuStyles';

interface SaveWorkflowPanelProps {
  error: string | null;
  loading: boolean;
  workflow: Workflow | null;
  saveFilenameInput: string;
  onBack: () => void;
  onDismissError: () => void;
  onSaveFilenameChange: (value: string) => void;
  onSaveAs: () => void;
  onDownload: () => void;
}

export function SaveWorkflowPanel({
  error,
  loading,
  workflow,
  saveFilenameInput,
  onBack,
  onDismissError,
  onSaveFilenameChange,
  onSaveAs,
  onDownload,
}: SaveWorkflowPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <MenuSubPageHeader title="Save Workflow" onBack={onBack} />
      <MenuErrorNotice error={error} onDismiss={onDismissError} />

      <div className="space-y-4">
        <div className={`${menuSurfaceClassName} p-4`}>
          <p className={`text-sm ${menuMutedTextClassName} mb-3`}>Save to ComfyUI server:</p>
          <input
            type="text"
            value={saveFilenameInput}
            onChange={(e) => onSaveFilenameChange(e.target.value)}
            placeholder="Enter filename (e.g., my_workflow.json)"
            data-swipe-nav-ignore="true"
            className={`w-full p-3 rounded-lg mb-3 ${menuInputClassName}`}
          />
          <button
            onClick={onSaveAs}
            disabled={!workflow || !saveFilenameInput.trim() || loading}
            className={`w-full ${menuPrimaryButtonClassName}`}
          >
            {loading ? 'Saving...' : 'Save As'}
          </button>
        </div>

        <button
          onClick={onDownload}
          disabled={!workflow}
          className={menuSurfaceButtonDisabledClassName}
        >
          <DownloadDeviceIcon className={menuIconClassName} />
          <span className={menuTextClassName}>Download to Device</span>
        </button>

      </div>
    </div>
  );
}

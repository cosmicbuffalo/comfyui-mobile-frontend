import { DownloadDeviceIcon } from '@/components/icons';
import type { Workflow } from '@/api/types';
import { MenuSubPageHeader } from './MenuSubPageHeader';
import { MenuErrorNotice } from './MenuErrorNotice';

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
        <div className="p-4 bg-white border border-gray-200 rounded-xl">
          <p className="text-sm text-gray-600 mb-3">Save to ComfyUI server:</p>
          <input
            type="text"
            value={saveFilenameInput}
            onChange={(e) => onSaveFilenameChange(e.target.value)}
            placeholder="Enter filename (e.g., my_workflow.json)"
            className="w-full p-3 border border-gray-300 rounded-lg mb-3"
          />
          <button
            onClick={onSaveAs}
            disabled={!workflow || !saveFilenameInput.trim() || loading}
            className="w-full py-3 bg-blue-500 text-white rounded-lg font-medium
                       disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
          >
            {loading ? 'Saving...' : 'Save As'}
          </button>
        </div>

        <button
          onClick={onDownload}
          disabled={!workflow}
          className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200
                     rounded-xl text-left hover:bg-gray-50 min-h-[56px]
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <DownloadDeviceIcon className="w-6 h-6 text-gray-600" />
          <span className="font-medium text-gray-900">Download to Device</span>
        </button>

      </div>
    </div>
  );
}

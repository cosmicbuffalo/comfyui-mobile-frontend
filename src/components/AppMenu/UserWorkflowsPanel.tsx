import { WorkflowLoadIcon } from '@/components/icons';
import { LoadingSpinner } from '../LoadingSpinner';
import { MenuSubPageHeader } from './MenuSubPageHeader';
import { MenuErrorNotice } from './MenuErrorNotice';
import type { UserDataFile } from '@/api/client';

interface UserWorkflowsPanelProps {
  error: string | null;
  loading: boolean;
  userWorkflows: UserDataFile[];
  onBack: () => void;
  onDismissError: () => void;
  onLoadWorkflow: (filename: string) => void;
}

export function UserWorkflowsPanel({
  error,
  loading,
  userWorkflows,
  onBack,
  onDismissError,
  onLoadWorkflow,
}: UserWorkflowsPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <MenuSubPageHeader title="My Workflows" onBack={onBack} />
      <MenuErrorNotice error={error} onDismiss={onDismissError} />

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner />
        </div>
      ) : userWorkflows.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No saved workflows yet</p>
      ) : (
        <div className="space-y-2 overflow-y-auto flex-1">
          {userWorkflows.map((file) => (
            <button
              key={file.path}
              onClick={() => onLoadWorkflow(file.name)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200
                         rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
            >
              <WorkflowLoadIcon className="w-5 h-5 text-gray-600" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">
                  {file.name.replace(/\.json$/, '')}
                </p>
                {file.modified && (
                  <p className="text-xs text-gray-500">
                    {new Date(file.modified * 1000).toLocaleDateString()}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

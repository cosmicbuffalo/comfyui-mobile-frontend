import { useState } from 'react';
import { WorkflowLoadIcon, XMarkIcon } from '@/components/icons';
import { LoadingSpinner } from '../LoadingSpinner';
import { MenuSubPageHeader } from './MenuSubPageHeader';
import { MenuErrorNotice } from './MenuErrorNotice';
import type { UserDataFile } from '@/api/client';

export function formatRelativeDate(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp * 1000);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const mm = String(date.getMonth() + 1);
  const dd = String(date.getDate());
  const yy = String(date.getFullYear()).slice(-2);
  const dateStr = `${mm}/${dd}/${yy}`;

  if (diffDays === 0) return `${dateStr} (Today)`;
  if (diffDays === 1) return `${dateStr} (Yesterday)`;
  return `${dateStr} (${diffDays} days ago)`;
}

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
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'date'>('name');

  const filteredWorkflows = userWorkflows
    .filter((file) => file.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) =>
      sortBy === 'name'
        ? a.name.localeCompare(b.name)
        : (b.modified ?? 0) - (a.modified ?? 0),
    );

  const sortButton = (
    <button
      onClick={() => setSortBy(sortBy === 'name' ? 'date' : 'name')}
      className="flex items-center gap-0.5 text-xs font-semibold text-blue-500"
    >
      <span>{sortBy === 'name' ? 'NAME' : 'DATE'}</span>
      <span>↓</span>
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <MenuSubPageHeader title="My Workflows" onBack={onBack} rightElement={sortButton} />
      <MenuErrorNotice error={error} onDismiss={onDismissError} />

      {!loading && userWorkflows.length > 0 && (
        <div className="relative py-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="w-full px-3 py-2 pr-9 bg-white border border-gray-200 rounded-lg
                       text-sm text-gray-900 placeholder-gray-400
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner />
        </div>
      ) : userWorkflows.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No saved workflows yet</p>
      ) : filteredWorkflows.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No matching workflows</p>
      ) : (
        <div className="space-y-2 overflow-y-auto flex-1">
          {filteredWorkflows.map((file) => (
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
                    {formatRelativeDate(file.modified)}
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

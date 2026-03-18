import { useState } from 'react';
import { WorkflowIcon, FolderIcon } from '@/components/icons';
import { SearchBar } from '@/components/SearchBar';
import { LoadingSpinner } from '../LoadingSpinner';
import { MenuSubPageHeader } from './MenuSubPageHeader';
import { MenuErrorNotice } from './MenuErrorNotice';
import type { UserDataFile } from '@/api/client';
import { formatRelativeDate } from './formatRelativeDate';
import { getRelativePath, getDirectChildren } from './userWorkflowHelpers';

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
  const [currentFolder, setCurrentFolder] = useState('workflows');

  const isSearching = search.trim().length > 0;

  // When searching: flatten all files across all folders
  // When browsing: show direct children of current folder
  const visibleItems = isSearching
    ? userWorkflows
        .filter(
          (file) =>
            file.type === 'file' &&
            file.name.toLowerCase().includes(search.toLowerCase()),
        )
    : getDirectChildren(userWorkflows, currentFolder);

  const sortedItems = [...visibleItems].sort((a, b) => {
    // Directories always come first when browsing
    if (!isSearching) {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
    }
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    return (b.modified ?? 0) - (a.modified ?? 0);
  });

  const isInSubfolder = currentFolder !== 'workflows';

  const handleBack = () => {
    if (isSearching) {
      setSearch('');
    } else if (isInSubfolder) {
      // Navigate up one level
      const parentFolder = currentFolder.substring(0, currentFolder.lastIndexOf('/'));
      setCurrentFolder(parentFolder);
    } else {
      onBack();
    }
  };

  const folderDisplayName = isSearching
    ? 'Search Results'
    : isInSubfolder
      ? currentFolder.substring(currentFolder.lastIndexOf('/') + 1)
      : 'My Workflows';

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
      <MenuSubPageHeader title={folderDisplayName} onBack={handleBack} rightElement={sortButton} />
      <MenuErrorNotice error={error} onDismiss={onDismissError} />

      {!loading && userWorkflows.length > 0 && (
        <div className="py-2">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search"
            inputClassName="bg-white"
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <LoadingSpinner />
        </div>
      ) : userWorkflows.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No saved workflows yet</p>
      ) : sortedItems.length === 0 ? (
        <p className="text-gray-500 text-center py-8">
          {isSearching ? 'No matching workflows' : 'Empty folder'}
        </p>
      ) : (
        <div className="space-y-2 overflow-y-auto flex-1">
          {sortedItems.map((file) => {
            if (file.type === 'directory') {
              return (
                <button
                  key={file.path}
                  onClick={() => setCurrentFolder(file.path)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200
                             rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
                >
                  <FolderIcon className="w-5 h-5 text-amber-500" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{file.name}</p>
                  </div>
                </button>
              );
            }
            const relPath = getRelativePath(file);
            return (
              <button
                key={file.path}
                onClick={() => onLoadWorkflow(relPath)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200
                           rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
              >
                <WorkflowIcon className="w-5 h-5 text-gray-600" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {file.name.replace(/\.json$/, '')}
                  </p>
                  {isSearching && relPath.includes('/') && (
                    <p className="text-xs text-gray-400 truncate">
                      {relPath.replace(/\/[^/]+$/, '')}
                    </p>
                  )}
                  {file.modified && (
                    <p className="text-xs text-gray-500">
                      {formatRelativeDate(file.modified)}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

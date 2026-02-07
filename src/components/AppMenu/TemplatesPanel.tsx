import { useState } from 'react';
import { TemplateIcon, XMarkIcon } from '@/components/icons';
import { LoadingSpinner } from '../LoadingSpinner';
import { MenuSubPageHeader } from './MenuSubPageHeader';
import { MenuErrorNotice } from './MenuErrorNotice';
import type { WorkflowTemplates } from '@/api/client';

interface TemplatesPanelProps {
  error: string | null;
  loading: boolean;
  templates: WorkflowTemplates;
  onBack: () => void;
  onDismissError: () => void;
  onLoadTemplate: (moduleName: string, templateName: string) => void;
}

export function TemplatesPanel({
  error,
  loading,
  templates,
  onBack,
  onDismissError,
  onLoadTemplate,
}: TemplatesPanelProps) {
  const [search, setSearch] = useState('');
  const templateEntries = Object.entries(templates);

  const query = search.toLowerCase();
  const filteredEntries = templateEntries
    .map(([moduleName, templateList]) => [
      moduleName,
      templateList.filter((name) => name.toLowerCase().includes(query)),
    ] as [string, string[]])
    .filter(([, list]) => list.length > 0);

  const hasTemplates = templateEntries.length > 0;

  return (
    <div className="flex flex-col h-full">
      <MenuSubPageHeader title="Templates" onBack={onBack} />
      <MenuErrorNotice error={error} onDismiss={onDismissError} />

      {!loading && hasTemplates && (
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
      ) : !hasTemplates ? (
        <p className="text-gray-500 text-center py-8">No templates available</p>
      ) : filteredEntries.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No matching templates</p>
      ) : (
        <div className="space-y-4 overflow-y-auto flex-1">
          {filteredEntries.map(([moduleName, templateList]) => (
            <div key={moduleName}>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">
                {moduleName}
              </h4>
              <div className="space-y-2">
                {templateList.map((templateName) => (
                  <button
                    key={templateName}
                    onClick={() => onLoadTemplate(moduleName, templateName)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200
                               rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
                  >
                    <TemplateIcon className="w-5 h-5 text-gray-600" />
                    <span className="font-medium text-gray-900 truncate">
                      {templateName.replace(/\.json$/, '')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

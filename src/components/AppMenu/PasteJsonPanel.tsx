import { TextareaActions } from '../InputControls/TextareaActions';
import { MenuSubPageHeader } from './MenuSubPageHeader';
import { MenuErrorNotice } from './MenuErrorNotice';

interface PasteJsonPanelProps {
  error: string | null;
  pastedJson: string;
  pasteTextareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onBack: () => void;
  onDismissError: () => void;
  onChangeJson: (value: string) => void;
  onLoad: () => void;
}

export function PasteJsonPanel({
  error,
  pastedJson,
  pasteTextareaRef,
  onBack,
  onDismissError,
  onChangeJson,
  onLoad,
}: PasteJsonPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <MenuSubPageHeader title="Paste JSON" onBack={onBack} />
      <MenuErrorNotice error={error} onDismiss={onDismissError} />

      <div className="flex-1 flex flex-col space-y-4 overflow-hidden">
        <p className="text-sm text-gray-600">
          Paste your workflow JSON below.
        </p>
        <div className="group" data-textarea-root="true">
          <div className="flex items-center justify-between mb-1" data-textarea-header="true">
            <div className="text-xs text-gray-500 uppercase tracking-wide">
              Workflow JSON
            </div>
            <TextareaActions
              value={pastedJson}
              onChange={onChangeJson}
              textareaRef={pasteTextareaRef}
              className="opacity-70 transition-opacity group-focus-within:opacity-100"
            />
          </div>
          <textarea
            ref={pasteTextareaRef}
            value={pastedJson}
            onChange={(e) => onChangeJson(e.target.value)}
            placeholder='{"last_node_id": ...}'
            className="w-full flex-1 p-3 border border-gray-300 rounded-lg font-mono text-xs resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onBack}
            className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 min-h-[48px]"
          >
            Cancel
          </button>
          <button
            onClick={onLoad}
            disabled={!pastedJson.trim()}
            className="flex-1 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600
                       disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
          >
            Load
          </button>
        </div>
      </div>
    </div>
  );
}

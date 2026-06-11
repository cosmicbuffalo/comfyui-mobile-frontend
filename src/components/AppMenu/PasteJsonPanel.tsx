import { TextareaActions } from '../InputControls/TextareaActions';
import { MenuSubPageHeader } from './MenuSubPageHeader';
import { MenuErrorNotice } from './MenuErrorNotice';
import {
  menuInputClassName,
  menuMutedTextClassName,
  menuPrimaryButtonClassName,
  menuSecondaryButtonClassName,
} from './menuStyles';

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

      <div className="flex-1 flex flex-col space-y-4">
        <p className={`text-sm ${menuMutedTextClassName}`}>
          Paste your workflow JSON below.
        </p>
        <div className="group" data-textarea-root="true">
          <div className="flex items-center justify-between mb-1" data-textarea-header="true">
            <div className={`text-xs ${menuMutedTextClassName} uppercase tracking-wide`}>
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
            data-swipe-nav-ignore="true"
            className={`w-full flex-1 p-3 rounded-lg font-mono text-xs resize-none outline-none ${menuInputClassName}`}
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onBack}
            className={`flex-1 ${menuSecondaryButtonClassName}`}
          >
            Cancel
          </button>
          <button
            onClick={onLoad}
            disabled={!pastedJson.trim()}
            className={`flex-1 ${menuPrimaryButtonClassName}`}
          >
            Load
          </button>
        </div>
      </div>
    </div>
  );
}

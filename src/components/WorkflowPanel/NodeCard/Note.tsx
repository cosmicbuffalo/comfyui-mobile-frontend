import type { RefObject } from 'react';
import { TextareaActions } from '../../InputControls/TextareaActions';

interface NodeCardNoteProps {
  noteText: string;
  noteLinkified: React.ReactNode;
  noteWidgetIndex: number | null;
  isEditingNote: boolean;
  setIsEditingNote: (next: boolean) => void;
  onUpdateNote: (value: string) => void;
  noteTextareaRef: RefObject<HTMLTextAreaElement | null>;
  onNoteTap: () => void;
}

export function NodeCardNote({
  noteText,
  noteLinkified,
  noteWidgetIndex,
  isEditingNote,
  setIsEditingNote,
  onUpdateNote,
  noteTextareaRef,
  onNoteTap
}: NodeCardNoteProps) {
  const handleNoteUpdate = (value: string) => {
    if (noteWidgetIndex === null) return;
    onUpdateNote(value);
  };

  const handleTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (noteWidgetIndex === null) return;
    onUpdateNote(event.target.value);
  };

  return (
    <div className="mb-3 group" data-textarea-root="true">
      <div className="flex items-center justify-between mb-1.5" data-textarea-header="true">
        <div className="text-xs text-gray-500 uppercase tracking-wide">
          Note
        </div>
        {isEditingNote && (
          <TextareaActions
            value={noteText}
            onChange={handleNoteUpdate}
            textareaRef={noteTextareaRef}
            className="opacity-70 transition-opacity group-focus-within:opacity-100"
          />
        )}
      </div>
      {isEditingNote ? (
        <textarea
          ref={noteTextareaRef}
          value={noteText}
          onChange={handleTextareaChange}
          onBlur={() => setIsEditingNote(false)}
          className="w-full p-3 border rounded-lg text-base resize-none note-display"
          rows={Math.min(8, Math.max(3, noteText.split('\n').length))}
        />
      ) : (
        <div
          className="w-full p-3 border rounded-lg text-base whitespace-pre-wrap break-words note-display"
          onDoubleClick={() => setIsEditingNote(true)}
          onTouchEnd={onNoteTap}
        >
          {noteLinkified}
        </div>
      )}
    </div>
  );
}

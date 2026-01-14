import type { RefObject } from 'react';
import { useRef, useState } from 'react';
import { CheckIcon, ClipboardIcon, MinusCircleIcon } from '@/components/icons';

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to execCommand when Clipboard API is unavailable or blocked.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function focusTextarea(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  selection?: { start: number; end: number },
  nextValue?: string
) {
  const el = textareaRef.current;
  if (!el) return;
  el.focus();
  if (selection) {
    el.setSelectionRange(selection.start, selection.end);
  } else if (nextValue !== undefined) {
    const caret = nextValue.length;
    el.setSelectionRange(caret, caret);
  }
}

function scrollActionsIntoView(textareaRef: RefObject<HTMLTextAreaElement | null>) {
  const el = textareaRef.current;
  if (!el) return;
  const root = el.closest<HTMLElement>('[data-textarea-root="true"]');
  const header = root?.querySelector<HTMLElement>('[data-textarea-header="true"]');
  if (header) {
    header.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  } else {
    el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }
}


export function TextareaActions({
  value,
  onChange,
  textareaRef,
  className = '',
}: {
  value: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  className?: string;
}) {
  const [copyDone, setCopyDone] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  const flashCopy = () => {
    setCopyDone(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyDone(false), 900);
  };

  const keepFocus = (event: React.MouseEvent) => {
    event.preventDefault();
  };

  return (
    <div className={`flex items-center text-[11px] text-gray-500 ${className}`}>
      <button
        type="button"
        className="inline-flex items-center gap-1 px-1 py-0.5 text-gray-600"
        onMouseDown={keepFocus}
        onClick={async () => {
          const el = textareaRef.current;
          if (el) {
            selectionRef.current = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
          }
          const liveValue = textareaRef.current?.value ?? value;
          await writeClipboard(liveValue);
          requestAnimationFrame(() => focusTextarea(textareaRef, selectionRef.current || undefined));
          flashCopy();
        }}
        aria-label="Copy to clipboard"
      >
        {copyDone ? (
          <CheckIcon className="w-3.5 h-3.5 text-green-500" />
        ) : (
          <ClipboardIcon className="w-3.5 h-3.5" />
        )}
        <span>Copy</span>
      </button>
      <span className="text-gray-500/50">|</span>
      <button
        type="button"
        className="inline-flex items-center gap-1 px-1 py-0.5 text-red-600"
        onMouseDown={keepFocus}
        onClick={() => {
          onChange('');
          requestAnimationFrame(() => {
            focusTextarea(textareaRef, undefined, '');
            scrollActionsIntoView(textareaRef);
          });
        }}
        aria-label="Clear text"
      >
        <MinusCircleIcon className="w-3.5 h-3.5" />
        <span>Clear</span>
      </button>
    </div>
  );
}

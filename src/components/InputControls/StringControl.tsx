import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TextareaActions } from './TextareaActions';
import { FullscreenWidgetModal } from '../modals/FullscreenWidgetModal';
import { PinButton } from './PinButton';
import { PromotedWidgetIcon } from '../icons';
import { useCoarsePointer } from '@/hooks/useCoarsePointer';
import { themeColors } from '@/theme/colors';
import {
  controlInputBaseClassName,
  controlInputDarkClassName,
  controlLabelClassName,
  controlModalFocusClassName,
  controlModalInputBaseClassName,
  controlStateClassName,
} from './controlStyles';

// How long after the last keystroke the draft is committed to the store.
const DRAFT_COMMIT_DELAY_MS = 300;

/**
 * Keystrokes land in local draft state and are committed to the store on a
 * short debounce (plus blur/unmount/modal-close flushes). Committing per
 * keystroke replaces the whole workflow object, re-rendering every NodeCard
 * per character — the single biggest source of typing latency on mobile.
 */
function useDraftText(value: string, onChange: (value: unknown) => void) {
  const [draft, setDraft] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  const [dirty, setDirty] = useState(false);

  // Adopt upstream changes (other clients, pinned overlay, reverts) unless the
  // user is mid-edit. Render-time state adjustment per the React docs pattern.
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (!dirty) {
      setDraft(value);
    }
  }

  const flush = useCallback(() => {
    if (!dirty) return;
    setDirty(false);
    onChange(draft);
  }, [dirty, draft, onChange]);

  const handleDraftChange = useCallback((next: string) => {
    setDraft(next);
    setDirty(true);
  }, []);

  // Debounced commit: every keystroke restarts the timer via the deps.
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      setDirty(false);
      onChange(draft);
    }, DRAFT_COMMIT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, onChange]);

  // Commit anything pending if the control unmounts (card collapse, etc.).
  const latestRef = useRef({ dirty, draft, onChange });
  useEffect(() => {
    latestRef.current = { dirty, draft, onChange };
  });
  useEffect(
    () => () => {
      const latest = latestRef.current;
      if (latest.dirty) latest.onChange(latest.draft);
    },
    [],
  );

  return { draft, handleDraftChange, flush };
}

interface StringControlProps {
  containerClass: string;
  name: string;
  value: unknown;
  options?: Record<string, unknown> | unknown[];
  onChange: (value: unknown) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  hasPin: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  hasError?: boolean;
  isPromoted?: boolean;
  forceModalOpen?: boolean;
  onModalClose?: () => void;
}

export function StringControl({
  containerClass,
  name,
  value,
  options,
  onChange,
  disabled = false,
  hideLabel = false,
  hasPin,
  isPinned = false,
  onTogglePin,
  hasError = false,
  isPromoted = false,
  forceModalOpen = false,
  onModalClose
}: StringControlProps) {
  const getOption = (key: string): unknown => {
    if (Array.isArray(options)) return undefined;
    return options?.[key];
  };

  const isMultiline = getOption('multiline') as boolean;
  const placeholder = getOption('placeholder') as string;
  const { draft: valueString, handleDraftChange, flush } = useDraftText(
    String(value ?? ''),
    onChange,
  );
  // TextareaActions transforms (clear/insert) apply immediately — they're
  // discrete actions, not typing.
  const handleImmediateChange = (next: unknown) => {
    handleDraftChange(String(next ?? ''));
    flush();
  };
  const handleTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    handleDraftChange(event.target.value);
  };

  const [internalModalOpen, setInternalModalOpen] = useState(false);
  const showModal = forceModalOpen || internalModalOpen;

  const isCoarsePointer = useCoarsePointer();
  const useModalFlow = forceModalOpen || isCoarsePointer;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-grow the textarea to fit its content (both the inline editor and the
  // modal editor). In the modal, the panel/body caps the visible height and
  // scrolls past it, so the textarea grows with content instead of being forced
  // to full height by flex-1.
  useLayoutEffect(() => {
    if (!isMultiline) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [valueString, showModal, isMultiline]);

  const handleClose = () => {
    flush();
    setInternalModalOpen(false);
    onModalClose?.();
  };

  if (useModalFlow) {
    return (
      <div className={containerClass}>
        {isMultiline ? (
          <>
            <div className="flex items-center justify-between mb-1 min-h-[18px]">
              {!hideLabel ? (
                <label className={controlLabelClassName}>
                  <span className="inline-flex items-center gap-1">
                    <span>{name}</span>
                    {isPromoted && (
                      <PromotedWidgetIcon className="w-3.5 h-3.5 text-pink-500" />
                    )}
                  </span>
                </label>
              ) : (
                <span className={controlLabelClassName} />
              )}
              <TextareaActions
                value={valueString}
                onChange={handleImmediateChange}
                textareaRef={textareaRef}
                className="opacity-100"
              />
            </div>
            <div
              className={`relative ${controlInputBaseClassName} min-h-[100px] group cursor-text ${hasPin ? 'pr-10' : ''} ${controlStateClassName({ disabled, hasError, isPromoted })}`}
              onClick={() => !disabled && setInternalModalOpen(true)}
            >
              <div
                className="whitespace-pre-wrap break-words text-slate-100"
                style={{ color: themeColors.text.onDark }}
              >
                {valueString || <span className="text-slate-500">{placeholder}</span>}
              </div>
              {hasPin && (
                <div className="absolute right-2 top-2 pointer-events-none">
                  <div className="pointer-events-auto">
                    <PinButton isPinned={isPinned} onToggle={onTogglePin} />
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {!hideLabel && (
              <label className={`${controlLabelClassName} mb-1`}>
                <span className="inline-flex items-center gap-1">
                  <span>{name}</span>
                  {isPromoted && (
                    <PromotedWidgetIcon className="w-3.5 h-3.5 text-pink-500" />
                  )}
                </span>
              </label>
            )}
            <div
              className={`relative ${controlInputBaseClassName} min-h-[46px] flex items-center cursor-text ${hasPin ? 'pr-16' : 'pr-6'} ${controlStateClassName({ disabled, hasError, isPromoted })}`}
              onClick={() => !disabled && setInternalModalOpen(true)}
            >
              <div
                className="truncate min-w-0 flex-1 text-slate-100"
                style={{ color: themeColors.text.onDark }}
              >
                {valueString || <span className="text-slate-500">{placeholder}</span>}
              </div>
              {hasPin && (
                <div className="absolute right-0 top-0 bottom-0 flex items-center pointer-events-none">
                  <div className="pointer-events-auto px-3">
                    <PinButton isPinned={isPinned} onToggle={onTogglePin} />
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <FullscreenWidgetModal
          title={name}
          isOpen={showModal}
          onClose={handleClose}
          viewerSidebar={forceModalOpen}
          headerActions={isMultiline ? (
            <TextareaActions
              value={valueString}
              onChange={handleImmediateChange}
              textareaRef={textareaRef}
              className="mr-2"
            />
          ) : null}
        >
          {isMultiline ? (
            <textarea
              ref={textareaRef}
              value={valueString}
              onChange={(e) => handleDraftChange(e.target.value)}
              onBlur={flush}
              placeholder={placeholder}
              data-swipe-nav-ignore="true"
              className={`${controlModalInputBaseClassName} min-h-[150px] resize-none overflow-hidden ${controlModalFocusClassName(isPromoted)}`}
              autoFocus={!forceModalOpen}
              disabled={disabled}
            />
          ) : (
            <input
              ref={inputRef}
              type="text"
              value={valueString}
              onChange={(e) => handleDraftChange(e.target.value)}
              onBlur={flush}
              placeholder={placeholder}
              data-swipe-nav-ignore="true"
              className={`${controlModalInputBaseClassName} ${controlModalFocusClassName(isPromoted)}`}
              autoFocus={!forceModalOpen}
              disabled={disabled}
            />
          )}
        </FullscreenWidgetModal>
      </div>
    );
  }

  if (isMultiline) {
    return (
      <div className={`${containerClass} group`} data-textarea-root="true">
        <div className="flex items-center justify-between mb-1 min-h-[18px]" data-textarea-header="true">
          {!hideLabel && (
            <label className={controlLabelClassName}>
              <span className="inline-flex items-center gap-1">
                <span>{name}</span>
                {isPromoted && (
                  <PromotedWidgetIcon className="w-3.5 h-3.5 text-pink-500" />
                )}
              </span>
            </label>
          )}
          <TextareaActions
            value={valueString}
            onChange={handleImmediateChange}
            textareaRef={textareaRef}
            className="opacity-70 transition-opacity group-focus-within:opacity-100"
          />
        </div>
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={valueString}
            onChange={handleTextareaChange}
            onBlur={flush}
            placeholder={placeholder}
            data-swipe-nav-ignore="true"
            className={`${controlInputBaseClassName} min-h-[100px] resize-none overflow-hidden ${hasPin ? 'pr-10' : ''} ${controlStateClassName({ disabled, hasError, isPromoted })}`} // TODO - determine if overflow should be hidden or auto here
            style={{ overflowAnchor: 'none' }}
            disabled={disabled}
          />
          {hasPin && (
            <div className="absolute right-2 top-2">
              <PinButton isPinned={isPinned} onToggle={onTogglePin} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      {!hideLabel && (
        <label className={`${controlLabelClassName} mb-1`}>
          <span className="inline-flex items-center gap-1">
            <span>{name}</span>
            {isPromoted && (
              <PromotedWidgetIcon className="w-3.5 h-3.5 text-pink-500" />
            )}
          </span>
        </label>
      )}
      <div className="relative">
        <input
          type="text"
          value={valueString}
          onChange={(e) => handleDraftChange(e.target.value)}
          onBlur={flush}
          placeholder={placeholder}
          data-swipe-nav-ignore="true"
          className={`${controlInputBaseClassName} ${controlInputDarkClassName} ${hasPin ? 'pr-16' : ''} ${controlStateClassName({ disabled, hasError, isPromoted })}`}
          disabled={disabled}
        />
        {hasPin && (
          <div className="absolute right-0 top-0 bottom-0 flex items-center pointer-events-none">
            <div className="pointer-events-auto px-3">
              <PinButton isPinned={isPinned} onToggle={onTogglePin} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

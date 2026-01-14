import { useLayoutEffect, useRef, useState } from 'react';
import { TextareaActions } from '../TextareaActions';
import { MobileWidgetModal } from '../MobileWidgetModal';
import { BookmarkIcon } from './BookmarkIcon';

interface StringControlProps {
  containerClass: string;
  name: string;
  value: unknown;
  options?: Record<string, unknown> | unknown[];
  onChange: (value: unknown) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  hasBookmark: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  maxHeight?: string;
  hasError?: boolean;
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
  hasBookmark,
  isBookmarked = false,
  onToggleBookmark,
  maxHeight,
  hasError = false,
  forceModalOpen = false,
  onModalClose
}: StringControlProps) {
  const getOption = (key: string): unknown => {
    if (Array.isArray(options)) return undefined;
    return options?.[key];
  };

  const isMultiline = getOption('multiline') as boolean;
  const placeholder = getOption('placeholder') as string;
  const valueString = String(value ?? '');

  const [internalModalOpen, setInternalModalOpen] = useState(false);
  const showModal = forceModalOpen || internalModalOpen;

  const isCoarsePointer = typeof window === 'undefined' ? false : window.matchMedia('(pointer: coarse)').matches;
  const useModalFlow = forceModalOpen || isCoarsePointer;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!isMultiline) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, showModal, isMultiline]);

  const handleClose = () => {
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
                <label className="block text-sm font-medium text-gray-700">
                  {name}
                </label>
              ) : (
                <span className="block text-sm font-medium text-gray-700" />
              )}
              <TextareaActions
                value={valueString}
                onChange={onChange}
                textareaRef={textareaRef}
                className="opacity-100"
              />
            </div>
            <div
              className={`relative w-full p-3 comfy-input min-h-[100px] text-base group cursor-text ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${hasBookmark ? 'pr-10' : ''} ${hasError ? 'border-red-700 ring-1 ring-red-700' : ''}`}
              onClick={() => !disabled && setInternalModalOpen(true)}
            >
              <div className="whitespace-pre-wrap break-words text-gray-900 dark:text-[#e5e7eb]">
                {valueString || <span className="text-gray-400 dark:text-gray-500">{placeholder}</span>}
              </div>
              {hasBookmark && (
                <div className="absolute right-2 top-2 pointer-events-none">
                  <div className="pointer-events-auto">
                    <BookmarkIcon isBookmarked={isBookmarked} onToggle={onToggleBookmark} />
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {!hideLabel && (
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {name}
              </label>
            )}
            <div
              className={`relative w-full p-3 comfy-input text-base min-h-[46px] flex items-center cursor-text ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${hasBookmark ? 'pr-16' : 'pr-6'} ${hasError ? 'border-red-700 ring-1 ring-red-700' : ''}`}
              onClick={() => !disabled && setInternalModalOpen(true)}
            >
              <div className="truncate min-w-0 flex-1 text-gray-900 dark:text-[#e5e7eb]">
                {valueString || <span className="text-gray-400 dark:text-gray-500">{placeholder}</span>}
              </div>
              {hasBookmark && (
                <div className="absolute right-0 top-0 bottom-0 flex items-center pointer-events-none">
                  <div className="pointer-events-auto px-3">
                    <BookmarkIcon isBookmarked={isBookmarked} onToggle={onToggleBookmark} />
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <MobileWidgetModal
          title={name}
          isOpen={showModal}
          onClose={handleClose}
          headerActions={isMultiline ? (
            <TextareaActions
              value={valueString}
              onChange={onChange}
              textareaRef={textareaRef}
              className="mr-2"
            />
          ) : null}
        >
          {isMultiline ? (
            <textarea
              ref={textareaRef}
              value={valueString}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className="w-full p-3 border border-gray-300 rounded-lg min-h-[150px] text-base resize-none outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              autoFocus={!forceModalOpen}
              disabled={disabled}
            />
          ) : (
            <input
              ref={inputRef}
              type="text"
              value={valueString}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className="w-full p-3 border border-gray-300 rounded-lg text-base outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              autoFocus={!forceModalOpen}
              disabled={disabled}
            />
          )}
        </MobileWidgetModal>
      </div>
    );
  }

  if (isMultiline) {
    return (
      <div className={`${containerClass} group`} data-textarea-root="true">
        <div className="flex items-center justify-between mb-1 min-h-[18px]" data-textarea-header="true">
          {!hideLabel ? (
            <label className="block text-sm font-medium text-gray-700">
              {name}
            </label>
          ) : (
            <span className="block text-sm font-medium text-gray-700" />
          )}
          <TextareaActions
            value={valueString}
            onChange={onChange}
            textareaRef={textareaRef}
            className="opacity-70 transition-opacity group-focus-within:opacity-100"
          />
        </div>
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={valueString}
            onChange={(e) => {
              onChange(e.target.value);
            }}
            placeholder={placeholder}
            className={`w-full p-3 comfy-input min-h-[100px] text-base resize-none ${maxHeight ? 'overflow-auto' : 'overflow-hidden'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${hasBookmark ? 'pr-10' : ''} ${hasError ? 'border-red-700 ring-1 ring-red-700' : ''}`}
            style={{
              overflowAnchor: 'none',
              ...(maxHeight ? { maxHeight } : {})
            }}
            disabled={disabled}
          />
          {hasBookmark && (
            <div className="absolute right-2 top-2">
              <BookmarkIcon isBookmarked={isBookmarked} onToggle={onToggleBookmark} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      {!hideLabel && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {name}
        </label>
      )}
      <div className="relative">
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full p-3 comfy-input text-base ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${hasBookmark ? 'pr-16' : ''} ${hasError ? 'border-red-700 ring-1 ring-red-700' : ''}`}
          disabled={disabled}
        />
        {hasBookmark && (
          <div className="absolute right-0 top-0 bottom-0 flex items-center pointer-events-none">
            <div className="pointer-events-auto px-3">
              <BookmarkIcon isBookmarked={isBookmarked} onToggle={onToggleBookmark} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

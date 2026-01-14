import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import Select, { createFilter } from 'react-select';
import { MobileWidgetModal } from '../MobileWidgetModal';
import { BookmarkIcon } from './BookmarkIcon';
import { ChevronDownIcon, PlusIcon } from '@/components/icons';
import { uploadImageFile } from '@/api/client';

interface ComboControlProps {
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
  hasError?: boolean;
  forceModalOpen?: boolean;
  onModalClose?: () => void;
}

export function ComboControl({
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
  hasError = false,
  forceModalOpen = false,
  onModalClose
}: ComboControlProps) {
  type SelectOption = { value: string; label: string; isMissing?: boolean };

  const [internalModalOpen, setInternalModalOpen] = useState(false);
  const selectWrapperRef = useRef<HTMLDivElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadedChoices, setUploadedChoices] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const showModal = forceModalOpen || internalModalOpen;
  const isCoarsePointer = typeof window === 'undefined' ? false : window.matchMedia('(pointer: coarse)').matches;
  const useModalFlow = forceModalOpen || isCoarsePointer;

  const getOption = (key: string): unknown => {
    if (Array.isArray(options)) return undefined;
    return options?.[key];
  };

  const rawChoices = Array.isArray(options)
    ? options
    : (getOption('options') as unknown[]) ?? [];
  const supportsImageUpload = Boolean(getOption('image_upload'));
  const imageFolder = (getOption('image_folder') as string) ?? 'input';
  const NULL_OPTION_VALUE = '__null__';
  const hasNullChoice = rawChoices.some((opt) => opt === null);
  const choices = rawChoices
    .filter((opt) => opt !== null)
    .map((opt) => String(opt));
  const mergedChoices = Array.from(new Set([...choices, ...uploadedChoices]));
  const rawValueString = value === null ? NULL_OPTION_VALUE : String(value ?? '');
  const rawBase = rawValueString.split(/[\\/]/).pop() ?? rawValueString;
  const hasValueMatch = mergedChoices.includes(rawValueString) || mergedChoices.includes(rawBase);
  const isMissingValue = value !== null && value !== undefined && rawValueString !== '' && !hasValueMatch;
  const valueString = hasValueMatch
    ? (mergedChoices.includes(rawValueString) ? rawValueString : rawBase)
    : rawValueString;
  const selectOptions: SelectOption[] = [];
  if (value === null || hasNullChoice) {
    selectOptions.push({ value: NULL_OPTION_VALUE, label: 'None' });
  }
  if (isMissingValue) {
    selectOptions.push({ value: rawValueString, label: rawValueString, isMissing: true });
  }
  selectOptions.push(...mergedChoices.map((opt) => ({ value: opt, label: opt })));
  const selectedOption = selectOptions.find((opt) => opt.value === valueString) ?? null;

  const selectClassName = [
    'rs-container',
    hasBookmark ? 'rs-has-bookmark' : 'rs-no-bookmark',
    hasError ? 'rs-error' : '',
    isMissingValue ? 'rs-missing' : '',
    disabled ? 'rs-disabled' : ''
  ]
    .filter(Boolean)
    .join(' ');

  const menuPortalTarget = typeof document === 'undefined' ? null : document.body;

  const handleClose = () => {
    setInternalModalOpen(false);
    onModalClose?.();
  };

  const handleUploadClick = () => {
    if (disabled || isUploading) return;
    uploadInputRef.current?.click();
  };

  const handleUploadChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const result = await uploadImageFile(file, { type: imageFolder });
      const nextValue = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
      setUploadedChoices((prev) => (prev.includes(nextValue) ? prev : [...prev, nextValue]));
      onChange(nextValue);
    } catch (err) {
      console.error('Failed to upload image:', err);
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  const uploadButton = supportsImageUpload ? (
    <button
      type="button"
      className={`w-full py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${disabled || isUploading ? 'opacity-60 cursor-not-allowed border-gray-200 text-gray-400 bg-white' : 'border-gray-200 text-gray-700 bg-white hover:border-gray-300 hover:text-gray-900'}`}
      onClick={handleUploadClick}
      disabled={disabled || isUploading}
    >
      <span className="inline-flex items-center justify-center gap-2">
        <PlusIcon className="w-4 h-4" />
        {isUploading ? 'Uploading...' : 'Load from camera roll'}
      </span>
    </button>
  ) : null;

  if (useModalFlow) {
    return (
      <div className={containerClass}>
        {!hideLabel && (
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {name}
          </label>
        )}

        <div
          className={`relative w-full p-3 comfy-input text-base flex items-center justify-between min-h-[46px] ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${hasError ? 'border-red-700 ring-1 ring-red-700' : ''}`}
          onClick={() => !disabled && setInternalModalOpen(true)}
        >
          <span className={`truncate min-w-0 flex-1 ${!selectedOption ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-[#e5e7eb]'} ${hasBookmark ? 'pr-16' : 'pr-6'}`}>
            {selectedOption ? selectedOption.label : 'Select...'}
          </span>

          <div className="flex items-center absolute right-0 top-0 bottom-0 pointer-events-none">
            <div className="px-2 text-gray-400">
              <ChevronDownIcon className="w-5 h-5" />
            </div>
            {hasBookmark && (
              <div className="pointer-events-auto px-2">
                <BookmarkIcon isBookmarked={isBookmarked} onToggle={onToggleBookmark} />
              </div>
            )}
          </div>
        </div>

        {isMissingValue && (
          <div className="mt-1 text-xs text-red-700">
            Missing on ComfyUI server
          </div>
        )}
        {supportsImageUpload && (
          <div className="mt-2">
            {uploadButton}
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleUploadChange}
            />
          </div>
        )}

        <MobileWidgetModal
          title={name}
          isOpen={showModal}
          onClose={handleClose}
        >
          <Select<SelectOption, false>
            className={selectClassName}
            classNamePrefix="rs"
            options={selectOptions}
            value={selectedOption}
            onChange={(next) => {
              if (!next) return;
              onChange(next.value === NULL_OPTION_VALUE ? null : next.value);
              handleClose();
            }}
            isSearchable
            autoFocus={!forceModalOpen}
            menuIsOpen={forceModalOpen ? undefined : true}
            controlShouldRenderValue={true}
            placeholder="Search..."
            filterOption={createFilter({
              ignoreAccents: true,
              ignoreCase: true,
              trim: true,
              matchFrom: 'any'
            })}
            styles={{
              menu: (base) => ({
                ...base,
                position: 'static',
                boxShadow: 'none',
                border: 'none',
                marginTop: '0.5rem',
                borderRadius: 0,
                backgroundColor: 'transparent'
              }),
              menuList: (base) => ({
                ...base,
                maxHeight: 'calc(100vh - 160px)',
                height: 'auto',
                paddingBottom: '2rem',
                overflowY: 'auto',
                overflowX: 'auto',
                overscrollBehaviorY: 'contain',
                overscrollBehaviorX: 'contain',
                touchAction: 'pan-y'
              }),
              control: (base) => ({
                ...base,
                borderColor: '#3b82f6',
                boxShadow: '0 0 0 1px #3b82f6'
              })
            }}
            components={{
              DropdownIndicator: null,
              IndicatorSeparator: null
            }}
            noOptionsMessage={() => 'No matches'}
          />
        </MobileWidgetModal>
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
      <div className="relative rs-scroll-target" ref={selectWrapperRef}>
        <Select<SelectOption, false>
          className={selectClassName}
          classNamePrefix="rs"
          options={selectOptions}
          value={selectedOption}
          onChange={(next) => {
            if (!next) return;
            onChange(next.value === NULL_OPTION_VALUE ? null : next.value);
          }}
          isSearchable
          isDisabled={disabled}
          filterOption={createFilter({
            ignoreAccents: true,
            ignoreCase: true,
            trim: true,
            matchFrom: 'any'
          })}
          menuPortalTarget={menuPortalTarget}
          menuPosition="fixed"
          menuPlacement="bottom"
          menuShouldScrollIntoView={false}
          styles={{
            menuPortal: (base) => ({ ...base, zIndex: 200 }),
            menuList: (base) => ({
              ...base,
              overflowY: 'auto',
              overflowX: 'auto',
              overscrollBehaviorY: 'contain',
              overscrollBehaviorX: 'contain',
              touchAction: 'pan-y'
            })
          }}
          components={{
            DropdownIndicator: null,
            IndicatorSeparator: null
          }}
          noOptionsMessage={() => 'No matches'}
        />
        <div className="absolute right-0 top-0 bottom-0 flex items-center pointer-events-none">
          <ChevronDownIcon className="w-5 h-5 text-gray-500" />
          {hasBookmark && (
            <div className="pointer-events-auto px-2">
              <BookmarkIcon isBookmarked={isBookmarked} onToggle={onToggleBookmark} />
            </div>
          )}
          {!hasBookmark && <div className="w-3" />}
        </div>
      </div>
      {isMissingValue && (
        <div className="mt-1 text-xs text-red-700">
          Missing on ComfyUI server
        </div>
      )}
      {supportsImageUpload && (
        <div className="mt-2">
          {uploadButton}
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleUploadChange}
          />
        </div>
      )}
    </div>
  );
}

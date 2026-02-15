import type { Ref } from 'react';
import { SearchIcon, XMarkIcon } from '@/components/icons';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  readOnly?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  showClearButton?: boolean;
}

export function SearchBar({
  value,
  onChange,
  onClear,
  placeholder = 'Search...',
  autoFocus = false,
  className = '',
  inputClassName = '',
  disabled = false,
  readOnly = false,
  inputRef,
  showClearButton = true,
}: SearchBarProps) {
  const canClear = showClearButton && value.trim().length > 0 && !disabled && !readOnly;

  return (
    <div className={`relative ${className}`.trim()}>
      <SearchIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border border-gray-200 pl-9 pr-9 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${inputClassName}`.trim()}
        autoFocus={autoFocus}
        disabled={disabled}
        readOnly={readOnly}
      />
      {canClear && (
        <button
          type="button"
          onClick={() => {
            if (onClear) {
              onClear();
              return;
            }
            onChange('');
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
          aria-label="Clear search"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

import type { Ref } from 'react';
import { SearchIcon, XMarkIcon } from '@/components/icons';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  onSubmit?: (value: string) => void;
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
  onSubmit,
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
      <SearchIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onSubmit) {
            event.preventDefault();
            onSubmit(value);
          }
        }}
        placeholder={placeholder}
        data-swipe-nav-ignore="true"
        className={`w-full rounded-lg border border-white/10 bg-slate-950/80 pl-9 pr-9 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-transparent ${inputClassName}`.trim()}
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
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-100"
          aria-label="Clear search"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

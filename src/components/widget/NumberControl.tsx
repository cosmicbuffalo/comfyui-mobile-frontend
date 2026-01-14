import { BookmarkIcon } from './BookmarkIcon';

interface NumberControlProps {
  containerClass: string;
  name: string;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  hasBookmark: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  hasError?: boolean;
  min?: number;
  max?: number;
  step?: number;
  isInt: boolean;
}

export function NumberControl({
  containerClass,
  name,
  value,
  onChange,
  disabled = false,
  hideLabel = false,
  hasBookmark,
  isBookmarked = false,
  onToggleBookmark,
  hasError = false,
  min,
  max,
  step,
  isInt
}: NumberControlProps) {
  const handleNumberChange = (strVal: string) => {
    if (strVal === '') {
      onChange('');
      return;
    }
    const num = isInt ? parseInt(strVal, 10) : parseFloat(strVal);
    if (!isNaN(num)) {
      onChange(num);
    }
  };

  return (
    <div className={containerClass}>
      {!hideLabel && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {name}
        </label>
      )}
      <div className="relative">
        <input
          type="number"
          value={value === '' ? '' : Number(value ?? 0)}
          onChange={(e) => handleNumberChange(e.target.value)}
          min={min}
          max={max}
          step={step}
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

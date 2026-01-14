import { memo } from 'react';
import { BookmarkIcon } from './widget/BookmarkIcon';
import { ComboControl } from './widget/ComboControl';
import { NumberControl } from './widget/NumberControl';
import { StringControl } from './widget/StringControl';
import { DiceIcon, PlusIcon, XIconSolid } from '@/components/icons';

interface WidgetControlProps {
  name: string;
  type: string;
  value: unknown;
  options?: Record<string, unknown> | unknown[];
  onChange: (value: unknown) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  compact?: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
  /** Max height for textarea (makes it scrollable instead of auto-sizing) */
  maxHeight?: string;
  /** Show red border to indicate an error */
  hasError?: boolean;
  /** Force the mobile modal to be open (e.g. for bookmark view) */
  forceModalOpen?: boolean;
  /** Callback when the modal is closed via the UI */
  onModalClose?: () => void;
}

export const WidgetControl = memo(function WidgetControl({
  name,
  type,
  value,
  options,
  onChange,
  disabled = false,
  hideLabel = false,
  compact = false,
  isBookmarked = false,
  onToggleBookmark,
  maxHeight,
  hasError = false,
  forceModalOpen = false,
  onModalClose
}: WidgetControlProps) {
  const containerClass = compact ? 'mb-0' : 'mb-3';
  // Only show bookmark icon space when actually bookmarked
  const hasBookmark = isBookmarked && !!onToggleBookmark;
  // Error border class for inputs
  const errorBorderClass = hasError ? 'border-red-700 ring-1 ring-red-700' : '';

  const getOption = (key: string): unknown => {
    if (Array.isArray(options)) return undefined;
    return options?.[key];
  };

  const handleSeedChange = (strVal: string) => {
    if (strVal === '') {
      onChange('');
      return;
    }
    const num = parseInt(strVal, 10);
    if (!isNaN(num)) {
      onChange(num);
    }
  };

  // Power Lora Loader Header (Toggle All)
  if (type === 'POWER_LORA_HEADER') {
    return (
      <div className={`${containerClass} flex items-center justify-between p-3 bg-blue-50/50 dark:bg-blue-900/20 rounded-lg`}>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            // We don't have a single value for this, it's a toggle-all action
            onChange={(e) => onChange(e.target.checked)}
            className="w-5 h-5 rounded cursor-pointer"
            disabled={disabled}
          />
          <span className="text-sm font-semibold text-blue-900 dark:text-blue-100 uppercase tracking-wider">
            Toggle All Loras
          </span>
        </div>
      </div>
    );
  }

  // Power Lora Loader Row
  if (type === 'POWER_LORA') {
    const loraValue = (value as { on: boolean; lora: string; strength: number; strengthTwo?: number }) || {
      on: true,
      lora: '',
      strength: 1.0,
    };

    const loraOptions = (options as { choices?: unknown[]; showSeparate?: boolean }) || {};
    const choices = loraOptions.choices;
    const showSeparate = loraOptions.showSeparate;

    const handleSubChange = (key: string, val: unknown) => {
      onChange({
        ...loraValue,
        [key]: val,
      });
    };

    return (
      <div className={`${containerClass} flex flex-col gap-2 p-3 border border-gray-200 dark:border-gray-800 rounded-lg bg-gray-50/50 dark:bg-gray-900/50`}>
        <div className="flex items-center gap-3">
          {/* Enabled Toggle */}
          <div className="flex-shrink-0">
            <input
              type="checkbox"
              checked={loraValue.on}
              onChange={(e) => handleSubChange('on', e.target.checked)}
              className="w-5 h-5 rounded cursor-pointer"
              disabled={disabled}
            />
          </div>

          {/* Lora Selector */}
          <div className="flex-grow min-w-0">
            <WidgetControl
              name=""
              hideLabel
              compact
              type="COMBO"
              value={loraValue.lora}
              options={choices}
              onChange={(val) => handleSubChange('lora', val)}
              disabled={disabled}
            />
          </div>

          {/* Delete Button */}
          <button
            onClick={() => onChange(null)}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 transition-colors"
            title="Remove Lora"
            disabled={disabled}
          >
            <XIconSolid className="w-5 h-5" />
          </button>
        </div>

        {/* Strength Slider/Input(s) */}
        <div className="flex flex-col gap-2 pl-8">
           <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-gray-400 uppercase w-16">
                {showSeparate ? 'Model' : 'Strength'}
              </span>
              <div className="flex-grow">
                 <WidgetControl
                   name=""
                   hideLabel
                   compact
                   type="FLOAT"
                   value={loraValue.strength}
                   options={{ min: -10, max: 10, step: 0.01 }}
                   onChange={(val) => handleSubChange('strength', val)}
                   disabled={disabled}
                 />
              </div>
           </div>
           
           {showSeparate && (
             <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold text-gray-400 uppercase w-16">Clip</span>
                <div className="flex-grow">
                   <WidgetControl
                     name=""
                     hideLabel
                     compact
                     type="FLOAT"
                     value={loraValue.strengthTwo ?? loraValue.strength}
                     options={{ min: -10, max: 10, step: 0.01 }}
                     onChange={(val) => handleSubChange('strengthTwo', val)}
                     disabled={disabled}
                   />
                </div>
             </div>
           )}
        </div>
      </div>
    );
  }

  // Power Lora Add Button
  if (type === 'POWER_LORA_ADD') {
    return (
      <div className={containerClass}>
        <button
          onClick={() => {
            // Default new Lora object
            onChange({
              on: true,
              lora: 'None',
              strength: 1.0,
              model_strength: 1.0,
              clip_strength: 1.0,
            });
          }}
          className="w-full py-2 px-4 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-500 hover:text-blue-500 hover:border-blue-500 transition-all flex items-center justify-center gap-2"
          disabled={disabled}
        >
          <PlusIcon className="w-5 h-5" />
          Add Lora
        </button>
      </div>
    );
  }

  if (type === 'STRING') {
    return (
      <StringControl
        containerClass={containerClass}
        name={name}
        value={value}
        options={options}
        onChange={onChange}
        disabled={disabled}
        hideLabel={hideLabel}
        hasBookmark={hasBookmark}
        isBookmarked={isBookmarked}
        onToggleBookmark={onToggleBookmark}
        maxHeight={maxHeight}
        hasError={hasError}
        forceModalOpen={forceModalOpen}
        onModalClose={onModalClose}
      />
    );
  }

  // Integer input
  if (type === 'INT') {
    return (
      <NumberControl
        containerClass={containerClass}
        name={name}
        value={value}
        onChange={onChange}
        disabled={disabled}
        hideLabel={hideLabel}
        hasBookmark={hasBookmark}
        isBookmarked={isBookmarked}
        onToggleBookmark={onToggleBookmark}
        hasError={hasError}
        min={getOption('min') as number | undefined}
        max={getOption('max') as number | undefined}
        step={(getOption('step') as number | undefined) ?? 1}
        isInt
      />
    );
  }

  // Float input
  if (type === 'FLOAT') {
    return (
      <NumberControl
        containerClass={containerClass}
        name={name}
        value={value}
        onChange={onChange}
        disabled={disabled}
        hideLabel={hideLabel}
        hasBookmark={hasBookmark}
        isBookmarked={isBookmarked}
        onToggleBookmark={onToggleBookmark}
        hasError={hasError}
        min={getOption('min') as number | undefined}
        max={getOption('max') as number | undefined}
        step={(getOption('step') as number | undefined) ?? 0.01}
        isInt={false}
      />
    );
  }

  // Boolean input
  if (type === 'BOOLEAN') {
    return (
      <div className={containerClass}>
        <div className={`flex items-center justify-between min-h-[44px] p-3 rounded-lg bg-white ${errorBorderClass}`}>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
              className="w-6 h-6 rounded"
              disabled={disabled}
            />
            <span className="text-base font-medium text-gray-700">{name}</span>
          </label>
          {hasBookmark && (
            <BookmarkIcon isBookmarked={isBookmarked} onToggle={onToggleBookmark} />
          )}
        </div>
      </div>
    );
  }

  // Combo/dropdown
  if (type === 'COMBO' || Array.isArray(options) || (options && !Array.isArray(options) && 'options' in options)) {
    return (
      <ComboControl
        containerClass={containerClass}
        name={name}
        value={value}
        options={options}
        onChange={onChange}
        disabled={disabled}
        hideLabel={hideLabel}
        hasBookmark={hasBookmark}
        isBookmarked={isBookmarked}
        onToggleBookmark={onToggleBookmark}
        hasError={hasError}
        forceModalOpen={forceModalOpen}
        onModalClose={onModalClose}
      />
    );
  }

  // Seed input (special handling for large integers)
  if (name.toLowerCase().includes('seed')) {
    return (
      <div className={containerClass}>
        {!hideLabel && (
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {name}
          </label>
        )}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="number"
              value={value === '' ? '' : Number(value ?? 0)}
              onChange={(e) => handleSeedChange(e.target.value)}
              className={`w-full p-3 comfy-input text-base ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${hasBookmark ? 'pr-16' : ''}`}
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
          <button
            onClick={() => onChange(Math.floor(Math.random() * 2147483647))}
            className={`px-4 py-2 bg-gray-200 rounded-lg text-sm font-medium min-w-[44px] min-h-[44px] ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            title="Randomize"
            disabled={disabled}
          >
            <DiceIcon className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>
    );
  }

  // Unknown type - show as text
  return (
    <div className={containerClass}>
      {!hideLabel && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {name} ({type})
        </label>
      )}
      <div className="relative">
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full p-3 comfy-input text-base ${disabled ? 'opacity-60 cursor-not-allowed' : ''} ${hasBookmark ? 'pr-16' : ''}`}
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
});

import { useState, useEffect } from "react";
import { MinusIcon, PlusIcon } from "../icons";

interface NumberControlProps {
  containerClass?: string;
  name: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
  type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: any;
  min?: number;
  max?: number;
  step?: number;
  isInt?: boolean;
  hasError?: boolean;
  // Reserved for future seed mode UI
  seedMode?: "fixed" | "randomize" | "increment" | "decrement";
  onSeedModeChange?: (
    mode: "fixed" | "randomize" | "increment" | "decrement",
  ) => void;
}

export function NumberControl({
  containerClass,
  name,
  value,
  options,
  onChange,
  disabled,
  type,
  min: minProp,
  max: maxProp,
  step: stepProp,
  isInt: isIntProp,
  hasError = false,
}: NumberControlProps) {
  const [localValue, setLocalValue] = useState(String(value || 0));
  const isInt =
    isIntProp ??
    (type ? type.toUpperCase() === "INT" : Number.isInteger(value));
  const step = stepProp ?? options?.step ?? (isInt ? 1 : 0.1);
  const min = minProp ?? (options?.min !== undefined ? options.min : -Infinity);
  const max = maxProp ?? (options?.max !== undefined ? options.max : Infinity);

  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  };

  const handleBlur = () => {
    let num = isInt ? parseInt(localValue, 10) : parseFloat(localValue);
    if (isNaN(num)) num = value;
    num = Math.max(min, Math.min(max, num));
    onChange(num);
    setLocalValue(String(num));
  };

  const adjust = (delta: number) => {
    const num =
      (isInt ? parseInt(localValue, 10) : parseFloat(localValue)) || 0;
    const next = Math.max(min, Math.min(max, num + delta));
    onChange(next);
  };

  const inputClassName = [
    `number-input-field-${name}`,
    "w-full p-3 comfy-input text-base text-gray-900",
    disabled ? "opacity-60 cursor-not-allowed" : "",
    hasError ? "border-red-700 ring-1 ring-red-700" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const buttonClassName = [
    "w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 text-gray-700 flex-shrink-0",
    disabled
      ? "opacity-60 cursor-not-allowed"
      : "active:scale-95 transition-all",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`${containerClass ?? ""} number-control-${name}`}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {name}
      </label>
      <div
        className={`number-stepper-container-${name} flex items-center gap-2`}
      >
        <input
          className={inputClassName}
          type="number"
          value={localValue}
          onChange={handleInputChange}
          onBlur={handleBlur}
          disabled={disabled}
          aria-label={type ? `${name} ${type}` : name}
        />

        <button
          type="button"
          onClick={() => adjust(-step)}
          className={buttonClassName}
          aria-label="Decrease value"
          disabled={disabled}
        >
          <MinusIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => adjust(step)}
          className={buttonClassName}
          aria-label="Increase value"
          disabled={disabled}
        >
          <PlusIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

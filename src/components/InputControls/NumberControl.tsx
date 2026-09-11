import { useState, useEffect, type ReactNode } from "react";
import { MinusIcon, PlusIcon } from "../icons";
import {
  controlInputBaseClassName,
  controlInputDarkClassName,
  controlInputFocusClassNameForState,
  controlStateClassName,
} from "./controlStyles";
import { ControlLabelRow } from "./ControlLabelRow";
import { useI18n } from "@/i18n";
import { FullscreenWidgetModal } from "../modals/FullscreenWidgetModal";

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
  hideLabel?: boolean;
  displayLabel?: string;
  hasError?: boolean;
  isPromoted?: boolean;
  labelAccessory?: ReactNode;
  /** "⇠ slot" boundary annotation and its jump — see ControlLabelRow. */
  boundaryAnnotation?: string;
  onBoundaryJump?: () => void;
  forceModalOpen?: boolean;
  onModalClose?: () => void;
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
  hideLabel = false,
  displayLabel,
  hasError = false,
  isPromoted = false,
  labelAccessory,
  boundaryAnnotation,
  onBoundaryJump,
  forceModalOpen = false,
  onModalClose,
}: NumberControlProps) {
  const { t } = useI18n();
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
    controlInputBaseClassName,
    controlInputDarkClassName,
    controlInputFocusClassNameForState(isPromoted),
    controlStateClassName({ disabled, hasError, isPromoted }),
  ]
    .filter(Boolean)
    .join(" ");

  // `select-none` on the steppers, not just the app-wide callout suppression in
  // index.css: holding one of these on iOS starts a text selection that spills
  // onto the number beside it, leaving the field highlighted blue and the
  // selection handles on screen. The <input> itself stays selectable — that is
  // how you edit the value by hand — so this cannot be lifted to the row.
  // `touch-manipulation` drops the 300ms double-tap delay along the way.
  const buttonClassName = [
    "w-10 h-10 flex select-none touch-manipulation items-center justify-center rounded-full bg-slate-950/80 border border-white/10 text-slate-200 flex-shrink-0",
    disabled
      ? "opacity-60 cursor-not-allowed"
      : "active:scale-95 transition-all",
  ]
    .filter(Boolean)
    .join(" ");

  const control = (
    <div className={`${containerClass ?? ""} number-control-${name} pt-2`}>
      {!hideLabel && (
        <ControlLabelRow
          name={name}
          displayLabel={displayLabel}
          isPromoted={isPromoted}
          boundaryAnnotation={boundaryAnnotation}
          onBoundaryJump={onBoundaryJump}
          labelAccessory={labelAccessory}
        />
      )}

      <div
        className={`number-stepper-container-${name} flex items-center gap-2`}
      >
        <input
          className={inputClassName}
          type="number"
          value={localValue}
          onChange={handleInputChange}
          onBlur={handleBlur}
          data-swipe-nav-ignore="true"
          disabled={disabled}
          aria-label={type ? `${name} ${type}` : name}
        />

        <button
          type="button"
          onClick={() => adjust(-step)}
          className={buttonClassName}
          aria-label={t("Decrease value")}
          disabled={disabled}
        >
          <MinusIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => adjust(step)}
          className={buttonClassName}
          aria-label={t("Increase value")}
          disabled={disabled}
        >
          <PlusIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  if (!forceModalOpen) return control;
  return (
    <FullscreenWidgetModal
      isOpen
      title={displayLabel ?? name}
      onClose={() => onModalClose?.()}
      viewerSidebar
    >
      {control}
    </FullscreenWidgetModal>
  );
}

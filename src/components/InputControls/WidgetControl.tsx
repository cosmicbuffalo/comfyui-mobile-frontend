import { StringControl } from "./StringControl";
import { NumberControl } from "./NumberControl";
import { ComboControl } from "./ComboControl";
import { FullscreenWidgetModal } from "../modals/FullscreenWidgetModal";
import { useState } from "react";
import { PlusIcon, WarningTriangleIcon } from "../icons";
import { createDefaultLoraEntry, normalizeLoraEntry } from "@/utils/loraManager";
import { normalizeTriggerWordEntry } from "@/utils/triggerWordToggle";

interface WidgetControlProps {
  name: string;
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (value: any) => void;
  disabled?: boolean;
  hasError?: boolean;
  hideLabel?: boolean;
  compact?: boolean;
  forceModalOpen?: boolean;
  onModalClose?: () => void;
  seedMode?: "fixed" | "randomize" | "increment" | "decrement";
  onSeedModeChange?: (
    mode: "fixed" | "randomize" | "increment" | "decrement",
  ) => void;
  hasPin?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  containerClass?: string;
}

export function WidgetControl({
  name,
  type,
  value,
  options,
  onChange,
  disabled = false,
  hasError = false,
  hideLabel = false,
  compact = false,
  forceModalOpen = false,
  onModalClose,
  seedMode,
  onSeedModeChange,
  hasPin,
  isPinned = false,
  onTogglePin,
  containerClass,
}: WidgetControlProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const handleOpenModal = () => {
    if (disabled) return;
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    onModalClose?.();
  };

  const isCombo = type === "COMBO" || Array.isArray(options?.options);
  const isNumber = ["INT", "FLOAT"].includes(type.toUpperCase());
  const isString = type.toUpperCase() === "STRING";

  const label = name.replace(/_/g, " ");

  const resolvedHasPin =
    hasPin ?? (Boolean(onTogglePin) || isPinned);
  const controlContainerClass = containerClass ?? "space-y-2 w-full";
  const layoutContainerClass = containerClass ?? (compact ? "mb-0" : "mb-3");

  const controlProps = {
    name,
    value,
    options,
    onChange,
    disabled,
    hideLabel,
    hasError,
    forceModalOpen,
    onModalClose,
    containerClass: controlContainerClass,
    hasPin: resolvedHasPin,
    isPinned,
    onTogglePin,
  };

  const renderControl = () => {
    if (isCombo) return <ComboControl {...controlProps} />;
    if (isNumber)
      return (
        <NumberControl
          {...controlProps}
          type={type}
          seedMode={seedMode}
          onSeedModeChange={onSeedModeChange}
        />
      );
    if (isString) return <StringControl {...controlProps} />;
    return (
      <div className="unsupported-widget-type text-xs text-gray-400 italic">
        Unsupported: {type}
      </div>
    );
  };

  const effectiveModalOpen = forceModalOpen || modalOpen;

  if (type === "LM_LORA_HEADER") {
    const allActive = Boolean(value);
    return (
      <div
        className={`${layoutContainerClass} lm-lora-header flex items-center justify-between p-3 bg-blue-50/50 dark:bg-blue-900/20 rounded-lg`}
      >
        <div className="lm-lora-header-content flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={allActive}
            onClick={() => onChange(!allActive)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
              allActive ? "bg-blue-600" : "bg-gray-300"
            } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
            disabled={disabled}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                allActive ? "translate-x-5" : "translate-x-1"
              }`}
            />
          </button>
          <span className="lm-lora-header-label text-sm font-semibold text-blue-900 dark:text-blue-100 uppercase tracking-wider">
            Toggle All Loras
          </span>
        </div>
      </div>
    );
  }

  if (type === "LM_LORA") {
    const loraValue = normalizeLoraEntry(
      (value as {
        name: string;
        strength: number | string;
        clipStrength?: number | string;
        active?: boolean;
        expanded?: boolean;
        locked?: boolean;
      }) || {
        name: "",
        strength: 1.0,
        clipStrength: 1.0,
        active: true,
        expanded: false,
      },
    );
    const loraOptions = (options as { choices?: unknown[] }) || {};
    const choices = Array.isArray(loraOptions.choices)
      ? loraOptions.choices.map((choice) => String(choice))
      : [];
    const showClip =
      Boolean(loraValue.expanded) ||
      Math.abs(
        Number(loraValue.clipStrength ?? loraValue.strength) -
          Number(loraValue.strength),
      ) > Number.EPSILON;

    const handleEntryChange = (patch: Record<string, unknown>) => {
      const next = {
        ...loraValue,
        ...patch,
      } as Record<string, unknown>;
      if (!next.expanded) {
        next.clipStrength = next.strength;
      } else if (next.clipStrength === undefined) {
        next.clipStrength = next.strength;
      }
      onChange(next);
    };

    const handleToggleExpanded = () => {
      const nextExpanded = !loraValue.expanded;
      handleEntryChange({
        expanded: nextExpanded,
        clipStrength: nextExpanded
          ? loraValue.clipStrength ?? loraValue.strength
          : loraValue.strength,
      });
    };

    return (
      <div
        className={`${layoutContainerClass} lm-lora-row flex flex-col gap-3 p-3 border border-gray-200 dark:border-gray-800 rounded-lg bg-gray-50/50 dark:bg-gray-900/50 ${!loraValue.active ? "opacity-60" : ""}`}
      >
        <div className="lm-lora-row-actions flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              handleEntryChange({ active: !loraValue.active })
            }
            className={`lm-lora-enabled-button flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${loraValue.active ? "bg-blue-600 text-white" : "bg-gray-700 text-white"} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
            disabled={disabled}
          >
            {loraValue.active ? "Enabled" : "Disabled"}
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            className={`lm-lora-remove-button flex-1 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
            disabled={disabled}
          >
            Remove
          </button>
        </div>

        <div className="lm-lora-row-header flex items-center gap-3">
          <div className="lm-lora-select flex-grow min-w-0">
            {choices.length > 0 ? (
              <ComboControl
                containerClass="space-y-0 w-full"
                name=""
                hideLabel
                value={loraValue.name}
                options={{
                  options: choices,
                  stripSafetensorsSuffix: true,
                }}
                onChange={(val) => handleEntryChange({ name: String(val) })}
                disabled={disabled}
                hasPin={false}
              />
            ) : (
              <StringControl
                containerClass="space-y-0 w-full"
                name=""
                hideLabel
                value={loraValue.name}
                options={{ placeholder: "LoRA name" }}
                onChange={(val) => handleEntryChange({ name: String(val) })}
                disabled={disabled}
                hasPin={false}
              />
            )}
          </div>
        </div>

        <div className="lm-lora-strengths flex flex-col gap-2">
          <NumberControl
            containerClass="space-y-0"
            name={showClip ? "Model strength" : "Strength"}
            value={Number(loraValue.strength)}
            options={{ min: -10, max: 10, step: 0.01 }}
            onChange={(val) => handleEntryChange({ strength: val })}
            disabled={disabled}
            type="FLOAT"
          />

          {showClip && (
            <NumberControl
              containerClass="space-y-0"
              name="Clip strength"
              value={Number(loraValue.clipStrength ?? loraValue.strength)}
              options={{ min: -10, max: 10, step: 0.01 }}
              onChange={(val) => handleEntryChange({ clipStrength: val })}
              disabled={disabled}
              type="FLOAT"
            />
          )}

          <button
            type="button"
            onClick={handleToggleExpanded}
            className={`lm-lora-clip-toggle py-2 px-3 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:text-blue-600 hover:border-blue-500 transition ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
            disabled={disabled}
          >
            {showClip ? "Hide clip strength" : "Separate clip strength"}
          </button>
        </div>
      </div>
    );
  }

  if (type === "LM_LORA_ADD") {
    const loraOptions = (options as { choices?: unknown[] }) || {};
    const handleLoraAddClick = () => {
      onChange(createDefaultLoraEntry(loraOptions.choices));
    };

    return (
      <div className={`${layoutContainerClass} lm-lora-add`}>
        <button
          onClick={handleLoraAddClick}
          className="w-full py-2 px-4 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-500 hover:text-blue-500 hover:border-blue-500 transition-all flex items-center justify-center gap-2"
          disabled={disabled}
        >
          <PlusIcon className="w-5 h-5" />
          Add Lora
        </button>
      </div>
    );
  }

  if (type === "TW_WORD") {
    const triggerOptions = (options as { allowStrengthAdjustment?: boolean }) || {};
    const allowStrength = Boolean(triggerOptions.allowStrengthAdjustment);
    const triggerValue = normalizeTriggerWordEntry(
      (value as {
        text: string;
        active?: boolean;
        strength?: number | string | null;
        highlighted?: boolean;
      }) || {
        text: "",
        active: true,
        strength: null,
      },
      { allowStrengthAdjustment: allowStrength }
    );

    const handleEntryChange = (patch: Record<string, unknown>) => {
      const next = {
        ...triggerValue,
        ...patch,
      } as Record<string, unknown>;
      if (!allowStrength) {
        next.strength = null;
      }
      onChange(next);
    };

    return (
      <div
        className={`${layoutContainerClass} tw-word-row flex flex-col gap-2 p-3 border border-gray-200 dark:border-gray-800 rounded-lg bg-gray-50/60 dark:bg-gray-900/50 ${!triggerValue.active ? "opacity-60" : ""}`}
      >
        <div className="tw-word-header flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 break-words">
              {triggerValue.text || "Trigger Word"}
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              handleEntryChange({ active: !triggerValue.active })
            }
            className={`tw-word-toggle px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${triggerValue.active ? "bg-blue-600 text-white" : "bg-gray-700 text-white"} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
            disabled={disabled}
          >
            {triggerValue.active ? "Enabled" : "Disabled"}
          </button>
        </div>

        {allowStrength && (
          <NumberControl
            containerClass="space-y-0"
            name="Strength"
            value={Number(triggerValue.strength ?? 1)}
            options={{ min: 0, max: 10, step: 0.01 }}
            onChange={(val) => handleEntryChange({ strength: val })}
            disabled={disabled}
            type="FLOAT"
          />
        )}
      </div>
    );
  }

  if (type === "POWER_LORA_HEADER") {
    return (
      <div
        className={`${layoutContainerClass} power-lora-header flex items-center justify-between p-3 bg-blue-50/50 dark:bg-blue-900/20 rounded-lg`}
      >
        <div className="power-lora-header-content flex items-center gap-3">
          <input
            type="checkbox"
            onChange={(e) => onChange(e.target.checked)}
            className="w-5 h-5 rounded cursor-pointer"
            disabled={disabled}
          />
          <span className="power-lora-header-label text-sm font-semibold text-blue-900 dark:text-blue-100 uppercase tracking-wider">
            Toggle All Loras
          </span>
        </div>
      </div>
    );
  }

  if (type === "POWER_LORA") {
    const loraValue = (value as {
      on: boolean;
      lora: string;
      strength: number;
      strengthTwo?: number;
    }) || {
      on: true,
      lora: "",
      strength: 1.0,
    };
    const loraOptions =
      (options as { choices?: unknown[]; showSeparate?: boolean }) || {};
    const choices = loraOptions.choices;
    const showSeparate = loraOptions.showSeparate;

    const handleSubChange = (key: string, val: unknown) => {
      onChange({
        ...loraValue,
        [key]: val,
      });
    };

    return (
      <div
        className={`${layoutContainerClass} power-lora-row flex flex-col gap-2 p-3 border border-gray-200 dark:border-gray-800 rounded-lg bg-gray-50/50 dark:bg-gray-900/50 ${!loraValue.on ? "opacity-60" : ""}`}
      >
        <div className="power-lora-row-actions flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleSubChange("on", !loraValue.on)}
            className={`power-lora-enabled-button flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${loraValue.on ? "bg-blue-600 text-white" : "bg-gray-700 text-white"} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
            disabled={disabled}
          >
            {loraValue.on ? "Enabled" : "Disabled"}
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            className={`power-lora-remove-button flex-1 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
            disabled={disabled}
          >
            Remove
          </button>
        </div>

        <div className="power-lora-row-header flex items-center gap-3">
          <div className="power-lora-select flex-grow min-w-0">
            <WidgetControl
              name=""
              hideLabel
              compact
              type="COMBO"
              value={loraValue.lora}
              options={choices}
              onChange={(val) => handleSubChange("lora", val)}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="power-lora-strengths flex flex-col">
          <label className="block text-sm font-medium text-gray-700 ml-1">
            {showSeparate ? "Model strength" : "Strength"}
          </label>
          <div className="power-lora-strength-row flex items-center gap-3">
            <div className="power-lora-strength-input flex-grow">
              <WidgetControl
                name=""
                hideLabel
                compact
                type="FLOAT"
                value={loraValue.strength}
                options={{ min: -10, max: 10, step: 0.01 }}
                onChange={(val) => handleSubChange("strength", val)}
                disabled={disabled}
              />
            </div>
          </div>

          {showSeparate && (
            <label className="block text-sm font-medium text-gray-700 ml-1">
              Clip strength
            </label>
          )}
          {showSeparate && (
            <div className="power-lora-strength-row flex items-center gap-3">
              <div className="power-lora-strength-input flex-grow">
                <WidgetControl
                  name=""
                  hideLabel
                  compact
                  type="FLOAT"
                  value={loraValue.strengthTwo ?? loraValue.strength}
                  options={{ min: -10, max: 10, step: 0.01 }}
                  onChange={(val) => handleSubChange("strengthTwo", val)}
                  disabled={disabled}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (type === "POWER_LORA_ADD") {
    const handlePowerLoraAddClick = () => {
      onChange({
        on: true,
        lora: "None",
        strength: 1.0,
        model_strength: 1.0,
        clip_strength: 1.0,
      });
    };

    return (
      <div className={`${layoutContainerClass} power-lora-add`}>
        <button
          onClick={handlePowerLoraAddClick}
          className="w-full py-2 px-4 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-500 hover:text-blue-500 hover:border-blue-500 transition-all flex items-center justify-center gap-2"
          disabled={disabled}
        >
          <PlusIcon className="w-5 h-5" />
          Add Lora
        </button>
      </div>
    );
  }

  if (isString) {
    return <StringControl {...controlProps} />;
  }

  if (isCombo) {
    return <ComboControl {...controlProps} />;
  }

  if (isNumber) {
    return (
      <NumberControl
        {...controlProps}
        type={type}
        seedMode={seedMode}
        onSeedModeChange={onSeedModeChange}
      />
    );
  }

  if (type.toUpperCase() === "BOOLEAN") {
    return (
      <ComboControl
        {...controlProps}
        value={String(Boolean(value))}
        options={["true", "false"]}
        onChange={(nextValue) =>
          onChange(String(nextValue).toLowerCase() === "true")
        }
      />
    );
  }

  return (
    <div
      id={`widget-control-${name}`}
      className={`widget-control-root ${compact ? "compact-control" : ""}`}
    >
      {!hideLabel && (
        <div
          id={`widget-label-container-${name}`}
          className="flex items-center justify-between mb-1.5 px-1"
        >
          <label
            id={`widget-label-${name}`}
            className="text-[10px] font-bold text-gray-500 uppercase tracking-wider truncate mr-2"
          >
            {label}
          </label>
          {hasError && (
            <div
              id={`widget-error-icon-${name}`}
              className="text-red-500"
              title="Error in this input"
            >
              <WarningTriangleIcon className="w-3.5 h-3.5" />
            </div>
          )}
        </div>
      )}

      <div
        id={`widget-trigger-${name}`}
        className={`
          control-trigger
          relative flex items-center justify-between
          bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5
          active:bg-gray-100 active:border-gray-300 transition-all
          ${disabled ? "opacity-50 grayscale pointer-events-none" : "cursor-pointer"}
          ${hasError ? "border-red-300 bg-red-50/30" : ""}
        `}
        onClick={handleOpenModal}
      >
        <div
          id={`widget-value-display-${name}`}
          className="value-display flex-1 truncate text-sm font-medium text-gray-900"
        >
          {isCombo
            ? value || "Select..."
            : value !== undefined && value !== null
              ? String(value)
              : "Empty"}
        </div>
      </div>

      <FullscreenWidgetModal
        isOpen={effectiveModalOpen}
        title={label}
        onClose={handleCloseModal}
      >
        <div id={`modal-control-wrapper-${name}`} className="p-2">
          {renderControl()}
        </div>
      </FullscreenWidgetModal>
    </div>
  );
}

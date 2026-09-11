import { StringControl } from "./StringControl";
import { NumberControl } from "./NumberControl";
import { ComboControl } from "./ComboControl";
import { ModelComboControl } from "./ModelComboControl";
import { FullscreenWidgetModal } from "../modals/FullscreenWidgetModal";
import { useState, type ReactNode } from "react";
import { PlusIcon, PromotedWidgetIcon, WarningTriangleIcon } from "../icons";
import { createDefaultLoraEntry, normalizeLoraEntry } from "@/utils/loraManager";
import { normalizeTriggerWordEntry } from "@/utils/triggerWordToggle";
import { modelWidgetKind } from "@/utils/modelWidgetKind";
import type { LoraManagerPrefix } from "@/api/loraManagerClient";
import {
  controlDangerButtonClassName,
  controlDashedButtonClassName,
  controlGhostButtonClassName,
  controlNestedSurfaceClassName,
  controlToggleButtonClassName,
} from "./controlStyles";
import { useI18n } from "@/i18n";
import { usePinnedWidgetStore } from "@/hooks/usePinnedWidget";

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
  compactTrailingControls?: boolean;
  seedMode?: "fixed" | "randomize" | "increment" | "decrement";
  onSeedModeChange?: (
    mode: "fixed" | "randomize" | "increment" | "decrement",
  ) => void;
  hasPin?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  containerClass?: string;
  isPromoted?: boolean;
  /** Small control rendered inline right after the widget's label text. */
  labelAccessory?: ReactNode;
  /** "⇠ slot" boundary annotation and its jump — see ControlLabelRow. */
  boundaryAnnotation?: string;
  onBoundaryJump?: () => void;
  /**
   * Renamed label to show in place of the widget's name. Display only: `name`
   * stays the widget's real name, which is what values, pins and model-kind
   * detection are keyed by.
   */
  displayLabel?: string;
  /**
   * Explicit Lora Manager catalog for this widget. Use when the widget name has
   * been renamed for display (e.g. CR LoRA Stack shows "Selected LoRA") so that
   * name-based detection can't infer it. Omit to auto-detect from the name.
   */
  modelKind?: LoraManagerPrefix | null;
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
  compactTrailingControls,
  seedMode,
  onSeedModeChange,
  hasPin,
  isPinned = false,
  onTogglePin,
  containerClass,
  isPromoted = false,
  labelAccessory,
  boundaryAnnotation,
  onBoundaryJump,
  displayLabel,
  modelKind,
}: WidgetControlProps) {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const setPinOverlayOpen = usePinnedWidgetStore((s) => s.setPinOverlayOpen);

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

  // Resolve which Lora Manager catalog (if any) backs this widget: explicit prop
  // wins (renamed widgets like CR LoRA Stack's "Selected LoRA"), else LM_LORA is
  // loras, else auto-detect from the widget name. ModelComboControl handles the
  // actual metadata loading/lookup.
  // Promoted/proxy subgraph widgets render under a display label, so name-based
  // detection misses them; the widget def stashes the kind detected from the
  // real inner input name in options.__modelKind for those cases.
  const stashedModelKind = (options as Record<string, unknown> | undefined)
    ?.__modelKind as LoraManagerPrefix | undefined;
  const resolvedModelKind: LoraManagerPrefix | null =
    modelKind !== undefined
      ? modelKind
      : type === "LM_LORA"
        ? "loras"
        : isCombo
          ? (stashedModelKind ?? modelWidgetKind(name))
          : null;

  const label = displayLabel ?? name.replace(/_/g, " ");

  const resolvedHasPin =
    hasPin ?? (Boolean(onTogglePin) || isPinned);
  // A pinned workflow control and the bottom-bar pin button must address one
  // editor instance. Route a direct tap on the original control into the global
  // pin overlay; otherwise its local modal would be invisible to the button and
  // the next button tap would stack a duplicate editor on top.
  const onRequestModalOpen = isPinned && !forceModalOpen
    ? () => setPinOverlayOpen(true)
    : undefined;
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
    isPromoted,
    forceModalOpen,
    onRequestModalOpen,
    onModalClose,
    compactTrailingControls,
    containerClass: controlContainerClass,
    hasPin: resolvedHasPin,
    isPinned,
    onTogglePin,
    labelAccessory,
    boundaryAnnotation,
    onBoundaryJump,
    displayLabel,
  };

  const renderControl = () => {
    if (isCombo)
      return <ModelComboControl {...controlProps} modelKind={resolvedModelKind} />;
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
      <div className="unsupported-widget-type text-xs text-slate-400 italic">
        {t('Unsupported: {type}', { type })}
      </div>
    );
  };

  const effectiveModalOpen = forceModalOpen || modalOpen;

  if (type === "LM_LORA_HEADER") {
    const allActive = Boolean(value);
    return (
      <div
        className={`${layoutContainerClass} lm-lora-header flex items-center justify-between p-3 bg-cyan-500/10 border border-cyan-400/20 rounded-lg`}
      >
        <div className="lm-lora-header-content flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={allActive}
            onClick={() => onChange(!allActive)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
              allActive ? "bg-cyan-500" : "bg-slate-700"
            } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
            disabled={disabled}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                allActive ? "translate-x-5" : "translate-x-1"
              }`}
            />
          </button>
          <span className="lm-lora-header-label text-sm font-semibold text-cyan-300 uppercase tracking-wider">
            {t('Toggle All Loras')}
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
    const loraActive = Boolean(loraValue.active);

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
        className={`${layoutContainerClass} lm-lora-row flex flex-col gap-3 p-3 ${controlNestedSurfaceClassName} ${!loraActive ? "opacity-60" : ""}`}
      >
        <div className="lm-lora-row-actions flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              handleEntryChange({ active: !loraActive })
            }
            className={`lm-lora-enabled-button flex-1 py-2 text-sm ${controlToggleButtonClassName({ active: loraActive, disabled })}`}
            disabled={disabled}
          >
            {loraActive ? t("Enabled") : t("Disabled")}
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            className={`lm-lora-remove-button flex-1 ${controlDangerButtonClassName}`}
            disabled={disabled}
          >
            {t('Remove')}
          </button>
        </div>

        <div className="lm-lora-row-header flex items-center gap-3">
          <div className="lm-lora-select flex-grow min-w-0">
            {choices.length > 0 ? (
              <ModelComboControl
                containerClass="space-y-0 w-full"
                name=""
                hideLabel
                modelKind={resolvedModelKind}
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
                options={{ placeholder: t("LoRA name") }}
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
            name={showClip ? t("Model strength") : t("Strength")}
            value={Number(loraValue.strength)}
            options={{ min: -10, max: 10, step: 0.01 }}
            onChange={(val) => handleEntryChange({ strength: val })}
            disabled={disabled}
            type="FLOAT"
          />

          {showClip && (
            <NumberControl
              containerClass="space-y-0"
              name={t("Clip strength")}
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
            className={`lm-lora-clip-toggle ${controlGhostButtonClassName}`}
            disabled={disabled}
          >
            {showClip ? t("Hide clip strength") : t("Separate clip strength")}
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
          className={controlDashedButtonClassName}
          disabled={disabled}
        >
          <PlusIcon className="w-5 h-5" />
          {t("Add Lora")}
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
        className={`${layoutContainerClass} tw-word-row flex flex-col gap-2 p-3 ${controlNestedSurfaceClassName} ${!triggerValue.active ? "opacity-60" : ""}`}
      >
        <div className="tw-word-header flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100 break-words">
              {triggerValue.text || t("Trigger Word")}
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              handleEntryChange({ active: !triggerValue.active })
            }
            className={`tw-word-toggle px-3 py-1.5 text-xs ${controlToggleButtonClassName({ active: triggerValue.active, disabled })}`}
            disabled={disabled}
          >
            {triggerValue.active ? t("Enabled") : t("Disabled")}
          </button>
        </div>

        {allowStrength && (
          <NumberControl
            containerClass="space-y-0"
            name={t("Strength")}
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
      <label
        className={`${layoutContainerClass} power-lora-header flex items-center justify-between p-3 bg-cyan-500/10 border border-cyan-400/20 rounded-lg ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        }`}
      >
        <div className="power-lora-header-content flex items-center gap-3">
          <input
            type="checkbox"
            onChange={(e) => onChange(e.target.checked)}
            className="w-5 h-5 rounded cursor-pointer"
            disabled={disabled}
          />
          <span className="power-lora-header-label text-sm font-semibold text-cyan-300 uppercase tracking-wider">
            Toggle All Loras
          </span>
        </div>
      </label>
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
        className={`${layoutContainerClass} power-lora-row flex flex-col gap-2 p-3 ${controlNestedSurfaceClassName} ${!loraValue.on ? "opacity-60" : ""}`}
      >
        <div className="power-lora-row-actions flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleSubChange("on", !loraValue.on)}
            className={`power-lora-enabled-button flex-1 py-2 text-sm ${controlToggleButtonClassName({ active: loraValue.on, disabled, radius: "lg" })}`}
            disabled={disabled}
          >
            {loraValue.on ? t("Enabled") : t("Disabled")}
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            className={`power-lora-remove-button flex-1 ${controlDangerButtonClassName}`}
            disabled={disabled}
          >
            {t('Remove')}
          </button>
        </div>

        <div className="power-lora-row-header flex items-center gap-3">
          <div className="power-lora-select flex-grow min-w-0">
            <WidgetControl
              name=""
              hideLabel
              compact
              type="COMBO"
              modelKind="loras"
              value={loraValue.lora}
              options={choices}
              onChange={(val) => handleSubChange("lora", val)}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="power-lora-strengths flex flex-col">
          <label className="block text-sm font-medium text-slate-300 ml-1">
            {showSeparate ? t("Model strength") : t("Strength")}
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
            <label className="block text-sm font-medium text-slate-300 ml-1">
              {t('Clip strength')}
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

  // rgthree Power Puter: the outputs chip row. Upstream draws this on the node
  // canvas as a wrapping strip of chips, each opening a context menu of output
  // types plus a Delete entry once more than one output exists, and a trailing
  // "+" chip capped at ten. Editing an entry rewrites the node's output slots,
  // so the change is dispatched through the store rather than as a plain widget
  // value -- see `setPowerPuterOutputs`.
  if (type === "POWER_PUTER_OUTPUTS") {
    const puterOptions = (options as {
      choices?: string[];
      maxOutputs?: number;
    }) || {};
    const outputTypes: string[] = Array.isArray(value) && value.length > 0
      ? (value as string[])
      : ["STRING"];
    const choices = puterOptions.choices ?? ["STRING", "INT", "FLOAT", "BOOLEAN", "*"];
    const maxOutputs = puterOptions.maxOutputs ?? 10;
    const canDelete = outputTypes.length > 1;

    const replaceAt = (index: number, next: string) => {
      const copy = [...outputTypes];
      copy[index] = next;
      onChange(copy);
    };
    const removeAt = (index: number) => {
      if (!canDelete) return;
      onChange(outputTypes.filter((_, i) => i !== index));
    };

    return (
      <div className={`${layoutContainerClass} power-puter-outputs flex flex-col gap-2`}>
        {!hideLabel && (
          <span className="power-puter-outputs-label block text-sm font-medium text-slate-300 ml-1">
            {t("Outputs")}
          </span>
        )}
        <div className="power-puter-outputs-chips flex flex-wrap items-center gap-2">
          {outputTypes.map((outputType, index) => (
            <div
              key={`power-puter-output-${index}`}
              className={`power-puter-output-chip flex items-center gap-1 pl-2 pr-1 py-1 ${controlNestedSurfaceClassName} rounded-full`}
            >
              <select
                value={choices.includes(outputType) ? outputType : choices[0]}
                onChange={(e) => replaceAt(index, e.target.value)}
                disabled={disabled}
                aria-label={t("Output {n} type", { n: index + 1 })}
                className="power-puter-output-type bg-transparent text-sm text-slate-100 outline-none disabled:opacity-60"
              >
                {choices.map((choice) => (
                  <option key={choice} value={choice} className="bg-slate-800">
                    {choice}
                  </option>
                ))}
              </select>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  disabled={disabled}
                  aria-label={t("Remove output {n}", { n: index + 1 })}
                  className="power-puter-output-remove w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:text-red-300 disabled:opacity-40"
                >
                  &times;
                </button>
              )}
            </div>
          ))}
          {outputTypes.length < maxOutputs && (
            <button
              type="button"
              onClick={() => onChange([...outputTypes, "STRING"])}
              disabled={disabled}
              aria-label={t("Add output")}
              className={`power-puter-output-add flex items-center gap-1 px-3 py-1 rounded-full ${controlGhostButtonClassName}`}
            >
              <PlusIcon className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  if (type === "POWER_LORA_ADD") {
    const handlePowerLoraAddClick = () => {
      onChange({
        on: true,
        // Sentinel value the rgthree Power LoRA loader expects — never
        // translate it, it is stored in the workflow and sent to the backend.
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
          className={controlDashedButtonClassName}
          disabled={disabled}
        >
          <PlusIcon className="w-5 h-5" />
          {t("Add Lora")}
        </button>
      </div>
    );
  }

  if (isString) {
    return <StringControl {...controlProps} />;
  }

  if (isCombo) {
    return <ModelComboControl {...controlProps} modelKind={resolvedModelKind} />;
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
            className="inline-flex min-w-0 items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-2"
          >
            <span className="truncate">
              {label}
              {boundaryAnnotation && !onBoundaryJump ? ` ${boundaryAnnotation}` : ""}
            </span>
            {isPromoted && !onBoundaryJump && (
              <PromotedWidgetIcon className="w-3.5 h-3.5 shrink-0 text-pink-500" />
            )}
          </label>
          {/* Annotation and marker as ONE button when they can jump — same
              two-path shape as ControlLabelRow, in this branch's typography. */}
          {onBoundaryJump && (boundaryAnnotation || isPromoted) && (
            <button
              type="button"
              className="boundary-jump mr-2 inline-flex min-w-0 shrink-0 items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider transition-colors hover:text-cyan-300 active:scale-95"
              aria-label={t("Show boundary input")}
              onClick={(event) => {
                event.stopPropagation();
                onBoundaryJump();
              }}
            >
              {boundaryAnnotation && <span className="truncate">{boundaryAnnotation}</span>}
              {isPromoted && (
                <PromotedWidgetIcon className="w-3.5 h-3.5 shrink-0 text-pink-500" />
              )}
            </button>
          )}
          {/* This branch renders every type the specialised controls do not —
              previews, custom node widgets — and dropped the row's actions and
              its promoted marker on the floor along with them. Outside the
              <label>, because a label forwards clicks to the first labelable
              thing inside it and would make the widget's name a second trigger
              for this button. */}
          {labelAccessory}
          {hasError && (
            <div
              id={`widget-error-icon-${name}`}
              className="text-red-500"
              title={t("Error in this input")}
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
          bg-slate-950/80 border border-white/10 rounded-xl px-3 py-2.5
          active:bg-slate-800/95 active:border-cyan-400/40 transition-all
          ${disabled ? "opacity-50 grayscale pointer-events-none" : "cursor-pointer"}
          ${hasError ? "border-red-500/50 bg-red-500/10" : ""}
        `}
        onClick={handleOpenModal}
      >
        <div
          id={`widget-value-display-${name}`}
          className="value-display flex-1 truncate text-sm font-medium text-slate-100"
        >
          {isCombo
            ? value || t("Select...")
            : value !== undefined && value !== null
              ? String(value)
              : t("Empty")}
        </div>
      </div>

      <FullscreenWidgetModal
        isOpen={effectiveModalOpen}
        title={label}
        onClose={handleCloseModal}
        viewerSidebar={forceModalOpen}
      >
        <div id={`modal-control-wrapper-${name}`} className="p-2">
          {renderControl()}
        </div>
      </FullscreenWidgetModal>
    </div>
  );
}

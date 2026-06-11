import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import Select, { components, createFilter } from "react-select";
import type { OptionProps } from "react-select";
import { FullscreenWidgetModal } from "../modals/FullscreenWidgetModal";
import { PinButton } from "./PinButton";
import { ChevronDownIcon, PlusIcon, FolderIcon, PromotedWidgetIcon, FunnelIcon, CheckIcon } from "@/components/icons";
import { getImagePreviewUrl, setFileHidden, uploadImageFile } from "@/api/client";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { useWorkflowErrorsStore } from "@/hooks/useWorkflowErrors";
import { InputFilePicker } from "./InputFilePicker";
import { resolveUploadFolder } from "./outputPickerUtils";
import type { AssetSource } from "@/api/client";
import { useCoarsePointer } from "@/hooks/useCoarsePointer";
import { themeColors } from "@/theme/colors";
import { resolveComboOption } from "@/utils/workflowInputs";
import type { ModelLookup } from "@/api/loraManagerClient";
import {
  ModelOption,
  ModelSingleValue,
  ModelRowContent,
  type ComboSelectOption,
} from "./ModelComboOption";
import {
  controlLabelClassName,
  controlSecondaryButtonDisabledClassName,
  controlSecondaryButtonEnabledClassName,
  controlStateClassName,
} from "./controlStyles";
import { useWorkflowHiddenStore } from "@/hooks/useWorkflowHidden";
import { isWorkflowHidden } from "@/utils/workflowHidden";
import {
  appChromeIconButtonActiveClassName,
  appChromeIconButtonClassName,
} from "@/components/chromeStyles";

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mkv", "gif", "mov", "avi", "wmv"]);
const comboInputBackground = "rgb(2 6 23 / 0.8)";
const comboInputBorder = "rgb(255 255 255 / 0.1)";
// Sentinel base-model filter value for models that have no base_model metadata.
const BASE_MODEL_FILTER_UNKNOWN = "__unknown__";
// Sentinel select value representing a null combo choice.
const NULL_OPTION_VALUE = "__null__";
// Options that participate in the base-model filter (real selectable models).
const isFilterableOption = (opt: ComboSelectOption) =>
  opt.value !== NULL_OPTION_VALUE && !opt.isMissing;


interface ComboControlProps {
  containerClass: string;
  name: string;
  value: unknown;
  options?: Record<string, unknown> | unknown[];
  onChange: (value: unknown) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  hasPin: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  hasError?: boolean;
  isPromoted?: boolean;
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
  hasPin,
  isPinned = false,
  onTogglePin,
  hasError = false,
  isPromoted = false,
  forceModalOpen = false,
  onModalClose,
}: ComboControlProps) {
  type SelectOption = ComboSelectOption;

  const addInputComboOption = useWorkflowStore((s) => s.addInputComboOption);
  const workflowSource = useWorkflowStore((s) => s.workflowSource);
  const currentFilename = useWorkflowStore((s) => s.currentFilename);
  const hiddenWorkflowPaths = useWorkflowHiddenStore((s) => s.hidden);
  const hiddenWorkflow = isWorkflowHidden(workflowSource, currentFilename, hiddenWorkflowPaths);
  const setError = useWorkflowErrorsStore((s) => s.setError);
  const [internalModalOpen, setInternalModalOpen] = useState(false);
  const selectWrapperRef = useRef<HTMLDivElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadedChoices, setUploadedChoices] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  // Model-picker base-model filter. null = "All" (default). Otherwise a base_model
  // display string, or BASE_MODEL_FILTER_UNKNOWN for models without metadata.
  const [baseModelFilter, setBaseModelFilter] = useState<string | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);

  const showModal = forceModalOpen || internalModalOpen;
  const isCoarsePointer = useCoarsePointer();

  const getOption = (key: string): unknown => {
    if (Array.isArray(options)) return undefined;
    return options?.[key];
  };

  const rawChoices = useMemo(() => {
    if (Array.isArray(options)) return options;
    return (options?.options as unknown[]) ?? [];
  }, [options]);
  const supportsImageUpload = Boolean(getOption("image_upload"));
  const imageFolder = (getOption("image_folder") as string) ?? "input";
  const supportsVideoUpload = useMemo(() => {
    if (supportsImageUpload) return false;
    // Detect video combo widgets: either the widget is named "video" (VHS convention)
    // or any existing choice has a video file extension
    const widgetName = name.toLowerCase();
    if (widgetName === "video") return true;
    return rawChoices.length > 0 && rawChoices.some((opt) => {
      const s = String(opt);
      const ext = s.split(".").pop()?.toLowerCase() ?? "";
      return VIDEO_EXTENSIONS.has(ext);
    });
  }, [supportsImageUpload, name, rawChoices]);
  const supportsUpload = supportsImageUpload || supportsVideoUpload;
  const uploadFolder = resolveUploadFolder(supportsVideoUpload, imageFolder);
  const uploadAccept = supportsVideoUpload ? "video/*" : "image/*";
  const uploadLabel = supportsVideoUpload ? "Upload video from device" : "Load from camera roll";
  const [inputPickerOpen, setInputPickerOpen] = useState(false);
  const stripSafetensorsSuffix = Boolean(getOption("stripSafetensorsSuffix"));
  const modelLookup = getOption("modelLookup") as ModelLookup | undefined;
  const isModelMode = typeof modelLookup === "function";
  const hasNullChoice = rawChoices.some((opt) => opt === null);
  const choices = useMemo(
    () => rawChoices.filter((opt) => opt !== null).map((opt) => String(opt)),
    [rawChoices],
  );
  const mergedChoices = useMemo(
    () => Array.from(new Set([...choices, ...uploadedChoices])),
    [choices, uploadedChoices],
  );
  const rawValueString =
    value === null ? NULL_OPTION_VALUE : String(value ?? "");
  const rawBase = rawValueString.split(/[\\/]/).pop() ?? rawValueString;
  const resolvedValue = resolveComboOption(value, mergedChoices);
  const resolvedValueString =
    resolvedValue === undefined ? null : String(resolvedValue);
  const hasValueMatch =
    resolvedValueString !== null ||
    mergedChoices.includes(rawValueString) ||
    mergedChoices.includes(rawBase);
  const isMissingValue =
    value !== null &&
    value !== undefined &&
    rawValueString !== "" &&
    !hasValueMatch;
  const valueString = hasValueMatch
    ? resolvedValueString ??
      (mergedChoices.includes(rawValueString) ? rawValueString : rawBase)
    : rawValueString;
  // Built once per real input change rather than on every render. Without this,
  // a parent re-render, a local state change (e.g. opening the picker), or a
  // search keystroke rebuilt the whole option list and ran modelLookup for every
  // choice — janky on combos with hundreds of models.
  const selectOptions = useMemo<SelectOption[]>(() => {
    const getDisplayLabel = (optionValue: string) =>
      stripSafetensorsSuffix
        ? optionValue.replace(/\.safetensors$/i, "")
        : optionValue;
    // In model mode, prefer Lora Manager's display name; otherwise plain filename.
    const buildOption = (optionValue: string): SelectOption => {
      const model = isModelMode ? modelLookup!(optionValue) : null;
      const label = model?.model_name?.trim() || getDisplayLabel(optionValue);
      return { value: optionValue, label, model };
    };
    const opts: SelectOption[] = [];
    if (value === null || hasNullChoice) {
      opts.push({ value: NULL_OPTION_VALUE, label: "None" });
    }
    if (isMissingValue) {
      opts.push({
        value: rawValueString,
        label: getDisplayLabel(rawValueString),
        isMissing: true,
      });
    }
    opts.push(...mergedChoices.map(buildOption));
    return opts;
  }, [mergedChoices, isModelMode, modelLookup, stripSafetensorsSuffix, value, hasNullChoice, isMissingValue, rawValueString]);
  const selectedOption =
    selectOptions.find((opt) => opt.value === valueString) ?? null;

  // Model-picker base-model filter. Collect the distinct base_model values present
  // in the resolved options (plus whether any lack metadata → "Unknown").
  const { baseModelChoices, hasUnknownBaseModel } = useMemo(() => {
    if (!isModelMode) return { baseModelChoices: [] as string[], hasUnknownBaseModel: false };
    const set = new Set<string>();
    let hasUnknown = false;
    for (const opt of selectOptions) {
      if (!isFilterableOption(opt)) continue;
      const bm = opt.model?.base_model?.trim();
      if (bm) set.add(bm);
      else hasUnknown = true;
    }
    return {
      baseModelChoices: Array.from(set).sort((a, b) => a.localeCompare(b)),
      hasUnknownBaseModel: hasUnknown,
    };
  }, [isModelMode, selectOptions]);
  const showBaseModelFilter =
    isModelMode && (baseModelChoices.length > 0 || hasUnknownBaseModel);
  const baseModelFilterActive = showBaseModelFilter && baseModelFilter !== null;
  const modalSelectOptions =
    !baseModelFilterActive
      ? selectOptions
      : selectOptions.filter((opt) => {
          if (!isFilterableOption(opt)) return true;
          const bm = opt.model?.base_model?.trim();
          return baseModelFilter === BASE_MODEL_FILTER_UNKNOWN ? !bm : bm === baseModelFilter;
        });
  const baseModelFilterOptions: Array<{ key: string; value: string | null; label: string }> = [
    { key: "all", value: null, label: "All" },
    ...baseModelChoices.map((bm) => ({ key: bm, value: bm, label: bm })),
    ...(hasUnknownBaseModel
      ? [{ key: "unknown", value: BASE_MODEL_FILTER_UNKNOWN, label: "Unknown" }]
      : []),
  ];

  const simpleChoiceCount = rawChoices.filter((opt) => opt !== null).length;
  const useModalFlow = forceModalOpen
    ? true
    : isCoarsePointer && !(simpleChoiceCount > 0 && simpleChoiceCount < 5);
  const showImageThumbnails = supportsImageUpload && imageFolder === "input";
  const useInputBrowser = showImageThumbnails;

  const getThumbnailUrl = (optionValue: string) => {
    const normalized = optionValue.replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    const filename =
      lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
    const subfolder = lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
    return getImagePreviewUrl(filename, subfolder, "input");
  };

  const selectComponents = useMemo(() => {
    if (isModelMode) {
      return {
        DropdownIndicator: null,
        IndicatorSeparator: null,
        Option: ModelOption,
        SingleValue: ModelSingleValue,
      };
    }
    if (!showImageThumbnails) {
      return {
        DropdownIndicator: null,
        IndicatorSeparator: null,
      };
    }
    const ThumbnailOption = (props: OptionProps<SelectOption, false>) => {
      const { data } = props;
      const showThumb =
        data.value !== NULL_OPTION_VALUE && !data.isMissing && Boolean(data.value);
      const thumbUrl = showThumb ? getThumbnailUrl(data.value) : null;
      return (
        <components.Option {...props}>
          <div className="flex items-center gap-2">
            {thumbUrl && (
              <img
                src={thumbUrl}
                alt=""
                className="w-[72px] h-[72px] rounded-sm object-cover bg-slate-800 shrink-0"
                loading="lazy"
                decoding="async"
              />
            )}
            <span className="truncate">{data.label}</span>
          </div>
        </components.Option>
      );
    };
    return {
      DropdownIndicator: null,
      IndicatorSeparator: null,
      Option: ThumbnailOption,
    };
  }, [showImageThumbnails, isModelMode]);

  const selectClassName = [
    "rs-container",
    hasPin ? "rs-has-pin" : "rs-no-pin",
    hasError ? "rs-error" : "",
    isPromoted ? "rs-promoted" : "",
    isMissingValue ? "rs-missing" : "",
    disabled ? "rs-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // The modal select renders no chevron/pin inside the control (those live on
  // the separate trigger button), so it must NOT reserve the pin/chevron right
  // padding — otherwise the selected value's badge sits inset from the right
  // edge and no longer lines up with the option-row badges below it.
  const modalSelectClassName = [
    "rs-container",
    hasError ? "rs-error" : "",
    isPromoted ? "rs-promoted" : "",
    isMissingValue ? "rs-missing" : "",
    disabled ? "rs-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const menuPortalTarget =
    typeof document === "undefined" ? null : document.body;

  const handleClose = () => {
    setInternalModalOpen(false);
    setFilterMenuOpen(false);
    setBaseModelFilter(null);
    onModalClose?.();
  };

  const handleSelectChange = (next: SelectOption | null) => {
    if (!next) return;
    onChange(next.value === NULL_OPTION_VALUE ? null : next.value);
  };

  const handleModalSelectChange = (next: SelectOption | null) => {
    handleSelectChange(next);
    handleClose();
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
      const result = await uploadImageFile(file, { type: uploadFolder });
      const nextValue = result.subfolder
        ? `${result.subfolder}/${result.name}`
        : result.name;
      // Auto-hiding the new input is best-effort declutter — never let it abort
      // the upload assignment, so fire-and-forget instead of awaiting.
      if (hiddenWorkflow && result.type === "input") {
        void setFileHidden(nextValue, true, "input").catch((err) => {
          console.warn("Failed to hide input from hidden workflow:", err);
        });
      }
      setUploadedChoices((prev) =>
        prev.includes(nextValue) ? prev : [...prev, nextValue],
      );
      onChange(nextValue);
      // Register the upload as a real combo choice in-memory instead of blocking
      // the assignment on a multi-MB /object_info refetch. Image pickers only.
      if (supportsImageUpload) addInputComboOption(nextValue);
    } catch (err) {
      console.error("Failed to upload file:", err);
      setError(`Failed to upload "${file.name}"`);
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  // Unified pick handler for the file browser. `pickedSource` is "output" when
  // the file was copied in from the outputs folder (see InputFilePicker), in
  // which case a fresh input file now exists and node types need a refresh so it
  // appears as a combo choice.
  const handlePickFile = async (nextValue: string, pickedSource: AssetSource) => {
    setIsUploading(true);
    try {
      if (hiddenWorkflow) {
        void setFileHidden(nextValue, true, "input").catch((err) => {
          console.warn("Failed to hide input added to hidden workflow:", err);
        });
      }
      // Optimistically register the picked file as a choice so the value resolves
      // and displays immediately, without waiting on a node-types refresh.
      setUploadedChoices((prev) =>
        prev.includes(nextValue) ? prev : [...prev, nextValue],
      );
      onChange(nextValue);
      // An output pick copies a fresh file into the input dir; splice it into the
      // image-upload combos' option lists in-memory so it's a real choice (and
      // survives a remount / save-reload) without refetching the multi-MB
      // /object_info. Image pickers only — video combos share no option flag.
      if (pickedSource === "output" && supportsImageUpload) {
        addInputComboOption(nextValue);
      }
    } catch (err) {
      console.error("Failed to sync picked file:", err);
      setError("Failed to sync file selection");
    } finally {
      setIsUploading(false);
      setInputPickerOpen(false);
      // Only collapse the surrounding combo modal when one is actually open, so
      // an inline combo doesn't fire its parent's onModalClose spuriously.
      if (showModal) handleClose();
    }
  };

  // The browser supports both inputs and outputs (output picks get copied into
  // the input folder), so a single "Browse files" button replaces the old
  // separate "Use from outputs" button.
  const deviceUploadButton = supportsUpload ? (
    <button
      type="button"
      className={`w-full py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${disabled || isUploading ? controlSecondaryButtonDisabledClassName : controlSecondaryButtonEnabledClassName}`}
      onClick={handleUploadClick}
      disabled={disabled || isUploading}
    >
      <span className="inline-flex items-center justify-center gap-2">
        <PlusIcon className="w-4 h-4" />
        {isUploading ? "Uploading..." : uploadLabel}
      </span>
    </button>
  ) : null;

  const browseFilesButton = supportsUpload ? (
    <button
      type="button"
      className={`w-full py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${disabled || isUploading ? controlSecondaryButtonDisabledClassName : controlSecondaryButtonEnabledClassName}`}
      onClick={() => !disabled && !isUploading && setInputPickerOpen(true)}
      disabled={disabled || isUploading}
    >
      <span className="inline-flex items-center justify-center gap-2">
        <FolderIcon className="w-4 h-4" />
        Browse files
      </span>
    </button>
  ) : null;

  // Picker used by the modal/inline flows (paths B/C), opened via "Browse files".
  // Path A renders its own instance wired to the main trigger.
  const browseFilePicker = supportsUpload ? (
    <InputFilePicker
      open={inputPickerOpen}
      onClose={() => setInputPickerOpen(false)}
      onPick={handlePickFile}
      defaultSource={imageFolder as AssetSource}
      uploadFolder={uploadFolder}
      supportsVideoUpload={supportsVideoUpload}
    />
  ) : null;

  const selectText = themeColors.text.onDark;

  if (useInputBrowser) {
    const browserOpen = forceModalOpen || inputPickerOpen;
    return (
      <div className={`${containerClass} combo-control-root combo-control-input-browser`}>
        {!hideLabel && (
          <label className={`${controlLabelClassName} mb-1`}>
            <span className="inline-flex items-center gap-1">
              <span>{name}</span>
              {isPromoted && <PromotedWidgetIcon className="w-5 h-5 text-pink-500" />}
            </span>
          </label>
        )}
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          className={`combo-control-trigger relative w-full p-3 comfy-input text-base flex items-center justify-between min-h-[46px] text-left ${controlStateClassName({ disabled, hasError, isPromoted })}`}
          onClick={() => !disabled && setInputPickerOpen(true)}
          onKeyDown={(event) => {
            if (!disabled && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              setInputPickerOpen(true);
            }
          }}
        >
          <span className={`truncate min-w-0 flex-1 text-slate-100 ${hasPin ? "pr-16" : "pr-6"}`}>
            {selectedOption?.label ?? (valueString || "Select...")}
          </span>
          <span className="absolute right-0 top-0 bottom-0 flex items-center pointer-events-none">
            <span className="px-2 text-slate-400"><ChevronDownIcon className="w-5 h-5" /></span>
            {hasPin && (
              <span className="pointer-events-auto px-2">
                <PinButton isPinned={isPinned} onToggle={onTogglePin} />
              </span>
            )}
          </span>
        </div>
        {isMissingValue && <div className="mt-1 pl-1 text-xs text-red-400">Missing on ComfyUI server</div>}
        <div className="combo-control-upload mt-2">
          <div className="flex flex-col gap-2">{deviceUploadButton}</div>
          <input
            ref={uploadInputRef}
            type="file"
            accept={uploadAccept}
            className="hidden"
            onChange={handleUploadChange}
          />
        </div>
        <InputFilePicker
          open={browserOpen}
          onClose={() => {
            setInputPickerOpen(false);
            handleClose();
          }}
          onPick={handlePickFile}
          defaultSource={imageFolder as AssetSource}
          uploadFolder={uploadFolder}
          supportsVideoUpload={supportsVideoUpload}
        />
      </div>
    );
  }

  if (useModalFlow) {
    return (
      <div
        className={`${containerClass} combo-control-root combo-control-modal`}
      >
        {!hideLabel && (
          <label className={`${controlLabelClassName} mb-1`}>
            <span className="inline-flex items-center gap-1">
              <span>{name}</span>
              {isPromoted && (
                <PromotedWidgetIcon className="w-5 h-5 text-pink-500" />
              )}
            </span>
          </label>
        )}

        <div
          className={`combo-control-trigger relative w-full p-3 comfy-input text-base flex items-center justify-between min-h-[46px] ${controlStateClassName({ disabled, hasError, isPromoted })}`}
          onClick={() => !disabled && setInternalModalOpen(true)}
        >
          {isModelMode && selectedOption?.model ? (
            <div
              className={`min-w-0 flex-1 text-slate-100 ${hasPin ? "pr-16" : "pr-10"}`}
            >
              <ModelRowContent option={selectedOption} />
            </div>
          ) : (
            <span
              className={`combo-control-trigger-label truncate min-w-0 flex-1 ${!selectedOption ? "text-slate-500" : "text-slate-100"} ${hasPin ? "pr-16" : "pr-6"}`}
              style={
                selectedOption ? { color: themeColors.text.onDark } : undefined
              }
            >
              {selectedOption ? selectedOption.label : "Select..."}
            </span>
          )}

          <div className="combo-control-trigger-icons flex items-center absolute right-0 top-0 bottom-0 pointer-events-none">
            <div className="combo-control-chevron px-2 text-slate-400">
              <ChevronDownIcon className="w-5 h-5" />
            </div>
            {hasPin && (
              <div className="combo-control-pin pointer-events-auto px-2">
                <PinButton
                  isPinned={isPinned}
                  onToggle={onTogglePin}
                />
              </div>
            )}
          </div>
        </div>

        {isMissingValue && (
          <div className="mt-1 pl-1 text-xs text-red-400">
            Missing on ComfyUI server
          </div>
        )}
        {supportsUpload && (
          <div className="combo-control-upload mt-2">
            <div className="flex flex-col gap-2">
              {deviceUploadButton}
              {browseFilesButton}
            </div>
            <input
              ref={uploadInputRef}
              type="file"
              accept={uploadAccept}
              className="hidden"
              onChange={handleUploadChange}
            />
          </div>
        )}
        {browseFilePicker}

        <FullscreenWidgetModal
          title={name}
          isOpen={showModal}
          onClose={handleClose}
          viewerSidebar={forceModalOpen}
        >
          <div data-swipe-nav-ignore="true">
            {/* The search bar + results span the full width; the funnel floats over
                the control's top-right corner (the control reserves right padding
                for it), so results aren't squished into a narrower column. */}
            <div className="relative">
            <Select<SelectOption, false>
              className={modalSelectClassName}
              classNamePrefix="rs"
              options={modalSelectOptions}
              value={selectedOption}
              onChange={handleModalSelectChange}
              isSearchable
              autoFocus={!forceModalOpen}
              menuIsOpen={forceModalOpen ? undefined : true}
              controlShouldRenderValue={true}
              placeholder="Search..."
              filterOption={createFilter({
                ignoreAccents: true,
                ignoreCase: true,
                trim: true,
                matchFrom: "any",
              })}
              styles={{
                menu: (base) => ({
                  ...base,
                  position: "static",
                  boxShadow: "none",
                  border: "none",
                  marginTop: "0.5rem",
                  borderRadius: 0,
                  backgroundColor: themeColors.transparent,
                }),
                menuList: (base) => ({
                  ...base,
                  maxHeight: "calc(100vh - 160px)",
                  height: "auto",
                  paddingBottom: "2rem",
                  overflowY: "auto",
                  overflowX: "auto",
                  overscrollBehaviorY: "contain",
                  overscrollBehaviorX: "contain",
                  touchAction: "pan-y",
                }),
                // Pin option colors so the highlighted row uses the dark theme
                // rather than react-select's default (light) focus background.
                option: (base, state) => ({
                  ...base,
                  color: selectText,
                  backgroundColor: state.isSelected
                    ? themeColors.surface.optionSelected
                    : state.isFocused
                      ? themeColors.surface.optionFocused
                      : themeColors.transparent,
                }),
                // Pin the selected-value and search-input text to the light theme
                // color; react-select's defaults are too dark on the dark control.
                singleValue: (base) => ({ ...base, color: selectText }),
                input: (base) => ({ ...base, color: selectText }),
                control: (base, state) => {
                  const focusBorder = themeColors.border.focusCyan;
                  const errorBorder = themeColors.border.errorDark;
                  const promotedBorder = themeColors.brand.promotedPink;
                  const borderColor = hasError
                    ? errorBorder
                    : isPromoted
                      ? promotedBorder
                      : state.isFocused
                        ? focusBorder
                        : comboInputBorder;
                  return {
                    ...base,
                    minHeight: 48,
                    // Reserve room so the floating funnel button never overlaps
                    // the search text / selected value.
                    paddingRight: showBaseModelFilter ? "2.75rem" : undefined,
                    borderColor,
                    boxShadow: state.isFocused || hasError || isPromoted
                      ? `0 0 0 1px ${borderColor}`
                      : "none",
                    backgroundColor: comboInputBackground,
                    color: selectText,
                  };
                },
              }}
              components={selectComponents}
              noOptionsMessage={() => "No matches"}
            />
              {showBaseModelFilter && (
                <div className="combo-control-filter absolute right-1.5 top-[5px]">
                  <button
                    type="button"
                    aria-label="Filter by base model"
                    aria-expanded={filterMenuOpen}
                    onClick={() => setFilterMenuOpen((open) => !open)}
                    className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
                      baseModelFilterActive
                        ? appChromeIconButtonActiveClassName
                        : appChromeIconButtonClassName
                    }`}
                  >
                    <FunnelIcon className="w-[18px] h-[18px]" />
                  </button>
                  {filterMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-[40]"
                        onClick={() => setFilterMenuOpen(false)}
                      />
                      <div
                        className="absolute right-0 top-full z-[50] mt-1 w-48 max-h-[50vh] overflow-y-auto rounded-lg border border-white/10 shadow-lg"
                        style={{ backgroundColor: themeColors.surface.menu }}
                      >
                        {baseModelFilterOptions.map((choice) => {
                          const active = choice.value === baseModelFilter;
                          return (
                            <button
                              key={choice.key}
                              type="button"
                              onClick={() => {
                                setBaseModelFilter(choice.value);
                                setFilterMenuOpen(false);
                              }}
                              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/5"
                            >
                              <span className="truncate">{choice.label}</span>
                              {active && <CheckIcon className="w-4 h-4 shrink-0 text-cyan-300" />}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </FullscreenWidgetModal>
      </div>
    );
  }

  return (
    <div
      className={`${containerClass} combo-control-root combo-control-inline`}
    >
      {!hideLabel && (
        <label className={`${controlLabelClassName} mb-1`}>
          <span className="inline-flex items-center gap-1">
            <span>{name}</span>
            {isPromoted && (
              <PromotedWidgetIcon className="w-3.5 h-3.5 text-pink-500" />
            )}
          </span>
        </label>
      )}
      <div
        className="combo-control-input-wrapper relative rs-scroll-target"
        ref={selectWrapperRef}
        data-swipe-nav-ignore="true"
      >
        <Select<SelectOption, false>
          className={selectClassName}
          classNamePrefix="rs"
          options={selectOptions}
          value={selectedOption}
          onChange={handleSelectChange}
          isSearchable
          isDisabled={disabled}
          filterOption={createFilter({
            ignoreAccents: true,
            ignoreCase: true,
            trim: true,
            matchFrom: "any",
          })}
          menuPortalTarget={menuPortalTarget}
          menuPosition="fixed"
          menuPlacement="bottom"
          menuShouldScrollIntoView={false}
          styles={{
            menuPortal: (base) => ({ ...base, zIndex: 200 }),
            // react-select injects its own (light) defaults at runtime that win
            // over the static .rs__* CSS, so the menu/option/value colors must be
            // pinned here to stay on the dark theme.
            menu: (base) => ({
              ...base,
              backgroundColor: themeColors.surface.menu,
            }),
            menuList: (base) => ({
              ...base,
              overflowY: "auto",
              overflowX: "auto",
              overscrollBehaviorY: "contain",
              overscrollBehaviorX: "contain",
              touchAction: "pan-y",
            }),
            option: (base, state) => ({
              ...base,
              color: selectText,
              backgroundColor: state.isSelected
                ? themeColors.surface.optionSelected
                : state.isFocused
                  ? themeColors.surface.optionFocused
                  : themeColors.transparent,
            }),
            singleValue: (base) => ({ ...base, color: selectText }),
            input: (base) => ({ ...base, color: selectText }),
            placeholder: (base) => ({
              ...base,
              color: themeColors.text.muted,
            }),
            control: (base, state) => {
              const defaultBorder = comboInputBorder;
              const focusBorder = themeColors.border.focusCyan;
              const errorBorder = themeColors.border.errorDark;
              const promotedBorder = themeColors.brand.promotedPink;
              const borderColor = hasError
                ? errorBorder
                : isPromoted
                  ? promotedBorder
                  : state.isFocused
                    ? focusBorder
                    : defaultBorder;
              return {
                ...base,
                minHeight: 48,
                borderRadius: 8,
                borderWidth: 1,
                borderColor,
                boxShadow: state.isFocused || hasError || isPromoted
                  ? `0 0 0 1px ${borderColor}`
                  : "none",
                backgroundColor: comboInputBackground,
              };
            },
          }}
          components={selectComponents}
          noOptionsMessage={() => "No matches"}
        />
        <div className="combo-control-icons absolute right-0 top-0 bottom-0 flex items-center pointer-events-none">
          <div className="combo-control-chevron px-2 text-slate-400">
            <ChevronDownIcon className="w-5 h-5" />
          </div>
          {hasPin && (
            <div className="combo-control-pin pointer-events-auto px-2">
              <PinButton
                isPinned={isPinned}
                onToggle={onTogglePin}
              />
            </div>
          )}
          {!hasPin && <div className="w-3" />}
        </div>
      </div>
      {isMissingValue && (
        <div className="mt-1 pl-1 text-xs text-red-400">
          Missing on ComfyUI server
        </div>
      )}
      {supportsUpload && (
        <div className="mt-2">
          <div className="flex flex-col gap-2">
            {deviceUploadButton}
            {browseFilesButton}
          </div>
          <input
            ref={uploadInputRef}
            type="file"
            accept={uploadAccept}
            className="hidden"
            onChange={handleUploadChange}
          />
        </div>
      )}
      {browseFilePicker}
    </div>
  );
}

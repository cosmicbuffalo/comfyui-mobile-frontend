import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import Select, { components, createFilter } from "react-select";
import type { OptionProps } from "react-select";
import { FullscreenWidgetModal } from "../modals/FullscreenWidgetModal";
import { PinButton } from "./PinButton";
import { ChevronDownIcon, PlusIcon } from "@/components/icons";
import { getImageUrl, getNodeTypes, uploadImageFile } from "@/api/client";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { useThemeStore } from "@/hooks/useTheme";
import { useCoarsePointer } from "@/hooks/useCoarsePointer";
import { themeColors } from "@/theme/colors";

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
  forceModalOpen = false,
  onModalClose,
}: ComboControlProps) {
  type SelectOption = { value: string; label: string; isMissing?: boolean };

  const setNodeTypes = useWorkflowStore((s) => s.setNodeTypes);
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";
  const [internalModalOpen, setInternalModalOpen] = useState(false);
  const selectWrapperRef = useRef<HTMLDivElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadedChoices, setUploadedChoices] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const showModal = forceModalOpen || internalModalOpen;
  const isCoarsePointer = useCoarsePointer();

  const getOption = (key: string): unknown => {
    if (Array.isArray(options)) return undefined;
    return options?.[key];
  };

  const rawChoices = Array.isArray(options)
    ? options
    : ((getOption("options") as unknown[]) ?? []);
  const supportsImageUpload = Boolean(getOption("image_upload"));
  const imageFolder = (getOption("image_folder") as string) ?? "input";
  const NULL_OPTION_VALUE = "__null__";
  const hasNullChoice = rawChoices.some((opt) => opt === null);
  const choices = rawChoices
    .filter((opt) => opt !== null)
    .map((opt) => String(opt));
  const mergedChoices = Array.from(new Set([...choices, ...uploadedChoices]));
  const rawValueString =
    value === null ? NULL_OPTION_VALUE : String(value ?? "");
  const rawBase = rawValueString.split(/[\\/]/).pop() ?? rawValueString;
  const hasValueMatch =
    mergedChoices.includes(rawValueString) || mergedChoices.includes(rawBase);
  const isMissingValue =
    value !== null &&
    value !== undefined &&
    rawValueString !== "" &&
    !hasValueMatch;
  const valueString = hasValueMatch
    ? mergedChoices.includes(rawValueString)
      ? rawValueString
      : rawBase
    : rawValueString;
  const selectOptions: SelectOption[] = [];
  if (value === null || hasNullChoice) {
    selectOptions.push({ value: NULL_OPTION_VALUE, label: "None" });
  }
  if (isMissingValue) {
    selectOptions.push({
      value: rawValueString,
      label: rawValueString,
      isMissing: true,
    });
  }
  selectOptions.push(
    ...mergedChoices.map((opt) => ({ value: opt, label: opt })),
  );
  const selectedOption =
    selectOptions.find((opt) => opt.value === valueString) ?? null;
  const simpleChoiceCount = rawChoices.filter((opt) => opt !== null).length;
  const useModalFlow = forceModalOpen
    ? true
    : isCoarsePointer && !(simpleChoiceCount > 0 && simpleChoiceCount < 5);
  const showImageThumbnails = supportsImageUpload && imageFolder === "input";

  const getThumbnailUrl = (optionValue: string) => {
    const normalized = optionValue.replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    const filename =
      lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
    const subfolder = lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
    return getImageUrl(filename, subfolder, "input");
  };

  const selectComponents = useMemo(() => {
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
                className="w-[72px] h-[72px] rounded-sm object-cover bg-gray-100 shrink-0"
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
  }, [showImageThumbnails]);

  const selectClassName = [
    "rs-container",
    hasPin ? "rs-has-pin" : "rs-no-pin",
    hasError ? "rs-error" : "",
    isMissingValue ? "rs-missing" : "",
    disabled ? "rs-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const menuPortalTarget =
    typeof document === "undefined" ? null : document.body;

  const handleClose = () => {
    setInternalModalOpen(false);
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
      const result = await uploadImageFile(file, { type: imageFolder });
      const nextValue = result.subfolder
        ? `${result.subfolder}/${result.name}`
        : result.name;
      setUploadedChoices((prev) =>
        prev.includes(nextValue) ? prev : [...prev, nextValue],
      );
      try {
        const freshTypes = await getNodeTypes();
        setNodeTypes(freshTypes);
      } catch {
        // Non-critical: combo options may be stale but the value is still set
      }
      onChange(nextValue);
    } catch (err) {
      console.error("Failed to upload image:", err);
    } finally {
      setIsUploading(false);
      event.target.value = "";
    }
  };

  const uploadButton = supportsImageUpload ? (
    <button
      type="button"
      className={`w-full py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${disabled || isUploading ? "opacity-60 cursor-not-allowed border-gray-200 text-gray-400 bg-white" : "border-gray-200 text-gray-700 bg-white hover:border-gray-300 hover:text-gray-900"}`}
      onClick={handleUploadClick}
      disabled={disabled || isUploading}
    >
      <span className="inline-flex items-center justify-center gap-2">
        <PlusIcon className="w-4 h-4" />
        {isUploading ? "Uploading..." : "Load from camera roll"}
      </span>
    </button>
  ) : null;

  const lightText = themeColors.text.primary;
  const lightSubtleText = themeColors.text.secondary;

  if (useModalFlow) {
    return (
      <div
        className={`${containerClass} combo-control-root combo-control-modal`}
      >
        {!hideLabel && (
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {name}
          </label>
        )}

        <div
          className={`combo-control-trigger relative w-full p-3 comfy-input text-base flex items-center justify-between min-h-[46px] ${disabled ? "opacity-60 cursor-not-allowed" : ""} ${hasError ? "border-red-700 ring-1 ring-red-700" : ""}`}
          onClick={() => !disabled && setInternalModalOpen(true)}
        >
          <span
            className={`combo-control-trigger-label truncate min-w-0 flex-1 ${!selectedOption ? "text-gray-400 dark:text-gray-500" : "text-gray-900"} ${hasPin ? "pr-16" : "pr-6"}`}
            style={
              selectedOption && isDark
                ? { color: themeColors.text.onDark }
                : undefined
            }
          >
            {selectedOption ? selectedOption.label : "Select..."}
          </span>

          <div className="combo-control-trigger-icons flex items-center absolute right-0 top-0 bottom-0 pointer-events-none">
            <div className="combo-control-chevron px-2 text-gray-400">
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
          <div className="mt-1 text-xs text-red-700">
            Missing on ComfyUI server
          </div>
        )}
        {supportsImageUpload && (
          <div className="combo-control-upload mt-2">
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

        <FullscreenWidgetModal
          title={name}
          isOpen={showModal}
          onClose={handleClose}
        >
          <Select<SelectOption, false>
            className={selectClassName}
            classNamePrefix="rs"
            options={selectOptions}
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
                backgroundColor: isDark
                  ? themeColors.transparent
                  : themeColors.surface.white,
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
              option: (base, state) =>
                isDark
                  ? base
                  : {
                      ...base,
                      color: lightText,
                      backgroundColor: state.isSelected
                        ? themeColors.surface.gray200
                        : state.isFocused
                          ? themeColors.surface.gray100
                          : themeColors.transparent,
                    },
              singleValue: (base) => ({
                ...base,
                color: isDark ? base.color : lightText,
              }),
              input: (base) => ({
                ...base,
                color: isDark ? base.color : lightText,
              }),
              placeholder: (base) => ({
                ...base,
                color: isDark ? base.color : lightSubtleText,
              }),
              control: (base) => ({
                ...base,
                borderColor: themeColors.border.focusBlue,
                boxShadow: `0 0 0 1px ${themeColors.border.focusBlue}`,
                backgroundColor: isDark
                  ? base.backgroundColor
                  : themeColors.surface.white,
                color: isDark ? base.color : lightText,
              }),
            }}
            components={selectComponents}
            noOptionsMessage={() => "No matches"}
          />
        </FullscreenWidgetModal>
      </div>
    );
  }

  return (
    <div
      className={`${containerClass} combo-control-root combo-control-inline`}
    >
      {!hideLabel && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {name}
        </label>
      )}
      <div
        className="combo-control-input-wrapper relative rs-scroll-target"
        ref={selectWrapperRef}
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
            menuList: (base) => ({
              ...base,
              overflowY: "auto",
              overflowX: "auto",
              overscrollBehaviorY: "contain",
              overscrollBehaviorX: "contain",
              touchAction: "pan-y",
            }),
            option: (base, state) =>
              isDark
                ? base
                : {
                    ...base,
                    color: lightText,
                    backgroundColor: state.isSelected
                      ? themeColors.surface.gray200
                      : state.isFocused
                        ? themeColors.surface.gray100
                        : themeColors.transparent,
                  },
            singleValue: (base) => ({
              ...base,
              color: isDark ? base.color : lightText,
            }),
            input: (base) => ({
              ...base,
              color: isDark ? base.color : lightText,
            }),
            placeholder: (base) => ({
              ...base,
              color: isDark ? base.color : lightSubtleText,
            }),
          }}
          components={selectComponents}
          noOptionsMessage={() => "No matches"}
        />
        <div className="combo-control-icons absolute right-0 top-0 bottom-0 flex items-center pointer-events-none">
          <div className="combo-control-chevron px-2 text-gray-400">
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

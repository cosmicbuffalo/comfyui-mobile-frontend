import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import Select, { components, createFilter } from "react-select";
import type { InputActionMeta, OnChangeValue, OptionProps } from "react-select";
import { FullscreenWidgetModal } from "../modals/FullscreenWidgetModal";
import { PinButton } from "./PinButton";
import { ChevronDownIcon, PlusIcon, FolderIcon, FunnelIcon, CheckIcon, EyeIcon, EyeOffIcon } from "@/components/icons";
import { getImagePreviewUrl, setFileState, uploadImageFile } from "@/api/client";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { useWorkflowErrorsStore } from "@/hooks/useWorkflowErrors";
import { InputFilePicker } from "./InputFilePicker";
import { resolveUploadFolder } from "./outputPickerUtils";
import type { AssetSource } from "@/api/client";
import { useCoarsePointer } from "@/hooks/useCoarsePointer";
import { themeColors } from "@/theme/colors";
import {
  applyInlineComboAlignment,
  clearComboScrollSpace,
  findComboScroller,
  holdInlineComboScroll,
  measureInlineComboAlignment,
  measureInlineComboOffset,
  restoreInlineComboOffset,
} from "./inlineComboScroll";
import type { InlineComboScrollHold } from "./inlineComboScroll";
import {
  INLINE_COMBO_MENU_Z,
  InlineComboScrim,
} from "./InlineComboScrim";
import {
  afterCurrentPress,
  guardAgainstGhostClick,
} from "./inlineComboDismissal";

import { isMultiSelectCombo, resolveComboOption } from "@/utils/workflowInputs";
import type { ModelLookup } from "@/api/loraManagerClient";
import {
  ModelOption,
  ModelSingleValue,
  ModelRowContent,
  type ComboSelectOption,
} from "./ModelComboOption";
import {
  controlSecondaryButtonDisabledClassName,
  controlSecondaryButtonEnabledClassName,
  controlStateClassName,
  controlJumpSurfaceClassName,
} from "./controlStyles";
import { ControlLabelRow } from "./ControlLabelRow";
import { useWorkflowHiddenStore } from "@/hooks/useWorkflowHidden";
import { isWorkflowHidden } from "@/utils/workflowHidden";
import {
  appChromeIconButtonActiveClassName,
  appChromeIconButtonClassName,
} from "@/components/chromeStyles";
import { comboSelectionToValue } from "./comboSelection";
import { useI18n } from "@/i18n";
import { annotateInputPath, isAnnotatedPath, splitPathAnnotation } from "@/utils/annotatedPath";
import { useShowHiddenStore } from "@/hooks/useShowHidden";
import { hasDotHiddenPathSegment } from "@/utils/hiddenPath";

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mkv", "gif", "mov", "avi", "wmv"]);
/** Keys that close the list without a pointer gesture still to play out. */
const KEYS_THAT_CLOSE = new Set(["Escape", "Tab", "Enter"]);

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
  displayLabel?: string;
  /** The row's "…" menu, rendered after the label like the other controls. */
  labelAccessory?: ReactNode;
  /** "⇠ slot" boundary annotation and its jump — see ControlLabelRow. */
  boundaryAnnotation?: string;
  onBoundaryJump?: () => void;
  hasPin: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  hasError?: boolean;
  isPromoted?: boolean;
  forceModalOpen?: boolean;
  /**
   * Lets a parent-owned editor handle modal opening. Pinned widgets use this
   * to route both the workflow control and the bottom-bar button through the
   * same overlay instead of mounting two independent editors.
   */
  onRequestModalOpen?: () => void;
  onModalClose?: () => void;
  compactTrailingControls?: boolean;
  /** True for model/checkpoint/LoRA choices even when metadata is unavailable. */
  isModelPicker?: boolean;
}

export function ComboControl({
  containerClass,
  name,
  value,
  options,
  onChange,
  disabled = false,
  hideLabel = false,
  displayLabel,
  labelAccessory,
  boundaryAnnotation,
  onBoundaryJump,
  hasPin,
  isPinned = false,
  onTogglePin,
  hasError = false,
  isPromoted = false,
  forceModalOpen = false,
  onRequestModalOpen,
  onModalClose,
  compactTrailingControls = false,
  isModelPicker = false,
}: ComboControlProps) {
  const { t } = useI18n();
  type SelectOption = ComboSelectOption;

  const addInputComboOption = useWorkflowStore((s) => s.addInputComboOption);
  const workflowSource = useWorkflowStore((s) => s.workflowSource);
  const currentFilename = useWorkflowStore((s) => s.currentFilename);
  const hiddenWorkflowPaths = useWorkflowHiddenStore((s) => s.hidden);
  const hiddenWorkflow = isWorkflowHidden(workflowSource, currentFilename, hiddenWorkflowPaths);
  const setError = useWorkflowErrorsStore((s) => s.setError);
  const showHidden = useShowHiddenStore((s) => s.showHidden);
  const toggleShowHidden = useShowHiddenStore((s) => s.toggleShowHidden);
  const [internalModalOpen, setInternalModalOpen] = useState(false);
  const inlineRootRef = useRef<HTMLDivElement>(null);
  const inlineScrollerRef = useRef<HTMLElement | null>(null);
  const inlineScrollHoldRef = useRef<InlineComboScrollHold | null>(null);
  const inlineComboOffsetRef = useRef<number | null>(null);
  const inlineDocumentScrollRef = useRef<{ x: number; y: number } | null>(null);
  // The list's open state is owned here rather than by react-select, so the
  // scrim can dismiss it directly. The scrim outlives the dismissal by one
  // gesture: on touch the list closes at touchend, and unmounting there would
  // let the trailing click land on whatever sits underneath.
  const [inlineMenuOpen, setInlineMenuOpen] = useState(false);
  const [inlineScrimVisible, setInlineScrimVisible] = useState(false);
  const cancelInlineScrimLinger = useRef<(() => void) | null>(null);
  const inlineLastKeyRef = useRef<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadedChoices, setUploadedChoices] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  // Model-picker base-model filter. null = "All" (default). Otherwise a base_model
  // display string, or BASE_MODEL_FILTER_UNKNOWN for models without metadata.
  const [baseModelFilter, setBaseModelFilter] = useState<string | null>(null);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);

  const showModal = forceModalOpen || internalModalOpen;
  const isCoarsePointer = useCoarsePointer();
  const hasVisiblePin = hasPin && isPinned && Boolean(onTogglePin);

  const getOption = (key: string): unknown => {
    if (Array.isArray(options)) return undefined;
    return options?.[key];
  };

  const rawChoices = useMemo(() => {
    if (Array.isArray(options)) return options;
    return (options?.options as unknown[]) ?? [];
  }, [options]);
  const isMultiSelect = isMultiSelectCombo(
    Array.isArray(options) ? undefined : options,
  );
  const supportsImageUpload = Boolean(getOption("image_upload"));
  const imageFolder = (getOption("image_folder") as string) ?? "input";
  const supportsVideoUpload = useMemo(() => {
    if (supportsImageUpload) return false;
    // Detect video combo widgets: either the widget is named "video" (VHS convention)
    // or any existing choice is a *filename* with a video extension. A bare
    // extension in the choice list (SaveVideo's format combo offers "mp4") is a
    // container/format selector, not a file picker.
    const widgetName = name.toLowerCase();
    if (widgetName === "video") return true;
    return rawChoices.length > 0 && rawChoices.some((opt) => {
      const s = String(opt);
      const dot = s.lastIndexOf(".");
      if (dot <= 0) return false;
      return VIDEO_EXTENSIONS.has(s.slice(dot + 1).toLowerCase());
    });
  }, [supportsImageUpload, name, rawChoices]);
  const supportsUpload = supportsImageUpload || supportsVideoUpload;
  const uploadFolder = resolveUploadFolder(supportsVideoUpload, imageFolder);
  const uploadAccept = supportsVideoUpload ? "video/*" : "image/*";
  const uploadLabel = supportsVideoUpload ? t("Upload video from device") : t("Load from camera roll");
  const [inputPickerOpen, setInputPickerOpen] = useState(false);
  const stripSafetensorsSuffix = Boolean(getOption("stripSafetensorsSuffix"));
  const modelLookup = getOption("modelLookup") as ModelLookup | undefined;
  const isModelMode = typeof modelLookup === "function";
  const hasNullChoice = rawChoices.some((opt) => opt === null);
  const choices = useMemo(
    () => rawChoices.filter((opt) => opt !== null).map((opt) => String(opt)),
    [rawChoices],
  );
  // A value carrying a directory annotation is resolved by PATH on the server,
  // so it is a legitimate selection even though object_info never offered it —
  // it CANNOT offer it, since it only enumerates top-level input files. Treat it
  // as one of the choices so it resolves, renders under its own name, and shows
  // up in the picker as the current selection instead of as a missing value.
  const serverResolvedChoices = useMemo(
    () => (Array.isArray(value) ? value : value == null ? [] : [value])
      .filter((entry): entry is string => typeof entry === "string" && isAnnotatedPath(entry)),
    [value],
  );
  const mergedChoices = useMemo(
    () => Array.from(new Set([...choices, ...uploadedChoices, ...serverResolvedChoices])),
    [choices, uploadedChoices, serverResolvedChoices],
  );
  const rawChoiceByString = useMemo(() => {
    const result = new Map<string, unknown>();
    for (const choice of rawChoices) {
      const key = String(choice);
      if (!result.has(key)) result.set(key, choice);
    }
    return result;
  }, [rawChoices]);
  const rawValueString =
    value === null ? NULL_OPTION_VALUE : String(value ?? "");
  const rawBase = rawValueString.split(/[\\/]/).pop() ?? rawValueString;
  const resolvedValue = resolveComboOption(value, mergedChoices);
  const resolvedValueString =
    resolvedValue === undefined ? null : String(resolvedValue);
  // A value carrying a `[input]`/`[output]`/`[temp]` annotation is resolved by
  // PATH on the server, not by combo membership, so it is valid even though it
  // is not in the option list -- and it never could be, since object_info only
  // enumerates top-level input files. This is the shape the mask editor writes
  // (`clipspace/...png [input]`), so treating it as unmatched would report a
  // file that is right there as missing from the server.
  const isServerResolvedPath = isAnnotatedPath(rawValueString);
  const hasValueMatch =
    resolvedValueString !== null ||
    isServerResolvedPath ||
    mergedChoices.includes(rawValueString) ||
    mergedChoices.includes(rawBase);
  const selectedRawValues = useMemo(
    () => isMultiSelect
      ? Array.isArray(value) ? value : value == null ? [] : [value]
      : [value],
    [isMultiSelect, value],
  );
  const missingValues = useMemo(
    () => selectedRawValues.filter((entry) => {
      if (entry === null || entry === undefined || String(entry) === "") return false;
      return resolveComboOption(entry, mergedChoices) === undefined;
    }),
    [mergedChoices, selectedRawValues],
  );
  const isMissingValue = isMultiSelect
    ? missingValues.length > 0
    : !hasValueMatch && !isServerResolvedPath && missingValues.length > 0;
  const valueString = hasValueMatch
    ? resolvedValueString ??
      (mergedChoices.includes(rawValueString) ? rawValueString : rawBase)
    : rawValueString;
  // Built once per real input change rather than on every render. Without this,
  // a parent re-render, a local state change (e.g. opening the picker), or a
  // search keystroke rebuilt the whole option list and ran modelLookup for every
  // choice — janky on combos with hundreds of models.
  const selectOptions = useMemo<SelectOption[]>(() => {
    const getDisplayLabel = (optionValue: string) => {
      // The " [input]" annotation is addressing, not part of the name.
      const named = splitPathAnnotation(optionValue).path;
      return stripSafetensorsSuffix
        ? named.replace(/\.safetensors$/i, "")
        : named;
    };
    // In model mode, prefer Lora Manager's display name; otherwise plain filename.
    const buildOption = (optionValue: string, rawValue: unknown = optionValue): SelectOption => {
      const model = isModelMode ? modelLookup!(optionValue) : null;
      const label = model?.model_name?.trim() || getDisplayLabel(optionValue);
      return { value: optionValue, label, model, rawValue };
    };
    const opts: SelectOption[] = [];
    if (value === null || hasNullChoice) {
      opts.push({ value: NULL_OPTION_VALUE, label: t("None") });
    }
    for (const missingValue of missingValues) {
      const missingString = String(missingValue);
      opts.push({
        value: missingString,
        rawValue: missingValue,
        label: getDisplayLabel(missingString),
        isMissing: true,
      });
    }
    opts.push(...mergedChoices.map((optionValue) => {
      const rawValue = rawChoiceByString.get(optionValue) ?? optionValue;
      return buildOption(optionValue, rawValue);
    }));
    return opts;
  }, [mergedChoices, isModelMode, modelLookup, stripSafetensorsSuffix, value, hasNullChoice, missingValues, rawChoiceByString, t]);
  const selectedOption =
    selectOptions.find((opt) => opt.value === valueString) ?? null;
  const selectedOptions = isMultiSelect
    ? (Array.isArray(value) ? value : value == null ? [] : [value])
        .map((entry) => selectOptions.find(
          // A null member selects the "None" option, which is keyed by the
          // sentinel rather than String(null).
          (opt) => opt.value === (entry === null ? NULL_OPTION_VALUE : String(entry)),
        ))
        .filter((option): option is SelectOption => option !== undefined)
    : [];
  const selectValue = isMultiSelect ? selectedOptions : selectedOption;
  const selectedLabel = isMultiSelect
    ? selectedOptions.map((option) => option.label).join(', ')
    : selectedOption?.label;
  const hasSelection = isMultiSelect ? selectedOptions.length > 0 : selectedOption !== null;
  const visibleSelectOptions = useMemo(
    () => isModelPicker && !showHidden
      ? selectOptions.filter((option) => !hasDotHiddenPathSegment(option.value))
      : selectOptions,
    [isModelPicker, selectOptions, showHidden],
  );

  // Model-picker base-model filter. Collect the distinct base_model values present
  // in the resolved options (plus whether any lack metadata → "Unknown").
  const { baseModelChoices, hasUnknownBaseModel } = useMemo(() => {
    if (!isModelMode) return { baseModelChoices: [] as string[], hasUnknownBaseModel: false };
    const set = new Set<string>();
    let hasUnknown = false;
    for (const opt of visibleSelectOptions) {
      if (!isFilterableOption(opt)) continue;
      const bm = opt.model?.base_model?.trim();
      if (bm) set.add(bm);
      else hasUnknown = true;
    }
    return {
      baseModelChoices: Array.from(set).sort((a, b) => a.localeCompare(b)),
      hasUnknownBaseModel: hasUnknown,
    };
  }, [isModelMode, visibleSelectOptions]);
  const showBaseModelFilter =
    isModelMode && (baseModelChoices.length > 0 || hasUnknownBaseModel);
  const baseModelFilterActive = showBaseModelFilter && baseModelFilter !== null;
  const modalSelectOptions =
    !baseModelFilterActive
      ? visibleSelectOptions
      : visibleSelectOptions.filter((opt) => {
          if (!isFilterableOption(opt)) return true;
          const bm = opt.model?.base_model?.trim();
          return baseModelFilter === BASE_MODEL_FILTER_UNKNOWN ? !bm : bm === baseModelFilter;
        });
  const baseModelFilterOptions: Array<{ key: string; value: string | null; label: string }> = [
    { key: "all", value: null, label: t("All") },
    ...baseModelChoices.map((bm) => ({ key: bm, value: bm, label: bm })),
    ...(hasUnknownBaseModel
      ? [{ key: "unknown", value: BASE_MODEL_FILTER_UNKNOWN, label: t("Unknown") }]
      : []),
  ];

  const simpleChoiceCount = isModelPicker
    ? visibleSelectOptions.filter((option) => option.value !== NULL_OPTION_VALUE).length
    : rawChoices.filter((option) => option !== null).length;
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
    // Marks the inline path: its open state is styled as one panel with the
    // portalled option list, which the modal's in-flow list must not inherit.
    "rs-inline",
    hasVisiblePin ? "rs-has-pin" : "rs-no-pin",
    compactTrailingControls ? "rs-compact-trailing" : "",
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

  // The colour that outlines an open list, and the control it hangs from.
  const comboAccent = hasError
    ? themeColors.border.errorDark
    : isPromoted
      ? themeColors.brand.promotedPink
      : themeColors.border.focusCyan;

  const menuPortalTarget =
    typeof document === "undefined" ? null : document.body;

  const handleClose = () => {
    setInternalModalOpen(false);
    setFilterMenuOpen(false);
    setBaseModelFilter(null);
    onModalClose?.();
  };

  const handleOpen = () => {
    if (disabled) return;
    if (onRequestModalOpen) {
      onRequestModalOpen();
      return;
    }
    if (useInputBrowser) {
      setInputPickerOpen(true);
    } else {
      setInternalModalOpen(true);
    }
  };

  // react-select clears its internal input for both `input-blur` and the
  // immediately-following `menu-close`. On iOS, tapping the keyboard's Done
  // button produces exactly that sequence, so returning the previous value for
  // those actions keeps the user's filter while still allowing selections to
  // clear it through the normal `set-value` action.
  const handleModalInputChange = (
    nextValue: string,
    actionMeta: InputActionMeta,
  ) =>
    actionMeta.action === "input-blur" || actionMeta.action === "menu-close"
      ? actionMeta.prevInputValue
      : nextValue;

  // Where the document sat before the tap. Recorded in the capture phase, so
  // it predates any scrolling the browser does on its own once focus lands.
  const handleInlinePointerDown = () => {
    inlineDocumentScrollRef.current = { x: window.scrollX, y: window.scrollY };
    inlineLastKeyRef.current = null;
  };

  // react-select does not forward onKeyDown, so the capture phase on the
  // wrapper is where a key press can be seen before react-select acts on it.
  const handleInlineKeyDownCapture = (event: React.KeyboardEvent) => {
    inlineLastKeyRef.current = event.key;
  };

  // Everything the open menu depends on is captured once, at open time, and
  // then held. See inlineComboScroll.ts for why nothing re-scrolls afterwards.
  const handleInlineMenuOpen = () => {
    setInlineMenuOpen(true);
    setInlineScrimVisible(true);
    cancelInlineScrimLinger.current?.();
    const target = inlineRootRef.current;
    if (!target) return;
    const scroller = findComboScroller(target);
    if (!scroller) return;

    inlineScrollHoldRef.current?.release();

    // Undo any scrolling that focusing the control provoked before measuring:
    // the top bar is fixed, so a moved document is a misaligned panel.
    const documentScroll = inlineDocumentScrollRef.current ?? {
      x: window.scrollX,
      y: window.scrollY,
    };
    if (
      window.scrollX !== documentScroll.x ||
      window.scrollY !== documentScroll.y
    ) {
      window.scrollTo(documentScroll.x, documentScroll.y);
    }

    // Where the combo is sitting now, so closing the list can put it back.
    inlineComboOffsetRef.current = measureInlineComboOffset(target, scroller);

    const alignment = measureInlineComboAlignment(target, scroller);
    applyInlineComboAlignment(scroller, alignment);

    inlineScrollerRef.current = scroller;
    inlineScrollHoldRef.current = holdInlineComboScroll(
      scroller,
      scroller.scrollTop,
      documentScroll,
    );
  };

  // Opening a combo is an excursion: the list goes to the top so it has room,
  // and closing it hands the reader back the view they were looking at.
  const restoreInlinePosition = () => {
    const scroller = inlineScrollerRef.current;
    const target = inlineRootRef.current;
    const offset = inlineComboOffsetRef.current;
    inlineScrollerRef.current = null;
    inlineComboOffsetRef.current = null;
    if (!scroller?.isConnected) return;
    if (!target || offset === null) {
      clearComboScrollSpace(scroller);
      return;
    }
    restoreInlineComboOffset(target, scroller, offset);
  };

  const handleInlineMenuClose = () => {
    setInlineMenuOpen(false);
    // A key press closes the list outright: nothing more is coming that the
    // scrim would need to absorb, and leaving an invisible catcher over the
    // page would only eat the reader's next click.
    const closedByKey = KEYS_THAT_CLOSE.has(inlineLastKeyRef.current ?? "");
    inlineLastKeyRef.current = null;
    cancelInlineScrimLinger.current?.();
    if (closedByKey) {
      setInlineScrimVisible(false);
      inlineScrollHoldRef.current?.release();
      inlineScrollHoldRef.current = null;
      restoreInlinePosition();
      return;
    }

    // Otherwise the scrim sees out the press that dismissed it — no longer,
    // or it would block the next scroll — and hands over to a listener that
    // cancels the stray click a tap can leave behind.
    let stopGuard: (() => void) | null = null;
    const stopWaiting = afterCurrentPress(() => {
      setInlineScrimVisible(false);
      stopGuard = guardAgainstGhostClick();
    });
    cancelInlineScrimLinger.current = () => {
      stopWaiting();
      stopGuard?.();
      cancelInlineScrimLinger.current = null;
    };

    inlineScrollHoldRef.current?.release();
    inlineScrollHoldRef.current = null;
    restoreInlinePosition();
  };

  useEffect(
    () => () => {
      inlineScrollHoldRef.current?.release();
      cancelInlineScrimLinger.current?.();
      // On unmount the view has usually moved on already; give the borrowed
      // range back but do not haul the scroller anywhere.
      const scroller = inlineScrollerRef.current;
      if (scroller?.isConnected) clearComboScrollSpace(scroller);
    },
    [],
  );

  const handleSelectChange = (next: OnChangeValue<SelectOption, boolean>) => {
    const nextValue = comboSelectionToValue(next, isMultiSelect);
    if (nextValue === undefined) return;
    onChange(nextValue);
  };

  const handleModalSelectChange = (next: OnChangeValue<SelectOption, boolean>) => {
    handleSelectChange(next);
    if (!isMultiSelect) handleClose();
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
      const uploadedPath = result.subfolder
        ? `${result.subfolder}/${result.name}`
        : result.name;
      // An upload into a subfolder can never be an object_info combo choice,
      // so the value names its own directory. See annotateInputPath.
      const nextValue = result.type === "input"
        ? annotateInputPath(uploadedPath)
        : uploadedPath;
      // Auto-hiding the new input is best-effort declutter — never let it abort
      // the upload assignment, so fire-and-forget instead of awaiting.
      if (hiddenWorkflow && result.type === "input") {
        void setFileState("input", uploadedPath, "hidden", true).catch((err) => {
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
        void setFileState("input", splitPathAnnotation(nextValue).path, "hidden", true)
          .catch((err) => {
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
      setError(t("Failed to sync file selection"));
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
        {isUploading ? t("Uploading...") : uploadLabel}
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
        {t('Browse files')}
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
      selectedValue={value}
    />
  ) : null;

  const selectText = themeColors.text.onDark;

  if (useInputBrowser) {
    const browserOpen = forceModalOpen || inputPickerOpen;
    return (
      <div className={`${containerClass} combo-control-root combo-control-input-browser pt-2`}>
        {!hideLabel && (
          <ControlLabelRow
            name={name}
            displayLabel={displayLabel}
            isPromoted={isPromoted}
            boundaryAnnotation={boundaryAnnotation}
          onBoundaryJump={onBoundaryJump}
            labelAccessory={labelAccessory}
            iconClassName="w-5 h-5 text-pink-500"
          />
        )}
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-label={t('Select {name}', { name: name.replace(/_/g, " ") })}
          aria-disabled={disabled}
          className={`combo-control-trigger relative w-full p-3 comfy-input text-base flex items-center justify-between min-h-[46px] text-left ${controlStateClassName({ disabled, hasError, isPromoted })}`}
          onClick={handleOpen}
          onKeyDown={(event) => {
            if (!disabled && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              handleOpen();
            }
          }}
        >
          <span className={`truncate min-w-0 flex-1 text-slate-100 ${hasVisiblePin ? "pr-16" : "pr-6"}`}>
            {selectedLabel || valueString || t("Select...")}
          </span>
          <span className="absolute right-0 top-0 bottom-0 flex items-center pointer-events-none">
            <span className="px-2 text-slate-400"><ChevronDownIcon className="w-5 h-5" /></span>
            {hasVisiblePin && (
              <span className="pointer-events-auto px-2">
                <PinButton isPinned={isPinned} onToggle={onTogglePin} />
              </span>
            )}
          </span>
        </div>
        {isMissingValue && <div className="mt-1 pl-1 text-xs text-red-400">{t('Missing on ComfyUI server')}</div>}
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
          selectedValue={value}
        />
      </div>
    );
  }

  if (useModalFlow) {
    return (
      <div
        className={`${containerClass} combo-control-root combo-control-modal pt-2`}
      >
        {!hideLabel && (
          <ControlLabelRow
            name={name}
            displayLabel={displayLabel}
            isPromoted={isPromoted}
            boundaryAnnotation={boundaryAnnotation}
          onBoundaryJump={onBoundaryJump}
            labelAccessory={labelAccessory}
            iconClassName="w-5 h-5 text-pink-500"
          />
        )}

        <div
          className={`combo-control-trigger relative w-full p-3 comfy-input text-base flex items-center justify-between min-h-[46px] ${controlStateClassName({ disabled, hasError, isPromoted })}`}
          onClick={handleOpen}
        >
          {isModelMode && selectedOption?.model ? (
            <div
              className={`min-w-0 flex-1 text-slate-100 ${
                compactTrailingControls
                  ? hasVisiblePin ? "pr-13" : "pr-6"
                  : hasVisiblePin ? "pr-16" : "pr-10"
              }`}
            >
              <ModelRowContent option={selectedOption} />
            </div>
          ) : (
            <span
              className={`combo-control-trigger-label truncate min-w-0 flex-1 ${!hasSelection ? "text-slate-500" : "text-slate-100"} ${
                compactTrailingControls
                  ? hasVisiblePin ? "pr-13" : "pr-6"
                  : hasVisiblePin ? "pr-16" : "pr-6"
              }`}
              style={
                hasSelection ? { color: themeColors.text.onDark } : undefined
              }
            >
              {selectedLabel || t("Select...")}
            </span>
          )}

          <div className="combo-control-trigger-icons flex items-center absolute right-0 top-0 bottom-0 pointer-events-none">
            <div className={`combo-control-chevron text-slate-400 ${
              compactTrailingControls
                ? "flex w-9 items-center justify-center"
                : "px-2"
            }`}>
              <ChevronDownIcon className="h-5 w-5" />
            </div>
            {hasVisiblePin && (
              <div className={`combo-control-pin pointer-events-auto ${
                compactTrailingControls ? "flex w-7 items-center justify-center" : "px-2"
              }`}>
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
            {t('Missing on ComfyUI server')}
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
          title={displayLabel ?? name}
          isOpen={showModal}
          onClose={handleClose}
          viewerSidebar={forceModalOpen}
        >
          <div data-swipe-nav-ignore="true">
            {/* The search bar + results span the full width; the funnel floats over
                the control's top-right corner (the control reserves right padding
                for it), so results aren't squished into a narrower column. */}
            <div className="relative">
            <Select<SelectOption, boolean>
              className={modalSelectClassName}
              classNamePrefix="rs"
          classNames={{ control: () => controlJumpSurfaceClassName }}
              options={modalSelectOptions}
              value={selectValue}
              onChange={handleModalSelectChange}
              isMulti={isMultiSelect}
              isSearchable
              autoFocus={!forceModalOpen}
              menuIsOpen={forceModalOpen ? undefined : true}
              controlShouldRenderValue={true}
              placeholder={t("Search...")}
              onInputChange={handleModalInputChange}
              filterOption={createFilter({
                ignoreAccents: true,
                ignoreCase: true,
                trim: true,
                matchFrom: "any",
              })}
              styles={{
                // Outlined and joined to the search box, the same way an
                // inline list is — one panel rather than a box and a loose
                // column of rows. The bottom margin is the scroll clearance
                // that used to sit inside the list; keeping it outside puts
                // the outline's bottom edge against the last option.
                menu: (base) => ({
                  ...base,
                  position: "static",
                  boxShadow: "none",
                  border: `1px solid ${comboAccent}`,
                  borderTop: 0,
                  marginTop: 0,
                  marginBottom: "2rem",
                  borderRadius: "0 0 0.5rem 0.5rem",
                  backgroundColor: themeColors.transparent,
                }),
                menuList: (base) => ({
                  ...base,
                  // FullscreenWidgetModal already owns the keyboard-aware
                  // vertical scroller. A second menu scroller sized from 100vh
                  // can extend below a WKWebView keyboard and trap touch
                  // gestures before the outer modal reaches its last rows.
                  maxHeight: "none",
                  height: "auto",
                  overflow: "visible",
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
                    paddingRight: showBaseModelFilter && isModelPicker
                      ? "5rem"
                      : showBaseModelFilter || isModelPicker
                        ? "2.75rem"
                        : undefined,
                    borderColor,
                    boxShadow: state.isFocused || hasError || isPromoted
                      ? `0 0 0 1px ${borderColor}`
                      : "none",
                    backgroundColor: comboInputBackground,
                    color: selectText,
                    ...(state.menuIsOpen
                      ? {
                          borderColor: comboAccent,
                          borderBottomColor: themeColors.transparent,
                          // Matches the radius the list caps itself with.
                          borderRadius: "0.5rem 0.5rem 0 0",
                          boxShadow: "none",
                        }
                      : {}),
                  };
                },
              }}
              components={selectComponents}
              noOptionsMessage={() => t("No matches")}
            />
              {(showBaseModelFilter || isModelPicker) && (
                <div className="combo-control-filter absolute right-1.5 top-[5px] flex gap-1">
                  {isModelPicker && (
                    <button
                      type="button"
                      aria-label={showHidden ? t("Hide hidden") : t("Show hidden")}
                      onClick={toggleShowHidden}
                      className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
                        showHidden
                          ? appChromeIconButtonActiveClassName
                          : appChromeIconButtonClassName
                      }`}
                    >
                      {showHidden
                        ? <EyeOffIcon className="h-[18px] w-[18px]" />
                        : <EyeIcon className="h-[18px] w-[18px]" />}
                    </button>
                  )}
                  {showBaseModelFilter && (
                    <div className="relative">
                  <button
                    type="button"
                    aria-label={t("Filter by base model")}
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
              )}
            </div>
          </div>
        </FullscreenWidgetModal>
      </div>
    );
  }

  return (
    <div
      className={`${containerClass} combo-control-root combo-control-inline pt-2`}
      ref={inlineRootRef}
    >
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
      {inlineScrimVisible && (
        <InlineComboScrim
          controlRoot={inlineRootRef.current}
          dimmed={inlineMenuOpen}
          onDismiss={handleInlineMenuClose}
        />
      )}
      <div
        className="combo-control-input-wrapper relative"
        data-swipe-nav-ignore="true"
        onPointerDownCapture={handleInlinePointerDown}
        onKeyDownCapture={handleInlineKeyDownCapture}
      >
        <Select<SelectOption, boolean>
          className={selectClassName}
          classNamePrefix="rs"
          classNames={{ control: () => controlJumpSurfaceClassName }}
          options={visibleSelectOptions}
          value={selectValue}
          onChange={handleSelectChange}
          isMulti={isMultiSelect}
          // A touch device only reaches the inline path for a handful of
          // options, where a search field buys nothing and costs a lot: the
          // on-screen keyboard it summons resizes the visual viewport and lets
          // the browser scroll the document out from under a fixed top bar.
          // react-select's non-searchable input carries inputMode="none", so
          // no keyboard appears.
          isSearchable={!isCoarsePointer}
          isDisabled={disabled}
          filterOption={createFilter({
            ignoreAccents: true,
            ignoreCase: true,
            trim: true,
            matchFrom: "any",
          })}
          menuIsOpen={inlineMenuOpen}
          menuPortalTarget={menuPortalTarget}
          // Absolute document coordinates stay coupled to the control when a
          // mobile keyboard pans the visual viewport. Fixed portal coordinates
          // can render above the control by the viewport's offsetTop.
          menuPosition="absolute"
          menuPlacement="bottom"
          menuShouldScrollIntoView={false}
          onMenuOpen={handleInlineMenuOpen}
          onMenuClose={handleInlineMenuClose}
          styles={{
            menuPortal: (base) => ({
              ...base,
              zIndex: INLINE_COMBO_MENU_Z,
              // The list is portalled to the body, so it cannot inherit the
              // control's accent; hand it over explicitly.
              "--rs-accent": comboAccent,
            }),
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
          noOptionsMessage={() => t("No matches")}
        />
        <div className="combo-control-icons absolute right-0 top-0 bottom-0 flex items-center pointer-events-none">
          <div className={`combo-control-chevron text-slate-400 ${
              compactTrailingControls
              ? "flex w-9 items-center justify-center"
              : "px-2"
          }`}>
            <ChevronDownIcon className="h-5 w-5" />
          </div>
          {hasVisiblePin && (
            <div className={`combo-control-pin pointer-events-auto ${
              compactTrailingControls ? "flex w-7 items-center justify-center" : "px-2"
            }`}>
              <PinButton
                isPinned={isPinned}
                onToggle={onTogglePin}
              />
            </div>
          )}
          {!hasVisiblePin && !compactTrailingControls && <div className="w-3" />}
        </div>
      </div>
      {isMissingValue && (
        <div className="mt-1 pl-1 text-xs text-red-400">
            {t('Missing on ComfyUI server')}
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

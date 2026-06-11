import { XMarkIcon } from "@/components/icons";

interface CloseButtonProps {
  onClick: () => void;
  ariaLabel?: string;
  variant?: "default" | "plain";
  buttonSize?: number;
  iconSize?: number;
  isIdle?: boolean;
  zIndex?: number;
  disabled?: boolean;
}

export function CloseButton({
  onClick,
  ariaLabel = "Close",
  variant = "default",
  buttonSize = 10,
  iconSize = 6,
  isIdle,
  zIndex,
  disabled = false,
}: CloseButtonProps) {
  // MediaViewer passes isIdle/zIndex and always uses the floating overlay close treatment.
  const isViewerVariant = typeof isIdle === "boolean" || typeof zIndex === "number";
  const resolvedVariant = isViewerVariant ? "viewer" : variant;

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`transition-colors flex items-center justify-center rounded-full ${disabled ? "opacity-40 cursor-not-allowed " : ""}${
        // Used by MediaViewer overlays.
        resolvedVariant === "viewer"
          ? `absolute top-3 right-3 w-${buttonSize} h-${buttonSize} text-white ${isIdle ? "bg-transparent" : "bg-black/60"}`
          // Used by SearchActionModal and OutputsPanel FilterModal headers.
          : resolvedVariant === "plain"
            ? `w-${buttonSize} h-${buttonSize} text-slate-400 bg-transparent hover:text-slate-100 hover:bg-transparent`
            // Used by default modal headers like FullscreenModalHeader.
            : `w-${buttonSize} h-${buttonSize} bg-slate-950/80 border border-white/10 text-slate-400 hover:text-slate-100 hover:bg-white/10`
      }`.trim()}
      style={isViewerVariant && typeof zIndex === "number" ? { zIndex } : undefined}
      aria-label={ariaLabel}
    >
      <XMarkIcon className={`w-${iconSize} h-${iconSize}`} />
    </button>
  );
}

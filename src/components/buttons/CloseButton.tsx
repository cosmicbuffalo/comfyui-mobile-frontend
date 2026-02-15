import { XMarkIcon } from "@/components/icons";

interface CloseButtonProps {
  onClick: () => void;
  ariaLabel?: string;
  variant?: "default" | "plain";
  buttonSize?: number;
  iconSize?: number;
  isIdle?: boolean;
  zIndex?: number;
}

export function CloseButton({
  onClick,
  ariaLabel = "Close",
  variant = "default",
  buttonSize = 10,
  iconSize = 6,
  isIdle,
  zIndex,
}: CloseButtonProps) {
  // MediaViewer passes isIdle/zIndex and always uses the floating overlay close treatment.
  const isViewerVariant = typeof isIdle === "boolean" || typeof zIndex === "number";
  const resolvedVariant = isViewerVariant ? "viewer" : variant;

  return (
    <button
      onClick={onClick}
      className={`transition-colors flex items-center justify-center rounded-full ${
        // Used by MediaViewer overlays.
        resolvedVariant === "viewer"
          ? `absolute top-3 right-3 w-${buttonSize} h-${buttonSize} text-white ${isIdle ? "bg-transparent" : "bg-black/60"}`
          // Used by SearchActionModal and OutputsPanel FilterModal headers.
          : resolvedVariant === "plain"
            ? `w-${buttonSize} h-${buttonSize} text-gray-500 bg-transparent hover:bg-transparent`
            // Used by default modal headers like FullscreenModalHeader.
            : `w-${buttonSize} h-${buttonSize} bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700`
      }`.trim()}
      style={isViewerVariant && typeof zIndex === "number" ? { zIndex } : undefined}
      aria-label={ariaLabel}
    >
      <XMarkIcon className={`w-${iconSize} h-${iconSize}`} />
    </button>
  );
}

const workflowColorPalette = {
  nocolor: "#353535",
  red: "#553333",
  brown: "#593930",
  green: "#335533",
  blue: "#333355",
  pale_blue: "#3f5159",
  cyan: "#335555",
  purple: "#553355",
  yellow: "#665533",
  black: "#000000",
} as const;

export const workflowColorPickerOptions = [
  { key: "nocolor", label: "No color", color: workflowColorPalette.nocolor },
  { key: "red", label: "Red", color: workflowColorPalette.red },
  { key: "brown", label: "Brown", color: workflowColorPalette.brown },
  { key: "green", label: "Green", color: workflowColorPalette.green },
  { key: "blue", label: "Blue", color: workflowColorPalette.blue },
  { key: "pale_blue", label: "Pale blue", color: workflowColorPalette.pale_blue },
  { key: "cyan", label: "Cyan", color: workflowColorPalette.cyan },
  { key: "purple", label: "Purple", color: workflowColorPalette.purple },
  { key: "yellow", label: "Yellow", color: workflowColorPalette.yellow },
  // Keep pure black available for workflow parsing, but omit from picker to avoid unreadable tints.
] as const;

export function resolveWorkflowColor(value: string | null | undefined): string {
  if (!value) return workflowColorPalette.nocolor;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return workflowColorPalette.nocolor;

  if (normalized in workflowColorPalette) {
    return workflowColorPalette[normalized as keyof typeof workflowColorPalette];
  }
  if (normalized === "pale blue") {
    return workflowColorPalette.pale_blue;
  }
  return value.trim();
}

export const themeColors = {
  transparent: "transparent",
  transparentBlack: "rgba(0, 0, 0, 0)",
  text: {
    secondary: "#6b7280",
    muted: "#9ca3af",
    onDark: "#e5e7eb",
  },
  border: {
    gray200: "#e5e7eb",
    nodeHeaderTint: "rgba(0, 0, 0, 0.24)",
    errorDark: "#7f1d1d",
    focusCyan: "#22d3ee",
  },
  surface: {
    // Dropdown menu + option backgrounds (mirror the .rs__menu / .rs__option--* CSS).
    menu: "#0b1320",
    optionFocused: "#111827",
    optionSelected: "#1f2937",
  },
  status: {
    success: "#10b981",
    successStrong: "rgba(16,185,129,0.9)",
    warning: "#f59e0b",
    danger: "#ef4444",
  },
  brand: {
    blue400: "#60a5fa",
    blue500: "#3b82f6",
    bypassPurple: "#9333ea",
    promotedPink: "#ec4899",
    subgraphBackground08: "rgba(59, 130, 246, 0.08)",
    subgraphBackground10: "rgba(59, 130, 246, 0.10)",
    subgraphBackground14: "rgba(59, 130, 246, 0.14)",
    subgraphBorder20: "rgba(59, 130, 246, 0.20)",
    subgraphBorder25: "rgba(59, 130, 246, 0.25)",
  },
  workflow: {
    defaultGroupDot: "#9ca3af",
    fastGroupBypassColors: workflowColorPalette,
  },
} as const;

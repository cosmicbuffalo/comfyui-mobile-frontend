export const controlLabelClassName = "block text-sm font-medium text-slate-300";

export const controlInputBaseClassName =
  "w-full p-3 comfy-input text-base";

export const controlInputDarkClassName =
  "text-slate-100 bg-slate-950/80 border-white/10 placeholder:text-slate-500";

export const controlInputFocusClassName =
  "focus:ring-cyan-400 focus:border-cyan-400";

export function controlInputFocusClassNameForState(isPromoted?: boolean): string {
  return isPromoted
    ? "focus:ring-pink-500 focus:border-pink-500"
    : controlInputFocusClassName;
}

export const controlModalInputBaseClassName =
  "w-full p-3 border rounded-lg text-base text-slate-100 bg-slate-950/80 placeholder:text-slate-500 outline-none focus:ring-2";

export const controlSecondaryButtonClassName =
  "w-full py-2 px-3 bg-slate-950/80 border border-white/10 rounded-lg text-sm font-medium text-slate-200 enabled:hover:bg-slate-800/95 enabled:hover:text-cyan-300 enabled:hover:border-cyan-400/40 transition disabled:opacity-50 disabled:cursor-not-allowed";

export const controlSecondaryButtonDisabledClassName =
  "opacity-60 cursor-not-allowed border-white/10 text-slate-500 bg-slate-950/80";

export const controlSecondaryButtonEnabledClassName =
  "border-white/10 text-slate-200 bg-slate-950/80 hover:border-cyan-400/40 hover:text-cyan-300";

export const controlDangerButtonClassName =
  "py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed";

export const controlGhostButtonClassName =
  "py-2 px-3 border border-white/10 rounded-lg text-sm font-medium text-slate-300 hover:text-cyan-300 hover:border-cyan-400/40 transition disabled:opacity-60 disabled:cursor-not-allowed";

export const controlDashedButtonClassName =
  "w-full py-2 px-4 border-2 border-dashed border-white/15 rounded-lg text-sm font-medium text-slate-400 hover:text-cyan-300 hover:border-cyan-400/40 transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed";

export const controlNestedSurfaceClassName =
  "border border-white/10 rounded-lg bg-slate-950/60";

export function controlStateClassName({
  disabled,
  hasError,
  isPromoted,
}: {
  disabled?: boolean;
  hasError?: boolean;
  isPromoted?: boolean;
}): string {
  return [
    disabled ? "opacity-60 cursor-not-allowed" : "",
    hasError ? "border-red-500 ring-1 ring-red-500" : "",
    !hasError && isPromoted
      ? "border-pink-500 ring-1 ring-pink-500 focus:border-pink-500 focus:ring-pink-500"
      : "",
  ].filter(Boolean).join(" ");
}

export function controlModalFocusClassName(isPromoted?: boolean): string {
  return isPromoted
    ? "border-pink-500 focus:ring-pink-500/20 focus:border-pink-500"
    : "border-white/10 focus:ring-cyan-400/20 focus:border-cyan-400";
}

export function controlToggleButtonClassName({
  active,
  disabled,
  radius = "full",
}: {
  active: boolean;
  disabled?: boolean;
  radius?: "full" | "lg";
}): string {
  return [
    radius === "full" ? "rounded-full" : "rounded-lg",
    "font-semibold transition-colors",
    active ? "bg-cyan-500 text-slate-950" : "bg-slate-700 text-slate-200",
    disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
  ].filter(Boolean).join(" ");
}

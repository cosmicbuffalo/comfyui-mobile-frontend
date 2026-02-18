const DEFAULT_LORA_MANAGER_UI_PATH = "/loras";
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function toAllowedAbsoluteUrl(value: string): string | null {
  if (typeof window === "undefined") return value;
  try {
    const nextUrl = new URL(value, window.location.origin);
    if (!ALLOWED_PROTOCOLS.has(nextUrl.protocol)) return null;
    return nextUrl.toString();
  } catch {
    return null;
  }
}

export function getLoraManagerUiUrl(): string {
  const envUrl =
    typeof import.meta !== "undefined" &&
    import.meta.env &&
    typeof import.meta.env.VITE_LORA_MANAGER_UI_URL === "string"
      ? import.meta.env.VITE_LORA_MANAGER_UI_URL.trim()
      : "";
  if (envUrl) {
    const resolved = toAllowedAbsoluteUrl(envUrl);
    if (resolved) return resolved;
  }

  const localOverride =
    typeof window !== "undefined"
      ? window.localStorage.getItem("comfyui-mobile-lora-manager-ui-url")?.trim() ?? ""
      : "";
  if (localOverride) {
    const resolved = toAllowedAbsoluteUrl(localOverride);
    if (resolved) return resolved;
  }

  const fallback = toAllowedAbsoluteUrl(DEFAULT_LORA_MANAGER_UI_PATH);
  return fallback ?? DEFAULT_LORA_MANAGER_UI_PATH;
}

export function openLoraManagerUiInNewTab(): boolean {
  if (typeof window === "undefined") return false;
  const nextWindow = window.open(
    getLoraManagerUiUrl(),
    "_blank",
    "noopener,noreferrer",
  );
  return nextWindow !== null;
}

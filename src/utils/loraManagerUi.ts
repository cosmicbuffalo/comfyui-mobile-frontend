const DEFAULT_LORA_MANAGER_UI_PATH = "/loras";

function toAbsoluteUrl(value: string): string {
  if (typeof window === "undefined") return value;
  return new URL(value, window.location.origin).toString();
}

export function getLoraManagerUiUrl(): string {
  const envUrl =
    typeof import.meta !== "undefined" &&
    import.meta.env &&
    typeof import.meta.env.VITE_LORA_MANAGER_UI_URL === "string"
      ? import.meta.env.VITE_LORA_MANAGER_UI_URL.trim()
      : "";
  if (envUrl) return toAbsoluteUrl(envUrl);

  const localOverride =
    typeof window !== "undefined"
      ? window.localStorage.getItem("comfyui-mobile-lora-manager-ui-url")?.trim() ?? ""
      : "";
  if (localOverride) return toAbsoluteUrl(localOverride);

  return toAbsoluteUrl(DEFAULT_LORA_MANAGER_UI_PATH);
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

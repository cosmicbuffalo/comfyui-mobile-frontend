import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshLoraManagerModels } from "../loraManagerClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("refreshLoraManagerModels", () => {
  it("scans before fetching metadata for the refreshed catalog", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: "success" }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshLoraManagerModels("loras")).resolves.toBe(true);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/lm/loras/scan?full_rebuild=false",
      { cache: "no-store" },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/lm/loras/fetch-all-civitai",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
  });

  it("does not fetch metadata when LoRA Manager cancels the scan", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ status: "cancelled" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshLoraManagerModels("checkpoints")).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a metadata operation failure even when its response is HTTP 200", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: "success" }))
      .mockResolvedValueOnce(jsonResponse({ success: false }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(refreshLoraManagerModels("embeddings")).resolves.toBe(false);
  });
});

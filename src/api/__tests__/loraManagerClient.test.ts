import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMissingStandalone, refreshLoraManagerModels } from "../loraManagerClient";

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

describe("fetchMissingStandalone", () => {
  it("returns once the server has queued nothing to wait for", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ queued: 0, pending: 0 }, 202));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMissingStandalone("checkpoints", ["a.safetensors"], 0)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("polls the queue rather than holding the request open", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ queued: 2, pending: 2 }, 202))
      .mockResolvedValueOnce(jsonResponse({ pending: 1 }))
      .mockResolvedValueOnce(jsonResponse({ pending: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMissingStandalone("checkpoints", ["a.safetensors", "b.safetensors"], 0)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/mobile/api/models/checkpoints/fetch-missing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: ["a.safetensors", "b.safetensors"] }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/mobile/api/models/checkpoints/fetch-missing", { cache: "no-store" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports failure when the status check fails", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ queued: 1, pending: 1 }, 202))
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMissingStandalone("checkpoints", ["a.safetensors"], 0)).resolves.toBe(false);
  });

  it("reports a disabled switch as failure", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ error: "disabled" }, 403)));

    await expect(fetchMissingStandalone("checkpoints", ["a.safetensors"], 0)).resolves.toBe(false);
  });
});

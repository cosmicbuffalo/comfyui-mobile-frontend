import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLoraManagerMetadataStore } from "@/hooks/useLoraManagerMetadata";
import { MenuRefreshMetadataButton } from "../MenuRefreshMetadataButton";

describe("MenuRefreshMetadataButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useLoraManagerMetadataStore.setState({
      refreshing: false,
      refreshDone: false,
      refreshLabel: null,
      refreshError: null,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows a green Done confirmation before returning to its normal label", async () => {
    await act(async () => {
      useLoraManagerMetadataStore.setState({ refreshDone: true });
      root.render(<MenuRefreshMetadataButton />);
    });

    const button = container.querySelector("button")!;
    expect(button.textContent?.trim()).toBe("Done!");
    expect(button.disabled).toBe(true);
    expect(button.querySelector("svg")?.classList.contains("text-emerald-400")).toBe(true);

    await act(async () => {
      useLoraManagerMetadataStore.setState({ refreshDone: false });
    });
    expect(button.textContent?.trim()).toBe("Refresh model metadata");
    expect(button.disabled).toBe(false);
  });
});

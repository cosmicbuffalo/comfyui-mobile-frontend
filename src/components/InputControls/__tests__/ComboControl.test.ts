import { describe, expect, it } from "vitest";
import {
  resolveUploadFolder,
  isOutputFileSelectable,
} from "@/components/InputControls/outputPickerUtils";

describe("ComboControl output picker helpers", () => {
  it("keeps image uploads in the configured image folder", () => {
    expect(resolveUploadFolder(false, "mask_inputs")).toBe("mask_inputs");
  });

  it("forces video uploads into the input folder", () => {
    expect(resolveUploadFolder(true, "mask_inputs")).toBe("input");
  });

  it("only allows images for image upload combos", () => {
    expect(isOutputFileSelectable("image", false)).toBe(true);
    expect(isOutputFileSelectable("video", false)).toBe(false);
    expect(isOutputFileSelectable("folder", false)).toBe(false);
  });

  it("only allows videos for video upload combos", () => {
    expect(isOutputFileSelectable("video", true)).toBe(true);
    expect(isOutputFileSelectable("image", true)).toBe(false);
    expect(isOutputFileSelectable("folder", true)).toBe(false);
  });
});

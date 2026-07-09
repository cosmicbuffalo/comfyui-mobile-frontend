import { describe, expect, it } from "vitest";
import {
  resolveUploadFolder,
  isOutputFileSelectable,
} from "@/components/InputControls/outputPickerUtils";

describe("ComboControl output picker helpers", () => {
  it("keeps image uploads in the configured custom image folder", () => {
    expect(resolveUploadFolder(false, "mask_inputs")).toBe("mask_inputs");
  });

  it("routes output/temp image picks into the input folder", () => {
    // LoadImageOutput & friends read from input/ by default and the frontend
    // emits no path annotation, so output/temp picks must land in input/.
    expect(resolveUploadFolder(false, "output")).toBe("input");
    expect(resolveUploadFolder(false, "temp")).toBe("input");
  });

  it("leaves explicit input image uploads in input", () => {
    expect(resolveUploadFolder(false, "input")).toBe("input");
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

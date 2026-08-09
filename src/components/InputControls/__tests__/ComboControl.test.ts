import { describe, expect, it } from "vitest";
import {
  resolveUploadFolder,
  isOutputFileSelectable,
} from "@/components/InputControls/outputPickerUtils";
import { comboSelectionToValue } from "@/components/InputControls/comboSelection";

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

  it("emits typed arrays for multi-select combos", () => {
    expect(comboSelectionToValue([
      { value: "0", label: "Background", rawValue: 0 },
      { value: "2", label: "Hair", rawValue: 2 },
    ], true)).toEqual([0, 2]);
    expect(comboSelectionToValue([], true)).toEqual([]);
  });

  it("decodes the None sentinel to null in multi-select selections", () => {
    // The "None" option carries no rawValue, so without decoding, the literal
    // sentinel string leaked into the submitted array.
    expect(comboSelectionToValue([
      { value: "__null__", label: "None" },
      { value: "hair", label: "Hair", rawValue: "hair" },
    ], true)).toEqual([null, "hair"]);
  });
});

import { describe, expect, it } from "vitest";
import type { FileItem } from "@/api/client";
import {
  getInputPickerValue,
  projectInputSearchResults,
  sortInputPickerFiles,
} from "@/components/InputControls/inputPickerUtils";

const file = (id: string, date = 0): FileItem => ({
  id,
  name: id.split("/").pop()!,
  type: "image",
  date,
});

describe("input picker helpers", () => {
  it("preserves nested input paths as widget values", () => {
    expect(getInputPickerValue(file("input/reference/faces/a.png"))).toBe("reference/faces/a.png");
  });

  it("strips the matching source prefix for output picks", () => {
    expect(getInputPickerValue(file("output/renders/a.png"), "output")).toBe("renders/a.png");
  });

  it("projects output search results under the output source prefix", () => {
    expect(projectInputSearchResults([
      file("output/renders/faces/a.png", 2),
      file("output/b.png", 1),
    ], null, "output")).toEqual([
      expect.objectContaining({ id: "output/renders", name: "renders", type: "folder", matchCount: 1 }),
      expect.objectContaining({ id: "output/b.png" }),
    ]);
  });

  it("projects recursive search results into navigable child folders", () => {
    expect(projectInputSearchResults([
      file("input/reference/faces/a.png", 3),
      file("input/reference/b.png", 2),
      file("input/c.png", 1),
    ], null)).toEqual([
      expect.objectContaining({ id: "input/reference", name: "reference", type: "folder", matchCount: 2 }),
      expect.objectContaining({ id: "input/c.png" }),
    ]);
    expect(projectInputSearchResults([
      file("input/reference/faces/a.png", 3),
      file("input/reference/b.png", 2),
    ], "reference")).toEqual([
      expect.objectContaining({ id: "input/reference/faces", matchCount: 1 }),
      expect.objectContaining({ id: "input/reference/b.png" }),
    ]);
  });

  it("sorts picker files using outputs sort modes", () => {
    const files = [file("input/b.png", 1), file("input/a.png", 2)];
    expect(sortInputPickerFiles(files, "name").map((item) => item.name)).toEqual(["a.png", "b.png"]);
    expect(sortInputPickerFiles(files, "modified").map((item) => item.name)).toEqual(["a.png", "b.png"]);
  });
});

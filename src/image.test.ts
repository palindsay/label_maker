import { describe, expect, it } from "vitest";
import { fileToDataUrl, labelPngFilename } from "./image";

describe("fileToDataUrl", () => {
  it("reads a blob into a data URL", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const url = await fileToDataUrl(blob);
    expect(url).toMatch(/^data:text\/plain/);
  });
});

describe("labelPngFilename", () => {
  it("slugifies a peptide name into a .png filename", () => {
    expect(labelPngFilename("BPC-157")).toBe("bpc-157-label.png");
  });

  it("collapses spaces and strips special characters", () => {
    expect(labelPngFilename("  GLP / GIP  ")).toBe("glp-gip-label.png");
  });

  it("falls back to 'label' for an empty or symbol-only name", () => {
    expect(labelPngFilename("")).toBe("label.png");
    expect(labelPngFilename("   ")).toBe("label.png");
    expect(labelPngFilename("///")).toBe("label.png");
  });
});

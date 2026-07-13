import { describe, expect, it } from "vitest";
import { fileToDataUrl } from "./image";

describe("fileToDataUrl", () => {
  it("reads a blob into a data URL", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const url = await fileToDataUrl(blob);
    expect(url).toMatch(/^data:text\/plain/);
  });
});

import { describe, expect, it } from "vitest";
import type { AutofillStage } from "./autofill";
import { formatElapsed, stageLabel } from "./progress";

describe("stageLabel", () => {
  it("has a human label for every stage", () => {
    const stages: AutofillStage[] = [
      "reading-image",
      "reading-photo",
      "fetching-coa",
      "reading-coa",
      "reading-url",
    ];
    for (const s of stages) {
      expect(stageLabel(s).length).toBeGreaterThan(3);
    }
    expect(stageLabel("fetching-coa")).toMatch(/Certificate of Analysis/);
  });
});

describe("formatElapsed", () => {
  it("shows seconds under a minute", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(9_400)).toBe("9s");
    expect(formatElapsed(59_999)).toBe("59s");
  });

  it("shows minutes and zero-padded seconds at/after a minute", () => {
    expect(formatElapsed(60_000)).toBe("1m 00s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
    expect(formatElapsed(125_000)).toBe("2m 05s");
  });

  it("never goes negative", () => {
    expect(formatElapsed(-500)).toBe("0s");
  });
});

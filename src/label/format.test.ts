import { describe, expect, it } from "vitest";
import { mmToPx } from "./format";

describe("mmToPx", () => {
  it("converts millimetres to pixels at 96 dpi by default", () => {
    // 25.4mm == 1 inch == 96px
    expect(mmToPx(25.4)).toBeCloseTo(96, 5);
  });

  it("honours a custom dpi", () => {
    expect(mmToPx(25.4, 300)).toBeCloseTo(300, 5);
  });

  it("rejects non-finite input", () => {
    expect(() => mmToPx(Number.NaN)).toThrow();
    expect(() => mmToPx(Number.POSITIVE_INFINITY)).toThrow();
  });
});

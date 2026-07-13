import { describe, expect, it } from "vitest";
import { formatConcentration, formatMcg, formatMg, formatUnits, reconstitution } from "./peptide";

describe("reconstitution", () => {
  it("computes the canonical 5mg / 2mL / 250mcg case", () => {
    const r = reconstitution({ vialMg: 5, bacWaterMl: 2, doseMcg: 250 });
    expect(r.concentrationMcgPerMl).toBeCloseTo(2500, 6);
    expect(r.doseVolumeMl).toBeCloseTo(0.1, 6);
    expect(r.insulinUnits).toBeCloseTo(10, 6); // U-100 syringe
    expect(r.dosesPerVial).toBeCloseTo(20, 6);
    expect(r.wholeDosesPerVial).toBe(20);
  });

  it("computes a fractional case (10mg / 3mL / 500mcg)", () => {
    const r = reconstitution({ vialMg: 10, bacWaterMl: 3, doseMcg: 500 });
    expect(r.concentrationMcgPerMl).toBeCloseTo(3333.333, 3);
    expect(r.doseVolumeMl).toBeCloseTo(0.15, 6);
    expect(r.insulinUnits).toBeCloseTo(15, 6);
    expect(r.dosesPerVial).toBeCloseTo(20, 6);
  });

  it("floors whole doses when the vial does not divide evenly", () => {
    const r = reconstitution({ vialMg: 5, bacWaterMl: 2, doseMcg: 300 });
    expect(r.dosesPerVial).toBeCloseTo(16.667, 2);
    expect(r.wholeDosesPerVial).toBe(16);
  });

  it("rejects non-positive or non-finite inputs", () => {
    expect(() => reconstitution({ vialMg: 5, bacWaterMl: 0, doseMcg: 250 })).toThrow();
    expect(() => reconstitution({ vialMg: 0, bacWaterMl: 2, doseMcg: 250 })).toThrow();
    expect(() => reconstitution({ vialMg: 5, bacWaterMl: 2, doseMcg: Number.NaN })).toThrow();
  });
});

describe("formatters", () => {
  it("formatMg trims trailing zeros", () => {
    expect(formatMg(5)).toBe("5 mg");
    expect(formatMg(2.5)).toBe("2.5 mg");
    expect(formatMg(0.5)).toBe("0.5 mg");
  });

  it("formatMcg rounds to whole micrograms", () => {
    expect(formatMcg(250)).toBe("250 mcg");
    expect(formatMcg(249.6)).toBe("250 mcg");
  });

  it("formatConcentration renders mg/mL", () => {
    expect(formatConcentration(2500)).toBe("2.5 mg/mL");
    expect(formatConcentration(3333.333)).toBe("3.33 mg/mL");
  });

  it("formatUnits renders IU with at most one decimal", () => {
    expect(formatUnits(10)).toBe("10 IU");
    expect(formatUnits(12.5)).toBe("12.5 IU");
    expect(formatUnits(7.34)).toBe("7.3 IU");
  });
});

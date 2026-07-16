import { describe, expect, it } from "vitest";
import { COMMON_VIAL_MG, PEPTIDE_PRESETS, peptideLabelSchema } from "./schema";

describe("PEPTIDE_PRESETS", () => {
  it("every preset seeds a valid label", () => {
    for (const [key, preset] of Object.entries(PEPTIDE_PRESETS)) {
      const result = peptideLabelSchema.safeParse({
        peptideName: preset.name,
        vialMg: preset.vialMg,
        bacWaterMl: preset.bacWaterMl,
        doseMcg: preset.doseMcg,
        lot: "",
        dateReconstituted: "",
        manufacturer: "",
      });
      expect(result.success, key).toBe(true);
    }
  });

  it("has a non-empty printable name for each preset", () => {
    for (const [key, preset] of Object.entries(PEPTIDE_PRESETS)) {
      expect(preset.name.trim().length, key).toBeGreaterThan(0);
    }
  });
});

describe("COMMON_VIAL_MG", () => {
  it("is ascending and unique", () => {
    const sorted = [...COMMON_VIAL_MG].sort((a, b) => a - b);
    expect([...COMMON_VIAL_MG]).toEqual(sorted);
    expect(new Set(COMMON_VIAL_MG).size).toBe(COMMON_VIAL_MG.length);
  });
});

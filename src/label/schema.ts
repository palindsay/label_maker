import { z } from "zod";

/**
 * Physical label stock this app targets: Nelko 40mm x 14mm, sized for a 3ml
 * peptide vial. Fixed rather than user-selectable — the layout and print rules
 * are tuned to exactly this size.
 */
export const NELKO_LABEL_SIZE = { widthMm: 40, heightMm: 14 } as const;

/**
 * A peptide vial label. Numeric fields are the physical facts needed to both
 * print the label and derive dosing (see `src/label/peptide.ts`):
 *   - `vialMg`     total peptide mass in the vial (milligrams)
 *   - `bacWaterMl` bacteriostatic/sterile water added to reconstitute (mL)
 *   - `doseMcg`    intended dose per injection (micrograms)
 *
 * Optional text fields (`lot`, `dateReconstituted`, `manufacturer`) accept ""
 * from the form; empty strings are treated as "absent" by the renderer.
 */
export const peptideLabelSchema = z.object({
  peptideName: z.string().trim().min(1, "Peptide name is required").max(40),
  vialMg: z.number().positive("Vial mg must be > 0").max(1000),
  bacWaterMl: z.number().positive("BAC water mL must be > 0").max(30),
  doseMcg: z.number().positive("Dose mcg must be > 0").max(100_000),
  lot: z.string().trim().max(24),
  dateReconstituted: z.string().trim().max(10),
  manufacturer: z.string().trim().max(24),
});

export type PeptideLabel = z.infer<typeof peptideLabelSchema>;

/**
 * Raw form value. Mirrors {@link PeptideLabel} but every field is always
 * present (optional text fields default to ""), and numeric fields may be
 * `NaN` mid-edit (an emptied number input) — which fails validation.
 */
export interface PeptideLabelInput {
  peptideName: string;
  vialMg: number;
  bacWaterMl: number;
  doseMcg: number;
  lot: string;
  dateReconstituted: string;
  manufacturer: string;
}

/** Popular vial sizes (mg) offered as quick-picks; custom amounts still allowed. */
export const COMMON_VIAL_MG = [5, 10, 20, 24, 30, 40, 50, 60] as const;

/** A form seed for a peptide: the clean label `name` plus starting values. */
export interface PeptidePreset {
  /** Peptide name printed on the label. */
  name: string;
  /** Default vial size (mg); change it with the amount picker or from a CoA. */
  vialMg: number;
  bacWaterMl: number;
  doseMcg: number;
}

/**
 * Starting points to seed the form, keyed by the dropdown label.
 *
 * `vialMg` is a common default size (override it with the amount picker or a
 * CoA). `bacWaterMl` and `doseMcg` are **conventional starting points drawn
 * from common research/community protocols — NOT medical advice**; confirm and
 * adjust every value against your own protocol before printing. Titrated GLP-1
 * agonists start low; blends (KLOW-80, MITOPRIME) are dosed by total mass and
 * are especially approximate.
 */
export const PEPTIDE_PRESETS = {
  // Healing / recovery
  "BPC-157": { name: "BPC-157", vialMg: 10, bacWaterMl: 2, doseMcg: 250 },
  "TB-500 (Thymosin β-4)": { name: "TB-500", vialMg: 10, bacWaterMl: 2, doseMcg: 2500 },
  "GHK-Cu": { name: "GHK-Cu", vialMg: 50, bacWaterMl: 5, doseMcg: 2000 },
  KPV: { name: "KPV", vialMg: 10, bacWaterMl: 2, doseMcg: 250 },
  "ARA-290": { name: "ARA-290", vialMg: 16, bacWaterMl: 4, doseMcg: 4000 },

  // Growth-hormone secretagogues
  Ipamorelin: { name: "Ipamorelin", vialMg: 10, bacWaterMl: 2, doseMcg: 300 },
  "CJC-1295 (no DAC)": { name: "CJC-1295", vialMg: 5, bacWaterMl: 2, doseMcg: 100 },
  "CJC-1295 DAC": { name: "CJC-1295 DAC", vialMg: 5, bacWaterMl: 2, doseMcg: 1000 },
  Sermorelin: { name: "Sermorelin", vialMg: 5, bacWaterMl: 2, doseMcg: 200 },
  Tesamorelin: { name: "Tesamorelin", vialMg: 10, bacWaterMl: 2, doseMcg: 1000 },
  "GHRP-2": { name: "GHRP-2", vialMg: 5, bacWaterMl: 2, doseMcg: 100 },
  "GHRP-6": { name: "GHRP-6", vialMg: 5, bacWaterMl: 2, doseMcg: 100 },
  Hexarelin: { name: "Hexarelin", vialMg: 5, bacWaterMl: 2, doseMcg: 100 },
  "HGH Frag 176-191": { name: "HGH 176-191", vialMg: 5, bacWaterMl: 2, doseMcg: 250 },
  "MOTS-c": { name: "MOTS-c", vialMg: 10, bacWaterMl: 2, doseMcg: 5000 },
  "IGF-1 LR3": { name: "IGF-1 LR3", vialMg: 1, bacWaterMl: 1, doseMcg: 50 },

  // GLP-1 / metabolic (titrated — start low)
  Semaglutide: { name: "Semaglutide", vialMg: 5, bacWaterMl: 2, doseMcg: 250 },
  Tirzepatide: { name: "Tirzepatide", vialMg: 10, bacWaterMl: 2, doseMcg: 2500 },
  Retatrutide: { name: "Retatrutide", vialMg: 10, bacWaterMl: 2, doseMcg: 2000 },
  Cagrilintide: { name: "Cagrilintide", vialMg: 10, bacWaterMl: 2, doseMcg: 300 },
  "AOD-9604": { name: "AOD-9604", vialMg: 5, bacWaterMl: 2, doseMcg: 300 },

  // Cognitive / sleep
  Selank: { name: "Selank", vialMg: 10, bacWaterMl: 2, doseMcg: 300 },
  Semax: { name: "Semax", vialMg: 10, bacWaterMl: 2, doseMcg: 300 },
  DSIP: { name: "DSIP", vialMg: 10, bacWaterMl: 2, doseMcg: 250 },
  Epithalon: { name: "Epithalon", vialMg: 10, bacWaterMl: 2, doseMcg: 5000 },

  // Immune / longevity
  "Thymosin Alpha-1": { name: "Thymosin α-1", vialMg: 5, bacWaterMl: 2, doseMcg: 1600 },
  "SS-31 (Elamipretide)": { name: "SS-31", vialMg: 10, bacWaterMl: 2, doseMcg: 5000 },

  // Sexual / cosmetic
  "PT-141 (Bremelanotide)": { name: "PT-141", vialMg: 10, bacWaterMl: 2, doseMcg: 1000 },
  "Melanotan II": { name: "Melanotan II", vialMg: 10, bacWaterMl: 2, doseMcg: 250 },

  // Blends (dosed by total mass — approximate)
  "KLOW-80 (blend)": { name: "KLOW-80", vialMg: 80, bacWaterMl: 4, doseMcg: 500 },
  "MITOPRIME (blend)": { name: "MITOPRIME", vialMg: 140, bacWaterMl: 4, doseMcg: 1000 },
} as const satisfies Record<string, PeptidePreset>;

export type PeptidePresetName = keyof typeof PEPTIDE_PRESETS;

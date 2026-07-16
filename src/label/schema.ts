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
 * Optional fields (`lot`, `dateReconstituted`, `note`) accept "" from the form;
 * empty strings are treated as "absent" by the renderer.
 */
export const peptideLabelSchema = z.object({
  peptideName: z.string().trim().min(1, "Peptide name is required").max(40),
  vialMg: z.number().positive("Vial mg must be > 0").max(1000),
  bacWaterMl: z.number().positive("BAC water mL must be > 0").max(30),
  doseMcg: z.number().positive("Dose mcg must be > 0").max(100_000),
  lot: z.string().trim().max(24),
  dateReconstituted: z.string().trim().max(10),
  note: z.string().trim().max(40),
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
  note: string;
}

/** A form seed for a peptide: the clean label `name` plus starting values. */
export interface PeptidePreset {
  /** Peptide name printed on the label (without the vial size). */
  name: string;
  vialMg: number;
  bacWaterMl: number;
  doseMcg: number;
}

/**
 * Starting points to seed the form, keyed by the dropdown label (which may
 * include the vial size to disambiguate, e.g. "Tirzepatide 30 mg").
 *
 * The `vialMg` values are the purchased vial sizes. `bacWaterMl` and `doseMcg`
 * are **conventional starting points only — not medical advice**; confirm and
 * adjust every value against your own protocol before printing. Blends
 * (KLOW-80, MITOPRIME) are dosed by total mass and are especially approximate.
 */
export const PEPTIDE_PRESETS = {
  "BPC-157": { name: "BPC-157", vialMg: 5, bacWaterMl: 2, doseMcg: 250 },
  "TB-500": { name: "TB-500", vialMg: 5, bacWaterMl: 2, doseMcg: 500 },
  KPV: { name: "KPV", vialMg: 30, bacWaterMl: 3, doseMcg: 500 },
  DSIP: { name: "DSIP", vialMg: 10, bacWaterMl: 2, doseMcg: 250 },
  Ipamorelin: { name: "Ipamorelin", vialMg: 10, bacWaterMl: 2, doseMcg: 300 },
  Tesamorelin: { name: "Tesamorelin", vialMg: 10, bacWaterMl: 2, doseMcg: 1000 },
  "Thymosin Alpha-1": { name: "Thymosin α-1", vialMg: 10, bacWaterMl: 2, doseMcg: 1600 },
  "SS-31": { name: "SS-31", vialMg: 28, bacWaterMl: 3, doseMcg: 5000 },
  Semaglutide: { name: "Semaglutide", vialMg: 5, bacWaterMl: 2, doseMcg: 250 },
  "Retatrutide 30 mg": { name: "Retatrutide", vialMg: 30, bacWaterMl: 3, doseMcg: 2000 },
  "Tirzepatide 10 mg": { name: "Tirzepatide", vialMg: 10, bacWaterMl: 2, doseMcg: 2500 },
  "Tirzepatide 30 mg": { name: "Tirzepatide", vialMg: 30, bacWaterMl: 3, doseMcg: 2500 },
  "Tirzepatide 60 mg": { name: "Tirzepatide", vialMg: 60, bacWaterMl: 3, doseMcg: 2500 },
  "KLOW-80 (blend)": { name: "KLOW-80", vialMg: 80, bacWaterMl: 4, doseMcg: 500 },
  "MITOPRIME 140 mg (blend)": { name: "MITOPRIME", vialMg: 140, bacWaterMl: 4, doseMcg: 1000 },
} as const satisfies Record<string, PeptidePreset>;

export type PeptidePresetName = keyof typeof PEPTIDE_PRESETS;

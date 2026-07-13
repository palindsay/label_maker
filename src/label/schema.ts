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

/** Common starting points to seed the form. */
export const PEPTIDE_PRESETS = {
  "BPC-157": { vialMg: 5, bacWaterMl: 2, doseMcg: 250 },
  "TB-500": { vialMg: 5, bacWaterMl: 2, doseMcg: 500 },
  Semaglutide: { vialMg: 5, bacWaterMl: 2, doseMcg: 250 },
} as const satisfies Record<string, Pick<PeptideLabelInput, "vialMg" | "bacWaterMl" | "doseMcg">>;

export type PeptidePresetName = keyof typeof PEPTIDE_PRESETS;

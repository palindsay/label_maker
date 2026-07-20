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
 * `vialMg`/`bacWaterMl` are common sizes (override with the amount picker or a
 * CoA); `doseMcg` is a per-injection default. Every value is **NOT medical
 * advice** — confirm it against your vial and protocol before printing.
 *
 * Sourcing (from a literature/community research pass):
 *  - Real human efficacy trials exist for only a few: ARA-290 (Brines, Mol Med
 *    2015, 4 mg/day), Thymosin α-1 (Zadaxin 1.6 mg 2×/wk), the FDA-approved
 *    Tesamorelin (Egrifta 2 mg/day) and PT-141 (Vyleesi 1.75 mg), and the GLP-1s.
 *  - The GLP-1/amylin agonists (Semaglutide, Tirzepatide, Retatrutide,
 *    Cagrilintide) are seeded at their HIGH-EFFICACY MAINTENANCE dose. ⚠ These
 *    MUST be titrated up over weeks from a low start (sema 0.25 mg, tirze 2.5 mg,
 *    reta 2 mg, cagri 0.25 mg); injecting the maintenance dose from day one
 *    causes severe GI toxicity. Their vial sizes are set so the dose stays
 *    drawable within one 1 mL U-100 syringe.
 *  - Everything else has NO human efficacy trial — the dose is community/
 *    anecdotal consensus (noted inline), not a study result.
 *
 * Safety flags: Melanotan II (mole/melanoma change, priapism); CJC-1295 DAC vs
 * no-DAC differ ~20× (overdose trap); AOD-9604 has no validated *injectable*
 * dose (its human data is oral and failed Ph2b); MOTS-c protocols disagree ~10×;
 * IGF-1 LR3 accumulates (hypoglycemia risk); Selank/Semax were validated
 * intranasal and DSIP IV — not the SC route this tool computes.
 */
export const PEPTIDE_PRESETS = {
  // Healing / recovery
  "BPC-157": { name: "BPC-157", vialMg: 10, bacWaterMl: 2, doseMcg: 250 }, // community; animal-only
  "TB-500 (Thymosin β-4)": { name: "TB-500", vialMg: 10, bacWaterMl: 2, doseMcg: 2500 }, // community
  "GHK-Cu": { name: "GHK-Cu", vialMg: 50, bacWaterMl: 5, doseMcg: 2000 }, // community; copper load caution
  KPV: { name: "KPV", vialMg: 10, bacWaterMl: 2, doseMcg: 250 }, // community
  "ARA-290": { name: "ARA-290", vialMg: 16, bacWaterMl: 4, doseMcg: 4000 }, // human Ph2 (Brines 2015)

  // Growth-hormone secretagogues (community/anecdotal; GHRPs saturate ~100 mcg)
  Ipamorelin: { name: "Ipamorelin", vialMg: 10, bacWaterMl: 2, doseMcg: 300 },
  "CJC-1295 (no DAC)": { name: "CJC-1295", vialMg: 5, bacWaterMl: 2, doseMcg: 100 }, // ⚠ 20× vs DAC
  "CJC-1295 DAC": { name: "CJC-1295 DAC", vialMg: 5, bacWaterMl: 2, doseMcg: 2000 }, // ~2 mg/wk; ⚠ vs no-DAC
  Sermorelin: { name: "Sermorelin", vialMg: 5, bacWaterMl: 2, doseMcg: 300 }, // off-label 200–500 mcg/day
  Tesamorelin: { name: "Tesamorelin", vialMg: 10, bacWaterMl: 2, doseMcg: 2000 }, // FDA Egrifta 2 mg/day
  "GHRP-2": { name: "GHRP-2", vialMg: 5, bacWaterMl: 2, doseMcg: 100 },
  "GHRP-6": { name: "GHRP-6", vialMg: 5, bacWaterMl: 2, doseMcg: 100 },
  Hexarelin: { name: "Hexarelin", vialMg: 5, bacWaterMl: 2, doseMcg: 100 },
  "HGH Frag 176-191": { name: "HGH 176-191", vialMg: 5, bacWaterMl: 2, doseMcg: 250 },
  "MOTS-c": { name: "MOTS-c", vialMg: 10, bacWaterMl: 2, doseMcg: 5000 }, // ⚠ sources disagree ~10×
  "IGF-1 LR3": { name: "IGF-1 LR3", vialMg: 1, bacWaterMl: 1, doseMcg: 50 }, // ⚠ accumulates; hypoglycemia

  // GLP-1 / metabolic — HIGH-EFFICACY MAINTENANCE dose; ⚠ MUST titrate up from a low start
  Semaglutide: { name: "Semaglutide", vialMg: 5, bacWaterMl: 2, doseMcg: 2400 }, // Wegovy 2.4 mg/wk (start 0.25)
  Tirzepatide: { name: "Tirzepatide", vialMg: 30, bacWaterMl: 2, doseMcg: 15000 }, // Zepbound 15 mg/wk (start 2.5)
  Retatrutide: { name: "Retatrutide", vialMg: 24, bacWaterMl: 2, doseMcg: 12000 }, // NEJM Ph2 12 mg/wk (start 2)
  Cagrilintide: { name: "Cagrilintide", vialMg: 10, bacWaterMl: 2, doseMcg: 2400 }, // CagriSema 2.4 mg/wk (start 0.25)
  "AOD-9604": { name: "AOD-9604", vialMg: 5, bacWaterMl: 2, doseMcg: 300 }, // ⚠ no validated injectable dose

  // Cognitive / sleep (⚠ Selank/Semax validated intranasal; DSIP trials were IV)
  Selank: { name: "Selank", vialMg: 10, bacWaterMl: 2, doseMcg: 300 },
  Semax: { name: "Semax", vialMg: 10, bacWaterMl: 2, doseMcg: 300 },
  DSIP: { name: "DSIP", vialMg: 10, bacWaterMl: 2, doseMcg: 250 },
  Epithalon: { name: "Epithalon", vialMg: 10, bacWaterMl: 2, doseMcg: 5000 }, // Khavinson; no independent RCT

  // Immune / longevity
  "Thymosin Alpha-1": { name: "Thymosin α-1", vialMg: 5, bacWaterMl: 2, doseMcg: 1600 }, // Zadaxin 1.6 mg 2×/wk
  "SS-31 (Elamipretide)": { name: "SS-31", vialMg: 10, bacWaterMl: 2, doseMcg: 5000 }, // ⚠ trials 4–40 mg; uncertain

  // Sexual / cosmetic
  "PT-141 (Bremelanotide)": { name: "PT-141", vialMg: 10, bacWaterMl: 2, doseMcg: 1750 }, // FDA Vyleesi 1.75 mg
  "Melanotan II": { name: "Melanotan II", vialMg: 10, bacWaterMl: 2, doseMcg: 250 }, // ⚠ melanoma/priapism; start, titrate

  // Blends — dosed by TOTAL blend mass (approximate; read the actual vial)
  "KLOW-80 (blend)": { name: "KLOW-80", vialMg: 80, bacWaterMl: 4, doseMcg: 500 }, // GHK-Cu50+BPC10+TB10+KPV10
  "MITOPRIME (blend)": { name: "MITOPRIME", vialMg: 120, bacWaterMl: 4, doseMcg: 1000 }, // NAD⁺100+MOTS-c10+5A1MQ10
} as const satisfies Record<string, PeptidePreset>;

export type PeptidePresetName = keyof typeof PEPTIDE_PRESETS;

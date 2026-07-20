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
 * Source of record: `Peptide_Guide_V8.md` (palindsay/peptide_research, V8.0,
 * 2026-04-14 — citation-audited/FDA-verified). Each `doseMcg` sits at the
 * **conservative/lower end** of that guide's stated "Typical Dosing" range
 * (the guide's range is noted inline); bump per vial as your protocol dictates.
 *
 *  - GLP-1/amylin agonists (Semaglutide, Tirzepatide, Retatrutide, Cagrilintide)
 *    are seeded at the guide's MAINTENANCE TARGET. ⚠ These MUST be titrated up
 *    over weeks from a low start (sema 0.25 mg, tirze 2.5 mg, reta 2 mg, cagri
 *    0.25 mg); injecting the maintenance dose from day one causes severe GI
 *    toxicity. Vial sizes are set so the dose draws within one 1 mL U-100 syringe.
 *  - SS-31 is kept at a conservative 5 mg — the guide's dose is 40 mg SC/day
 *    (FORZINITY FDA label / research 40–60 mg), retained here at 5 mg by choice.
 *  - Most others have NO human efficacy trial; the guide's figures are community/
 *    research convention, not a study result.
 *
 * Safety flags (per the guide): Melanotan II (mole/melanoma change, priapism);
 * CJC-1295 DAC vs no-DAC differ ~20× (overdose trap); AOD-9604 human data is oral
 * (failed Ph2b) — no validated injectable dose; MOTS-c has no established human
 * ED50; IGF-1 LR3 accumulates (>50 mcg/day raises hypoglycemia risk); Selank/Semax
 * are validated INTRANASAL and DSIP IV — not the SC route this tool computes.
 */
export const PEPTIDE_PRESETS = {
  // Healing / recovery
  "BPC-157": { name: "BPC-157", vialMg: 10, bacWaterMl: 2, doseMcg: 250 }, // guide 250–500 mcg 1–2×/day
  "TB-500 (Thymosin β-4)": { name: "TB-500", vialMg: 10, bacWaterMl: 2, doseMcg: 2500 }, // guide load 2–2.5 mg 2×/wk → 2 mg maint
  "GHK-Cu": { name: "GHK-Cu", vialMg: 50, bacWaterMl: 5, doseMcg: 2000 }, // guide SC 1–2 mg/day (mainly topical; copper load)
  KPV: { name: "KPV", vialMg: 10, bacWaterMl: 2, doseMcg: 250 }, // guide 100–500 mcg 1–2×/day
  "ARA-290": { name: "ARA-290", vialMg: 16, bacWaterMl: 4, doseMcg: 4000 }, // guide 4 mg/day ×28d (human Ph2, Brines)

  // Growth-hormone secretagogues (guide: GHRPs plateau near ~100 mcg)
  Ipamorelin: { name: "Ipamorelin", vialMg: 10, bacWaterMl: 2, doseMcg: 300 }, // guide 100–300 mcg 1–3×/day
  "CJC-1295 (no DAC)": { name: "CJC-1295", vialMg: 5, bacWaterMl: 2, doseMcg: 100 }, // guide 100 mcg 1–3×/day; ⚠ 20× vs DAC
  "CJC-1295 DAC": { name: "CJC-1295 DAC", vialMg: 5, bacWaterMl: 2, doseMcg: 2000 }, // guide 1–2 mg/week; ⚠ vs no-DAC
  Sermorelin: { name: "Sermorelin", vialMg: 5, bacWaterMl: 2, doseMcg: 300 }, // guide 200–500 mcg at bedtime
  Tesamorelin: { name: "Tesamorelin", vialMg: 10, bacWaterMl: 2, doseMcg: 2000 }, // guide 2 mg/day (FDA Egrifta)
  "GHRP-2": { name: "GHRP-2", vialMg: 5, bacWaterMl: 2, doseMcg: 100 }, // guide research SC 100–300 mcg
  "GHRP-6": { name: "GHRP-6", vialMg: 5, bacWaterMl: 2, doseMcg: 100 }, // guide 100–150 mcg 1–3×/day
  Hexarelin: { name: "Hexarelin", vialMg: 5, bacWaterMl: 2, doseMcg: 100 }, // guide 100–200 mcg; cycle 14–21d on/14 off
  "HGH Frag 176-191": { name: "HGH 176-191", vialMg: 5, bacWaterMl: 2, doseMcg: 250 }, // guide 250–500 mcg fasted
  "MOTS-c": { name: "MOTS-c", vialMg: 10, bacWaterMl: 2, doseMcg: 5000 }, // guide 5–10 mg/day (no human ED50)
  "IGF-1 LR3": { name: "IGF-1 LR3", vialMg: 1, bacWaterMl: 1, doseMcg: 50 }, // guide 20–50 mcg/day; ⚠ >50 hypoglycemia

  // GLP-1 / metabolic — guide MAINTENANCE TARGET; ⚠ MUST titrate up from a low start
  Semaglutide: { name: "Semaglutide", vialMg: 5, bacWaterMl: 2, doseMcg: 2400 }, // guide Wegovy 0.25→2.4 mg/wk
  Tirzepatide: { name: "Tirzepatide", vialMg: 30, bacWaterMl: 2, doseMcg: 15000 }, // guide 2.5→15 mg/wk (targets 5/10/15)
  Retatrutide: { name: "Retatrutide", vialMg: 24, bacWaterMl: 2, doseMcg: 12000 }, // guide 2→12 mg/wk
  Cagrilintide: { name: "Cagrilintide", vialMg: 10, bacWaterMl: 2, doseMcg: 2400 }, // guide up-titrate to 2.4 mg/wk
  "AOD-9604": { name: "AOD-9604", vialMg: 5, bacWaterMl: 2, doseMcg: 300 }, // guide 300–600 mcg SC/day; ⚠ no validated inject dose

  // Cognitive / sleep (⚠ Selank/Semax validated intranasal; DSIP trials were IV)
  Selank: { name: "Selank", vialMg: 10, bacWaterMl: 2, doseMcg: 300 }, // guide 250–500 mcg INTRANASAL
  Semax: { name: "Semax", vialMg: 10, bacWaterMl: 2, doseMcg: 300 }, // guide 200–600 mcg/day INTRANASAL
  DSIP: { name: "DSIP", vialMg: 10, bacWaterMl: 2, doseMcg: 250 }, // guide 100–500 mcg at bedtime
  Epithalon: { name: "Epithalon", vialMg: 10, bacWaterMl: 2, doseMcg: 5000 }, // guide 5–10 mg/day ×10–20d cycles

  // Immune / longevity
  "Thymosin Alpha-1": { name: "Thymosin α-1", vialMg: 5, bacWaterMl: 2, doseMcg: 1600 }, // guide 1.6 mg 2×/wk (Zadaxin)
  "SS-31 (Elamipretide)": { name: "SS-31", vialMg: 10, bacWaterMl: 2, doseMcg: 5000 }, // guide 40 mg/day (FORZINITY); kept 5 mg

  // Sexual / cosmetic
  "PT-141 (Bremelanotide)": { name: "PT-141", vialMg: 10, bacWaterMl: 2, doseMcg: 1750 }, // guide 1.75 mg (FDA Vyleesi)
  "Melanotan II": { name: "Melanotan II", vialMg: 10, bacWaterMl: 2, doseMcg: 250 }, // guide load 0.25–1 mg → 0.5–1 mg; ⚠ melanoma/priapism

  // Blends — dosed by TOTAL blend mass (community/anecdotal; ratios, vial sizes and
  // reconstitution vary by supplier, so per-unit dose varies — always read the vial).
  // GH-secretagogue blends are really dosed per-component; the total shown is derived.
  "Wolverine (BPC-157 + TB-500)": { name: "Wolverine", vialMg: 20, bacWaterMl: 2, doseMcg: 500 }, // BPC10+TB10; ~250 mcg each 1×/day
  "GLOW (GHK-Cu + BPC + TB)": { name: "GLOW", vialMg: 70, bacWaterMl: 3, doseMcg: 2330 }, // GHK50+BPC10+TB10 (5:1:1); ~10 u/day
  "KLOW-80 (blend)": { name: "KLOW-80", vialMg: 80, bacWaterMl: 3, doseMcg: 2670 }, // GHK50+KPV10+BPC10+TB10; ~10 u/day (2.7–8 mg range)
  "CJC-1295 + Ipamorelin": { name: "CJC-1295/Ipa", vialMg: 10, bacWaterMl: 2, doseMcg: 500 }, // CJC5+Ipa5; 250 mcg each 1–2×/day
  "Tesamorelin + Ipamorelin": { name: "Tesa/Ipamorelin", vialMg: 10, bacWaterMl: 2, doseMcg: 1300 }, // Tesa5+Ipa5; ~1 mg tesa+300 mcg ipa/day
  "Sermorelin + Ipamorelin": { name: "Sermorelin/Ipa", vialMg: 10, bacWaterMl: 2, doseMcg: 200 }, // Sermo5+Ipa5; ~100–200 mcg/day, split
  "MITOPRIME (blend)": { name: "MITOPRIME", vialMg: 120, bacWaterMl: 4, doseMcg: 1000 }, // NAD⁺100+MOTS-c10+5A1MQ10
} as const satisfies Record<string, PeptidePreset>;

export type PeptidePresetName = keyof typeof PEPTIDE_PRESETS;

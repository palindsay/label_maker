/**
 * Peptide reconstitution math.
 *
 * All calculations assume a standard U-100 insulin syringe, where 100 "units"
 * (IU on the barrel) equal 1 mL. This is the near-universal syringe for these
 * dose ranges; if you use a U-40/U-50 syringe the unit readings differ.
 *
 * These are arithmetic conversions of the operator's own inputs, not medical
 * advice. Always verify the printed dose against the vial and your protocol.
 */

const MCG_PER_MG = 1000;
/** U-100: 100 syringe units == 1 mL. */
const UNITS_PER_ML = 100;

export interface ReconstitutionInput {
  /** Total peptide mass in the vial, milligrams. */
  vialMg: number;
  /** Bacteriostatic/sterile water added, millilitres. */
  bacWaterMl: number;
  /** Intended dose per injection, micrograms. */
  doseMcg: number;
}

export interface Reconstitution {
  /** Concentration after reconstitution, micrograms per millilitre. */
  concentrationMcgPerMl: number;
  /** Liquid volume to draw for one dose, millilitres. */
  doseVolumeMl: number;
  /** Syringe reading for one dose on a U-100 insulin syringe. */
  insulinUnits: number;
  /** Exact number of doses the vial yields. */
  dosesPerVial: number;
  /** Whole doses the vial yields (floored). */
  wholeDosesPerVial: number;
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive, finite number`);
  }
}

/**
 * Derive concentration and per-dose measurements from a vial's reconstitution
 * parameters.
 *
 * @throws If any input is not a positive, finite number.
 */
export function reconstitution(input: ReconstitutionInput): Reconstitution {
  assertPositiveFinite("vialMg", input.vialMg);
  assertPositiveFinite("bacWaterMl", input.bacWaterMl);
  assertPositiveFinite("doseMcg", input.doseMcg);

  const vialMcg = input.vialMg * MCG_PER_MG;
  const concentrationMcgPerMl = vialMcg / input.bacWaterMl;
  const doseVolumeMl = input.doseMcg / concentrationMcgPerMl;
  const insulinUnits = doseVolumeMl * UNITS_PER_ML;
  const dosesPerVial = vialMcg / input.doseMcg;

  return {
    concentrationMcgPerMl,
    doseVolumeMl,
    insulinUnits,
    dosesPerVial,
    wholeDosesPerVial: Math.floor(dosesPerVial),
  };
}

/** Round to at most `dp` decimals and drop trailing zeros ("2.50" -> "2.5"). */
function trim(value: number, dp: number): string {
  return Number(value.toFixed(dp)).toString();
}

/** e.g. `formatMg(2.5)` -> "2.5 mg". */
export function formatMg(mg: number): string {
  return `${trim(mg, 2)} mg`;
}

/** e.g. `formatMcg(249.6)` -> "250 mcg" (whole micrograms). */
export function formatMcg(mcg: number): string {
  return `${Math.round(mcg)} mcg`;
}

/** Concentration in mg/mL, e.g. `formatConcentration(2500)` -> "2.5 mg/mL". */
export function formatConcentration(mcgPerMl: number): string {
  return `${trim(mcgPerMl / MCG_PER_MG, 2)} mg/mL`;
}

/** U-100 syringe reading, e.g. `formatUnits(12.5)` -> "12.5 IU". */
export function formatUnits(units: number): string {
  return `${trim(units, 1)} IU`;
}

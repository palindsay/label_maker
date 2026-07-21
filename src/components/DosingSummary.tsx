import {
  type Reconstitution,
  formatConcentration,
  formatMg,
  formatMl,
  formatUnits,
} from "../label/peptide";

/**
 * Screen-only provenance for the peptide mass that is driving dosing. Populated
 * from a CoA: the measured/assayed content (which drives the math) alongside the
 * label claim and purity, so the operator sees why the numbers differ from the
 * printed nominal size.
 */
export interface DosingBasis {
  /** Assayed net content — drives dosing when present. */
  measuredMg?: number;
  /** Nominal / label claim — informational. */
  labeledMg?: number;
  /** Assay purity, e.g. "99.8%". */
  purity?: string;
}

interface DosingSummaryProps {
  /** Derived dosing for the current input, or null when the input is invalid. */
  recon: Reconstitution | null;
  /** CoA provenance to surface, or null when the form wasn't filled from a CoA. */
  basis: DosingBasis | null;
}

/**
 * On-screen (never printed) dosing readout. Surfaces the derived draw volume,
 * syringe units, concentration, and doses-per-vial — values the tiny 40×14 mm
 * label can't all fit — plus, when a CoA was read, the measured mass driving the
 * dosing (vs the label claim) and the purity. Purely presentational.
 */
export function DosingSummary({ recon, basis }: DosingSummaryProps) {
  const showBasis =
    basis !== null && (basis.measuredMg !== undefined || basis.purity !== undefined);
  if (recon === null && !showBasis) return null;

  const basisText = basis
    ? [
        basis.measuredMg !== undefined && `Measured ${formatMg(basis.measuredMg)} drives dosing`,
        basis.labeledMg !== undefined && `label claim ${formatMg(basis.labeledMg)}`,
        basis.purity !== undefined && `${basis.purity} purity`,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · ")
    : "";

  return (
    <section className="dosing-summary no-print" aria-label="Dosing detail">
      <h2 className="dosing-title">Dosing</h2>
      {recon ? (
        <ul className="dosing-rows">
          <li>Draw {formatMl(recon.doseVolumeMl)}</li>
          <li>Syringe {formatUnits(recon.insulinUnits)}</li>
          <li>Conc {formatConcentration(recon.concentrationMcgPerMl)}</li>
          <li>{recon.wholeDosesPerVial} doses/vial</li>
        </ul>
      ) : (
        <p className="dosing-empty">Enter valid vial details to see dosing.</p>
      )}
      {showBasis && basisText && <p className="dosing-basis">{basisText}</p>}
    </section>
  );
}

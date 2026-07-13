import { mmToPx } from "../label/format";
import {
  type Reconstitution,
  formatConcentration,
  formatMcg,
  formatMg,
  formatUnits,
} from "../label/peptide";
import { NELKO_LABEL_SIZE, type PeptideLabelInput } from "../label/schema";

type LabelPreviewProps = {
  label: PeptideLabelInput;
  /** Derived dosing, or null when the current input is invalid. */
  recon: Reconstitution | null;
};

const DASH = "—";

/** Guarded numeric formatter: shows an em-dash for NaN/absent values. */
function num(value: number, fmt: (n: number) => string): string {
  return Number.isFinite(value) ? fmt(value) : DASH;
}

/**
 * Renders a peptide vial label at true physical size (40mm x 14mm). The
 * `.label-print` element is the only thing that reaches paper — see the
 * `@media print` block in index.css.
 */
export function LabelPreview({ label, recon }: LabelPreviewProps) {
  const style = {
    width: `${mmToPx(NELKO_LABEL_SIZE.widthMm)}px`,
    height: `${mmToPx(NELKO_LABEL_SIZE.heightMm)}px`,
  } as const;

  const meta = [label.dateReconstituted, label.lot].filter((s) => s.trim().length > 0).join(" · ");

  return (
    <div className="label-print" style={style} aria-label="Label preview">
      <div className="row r-head">
        <span className="name">{label.peptideName.trim() || DASH}</span>
        <span className="amount">{num(label.vialMg, formatMg)}</span>
      </div>

      <div className="row r-dose">
        <span>{num(label.doseMcg, formatMcg)}/dose</span>
        <span className="units">{recon ? formatUnits(recon.insulinUnits) : DASH}</span>
      </div>

      <div className="row r-conc">
        <span>{recon ? formatConcentration(recon.concentrationMcgPerMl) : DASH}</span>
        <span>{num(label.bacWaterMl, (n) => `${formatMg(n).replace(" mg", "")} mL BAC`)}</span>
      </div>

      <div className="row r-meta">
        <span>{meta}</span>
        <span>{recon ? `~${recon.wholeDosesPerVial} doses` : ""}</span>
      </div>

      {label.note.trim() && <div className="row r-note">{label.note.trim()}</div>}
    </div>
  );
}

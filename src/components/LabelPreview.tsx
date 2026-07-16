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

/** Shrink the peptide-name font as the name gets longer so it stays on one line. */
function nameFontPt(name: string): number {
  if (name.length > 16) return 6.5;
  if (name.length > 11) return 7.5;
  return 8.5;
}

/** A bare millilitre number (reuses the mg formatter's trailing-zero trimming). */
function mlNumber(n: number): string {
  return formatMg(n).replace(" mg", "");
}

/**
 * Renders a peptide vial label at true physical size (40mm x 14mm), optimized
 * for at-a-glance readability: the syringe draw (IU) is the largest element,
 * with only the dosing and source facts that are actually needed. The
 * `.label-print` element is the only thing that reaches paper (see index.css).
 */
export function LabelPreview({ label, recon }: LabelPreviewProps) {
  const style = {
    width: `${mmToPx(NELKO_LABEL_SIZE.widthMm)}px`,
    height: `${mmToPx(NELKO_LABEL_SIZE.heightMm)}px`,
  } as const;

  const name = label.peptideName.trim() || DASH;
  const amount = Number.isFinite(label.vialMg) ? formatMg(label.vialMg) : DASH;
  const iu = recon ? formatUnits(recon.insulinUnits) : DASH;
  const mcg = Number.isFinite(label.doseMcg) ? formatMcg(label.doseMcg) : DASH;
  const source = recon
    ? `${formatConcentration(recon.concentrationMcgPerMl)} · ${mlNumber(label.bacWaterMl)} mL BAC`
    : DASH;

  const foot = [
    label.dateReconstituted.trim() && `Recon ${label.dateReconstituted.trim()}`,
    label.lot.trim() && `Lot ${label.lot.trim()}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const manufacturer = label.manufacturer.trim();

  return (
    <div className="label-print" style={style} aria-label="Label preview">
      <div className="lbl-head">
        <span className="lbl-name" style={{ fontSize: `${nameFontPt(name)}pt` }}>
          {name}
        </span>
        <span className="lbl-amount">{amount}</span>
      </div>

      <div className="lbl-dose">
        <span className="lbl-iu">{iu}</span>
        <span className="lbl-mcg">{mcg}</span>
      </div>

      <div className="lbl-source">{source}</div>

      {(foot || manufacturer) && (
        <div className="lbl-foot">
          <span>{foot}</span>
          {manufacturer && <span className="lbl-mfr">{manufacturer}</span>}
        </div>
      )}
    </div>
  );
}

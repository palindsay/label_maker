import type { ChangeEvent } from "react";
import { PEPTIDE_PRESETS, type PeptideLabelInput, type PeptidePresetName } from "../label/schema";

type LabelFormProps = {
  value: PeptideLabelInput;
  onChange: (next: PeptideLabelInput) => void;
  /** Called when the user picks a vial photo to auto-fill from. */
  onImageSelected: (file: File) => void;
  /** True while an image is being read/extracted; disables the photo control. */
  busy: boolean;
};

/** Controlled numeric input value: blank while NaN so the field can be emptied. */
function numValue(n: number): number | string {
  return Number.isNaN(n) ? "" : n;
}

/** Controlled form for peptide vial + dosing details. Presentational only. */
export function LabelForm({ value, onChange, onImageSelected, busy }: LabelFormProps) {
  const setText =
    (key: "peptideName" | "lot" | "dateReconstituted" | "note") =>
    (e: ChangeEvent<HTMLInputElement>) =>
      onChange({ ...value, [key]: e.target.value });

  const setNumber =
    (key: "vialMg" | "bacWaterMl" | "doseMcg") => (e: ChangeEvent<HTMLInputElement>) =>
      onChange({ ...value, [key]: e.target.valueAsNumber });

  const applyPreset = (e: ChangeEvent<HTMLSelectElement>) => {
    const preset = PEPTIDE_PRESETS[e.target.value as PeptidePresetName];
    if (preset) {
      onChange({
        ...value,
        peptideName: preset.name,
        vialMg: preset.vialMg,
        bacWaterMl: preset.bacWaterMl,
        doseMcg: preset.doseMcg,
      });
    }
  };

  const pickImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImageSelected(file);
  };

  return (
    <form className="label-form" onSubmit={(e) => e.preventDefault()}>
      <label className="photo">
        Vial photo → auto-fill
        <input type="file" accept="image/*" onChange={pickImage} disabled={busy} />
      </label>

      <label>
        Preset
        <select defaultValue="" onChange={applyPreset}>
          <option value="" disabled>
            Choose…
          </option>
          {Object.keys(PEPTIDE_PRESETS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Peptide name
        <input type="text" value={value.peptideName} onChange={setText("peptideName")} />
      </label>

      <div className="row3">
        <label>
          Vial (mg)
          <input
            type="number"
            min={0}
            step="any"
            value={numValue(value.vialMg)}
            onChange={setNumber("vialMg")}
          />
        </label>
        <label>
          BAC water (mL)
          <input
            type="number"
            min={0}
            step="any"
            value={numValue(value.bacWaterMl)}
            onChange={setNumber("bacWaterMl")}
          />
        </label>
        <label>
          Dose (mcg)
          <input
            type="number"
            min={0}
            step="any"
            value={numValue(value.doseMcg)}
            onChange={setNumber("doseMcg")}
          />
        </label>
      </div>

      <div className="row2">
        <label>
          Lot
          <input type="text" value={value.lot} onChange={setText("lot")} />
        </label>
        <label>
          Date
          <input
            type="date"
            value={value.dateReconstituted}
            onChange={setText("dateReconstituted")}
          />
        </label>
      </div>

      <label>
        Note
        <input
          type="text"
          value={value.note}
          placeholder="e.g. Research use only · Fridge"
          onChange={setText("note")}
        />
      </label>
    </form>
  );
}
